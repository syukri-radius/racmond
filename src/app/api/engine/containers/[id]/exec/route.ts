import { guard, readJson, requireString } from "@/lib/api";
import { getEngine } from "@/lib/docker/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    const body = await readJson<{ command?: string }>(request);
    const command = requireString(body.command, "command");
    const { adapter } = await getEngine();
    const result = await adapter.exec(id, command);
    return { ...result, command, containerId: id };
  });
}
