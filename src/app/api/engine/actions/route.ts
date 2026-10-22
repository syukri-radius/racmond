import { guard, readJson } from "@/lib/api";
import { getEngine, probeEngine } from "@/lib/docker/service";
import { invalidateEngineCaches } from "@/lib/docker/state";

export const dynamic = "force-dynamic";

interface ActionBody {
  action?: string;
  target?: string;
  payload?: Record<string, unknown>;
  run?: { image?: string; name?: string; ports?: string[]; env?: string[]; command?: string };
  prune?: "images" | "volumes" | "networks" | "containers";
  project?: string;
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<ActionBody>(request);
    const { adapter } = await getEngine();

    if (body.run) {
      if (!body.run.image?.trim()) throw new Error("image is required to run a container");
      const result = await adapter.run({
        image: body.run.image.trim(),
        name: body.run.name?.trim() || undefined,
        ports: body.run.ports?.filter(Boolean),
        env: body.run.env?.filter(Boolean),
        command: body.run.command,
      });
      invalidateEngineCaches();
      return { ok: true, ...result };
    }

    if (body.prune) {
      const result = await adapter.prune(body.prune);
      invalidateEngineCaches();
      return { ok: true, result };
    }

    if (body.project) {
      const action = (body.action ?? "restart") as "start" | "stop" | "restart";
      if (!["start", "stop", "restart"].includes(action)) throw new Error(`unsupported project action ${action}`);
      const result = await adapter.projectAction(body.project, action);
      invalidateEngineCaches();
      return result;
    }

    if (!body.action || !body.target) throw new Error("action and target are required");
    const result = await adapter.action(body.action, body.target, body.payload ?? {});
    invalidateEngineCaches();
    await probeEngine(true);
    return result;
  });
}
