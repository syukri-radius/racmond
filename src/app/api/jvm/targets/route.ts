import { guard, readJson, requireString } from "@/lib/api";
import { addTarget, listTargets, removeTarget } from "@/lib/jvm/service";
import type { JvmTarget } from "@/lib/jvm/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return guard(async () => ({ targets: await listTargets() }));
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ name?: string; kind?: JvmTarget["kind"]; url?: string; containerId?: string }>(request);
    const kind = (body.kind ?? "simulated") as JvmTarget["kind"];
    if (!["jolokia", "actuator", "simulated"].includes(kind)) throw new Error("unsupported target kind");
    const target = await addTarget({
      name: requireString(body.name, "name"),
      kind,
      url: body.url,
      containerId: body.containerId,
    });
    return { target };
  });
}

export async function DELETE(request: Request) {
  return guard(async () => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) throw new Error("id is required");
    await removeTarget(id);
    return { ok: true };
  });
}
