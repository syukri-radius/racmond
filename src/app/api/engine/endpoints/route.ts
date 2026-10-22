import { guard, readJson, requireString } from "@/lib/api";
import { addEndpoint, listEndpoints, removeEndpoint, setDefaultEndpoint } from "@/lib/docker/endpoints";
import { probeEngine } from "@/lib/docker/service";

export const dynamic = "force-dynamic";

export async function GET() {
  return guard(async () => ({ endpoints: await listEndpoints(), status: await probeEngine() }));
}

export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ name?: string; endpoint?: string; makeDefault?: boolean }>(request);
    const endpoint = requireString(body.endpoint, "endpoint");
    const created = await addEndpoint({ name: body.name, endpoint, makeDefault: body.makeDefault });
    const status = await probeEngine(true);
    return { endpoint: created, status };
  });
}

export async function PATCH(request: Request) {
  return guard(async () => {
    const body = await readJson<{ id?: string }>(request);
    await setDefaultEndpoint(requireString(body.id, "id"));
    return { status: await probeEngine(true) };
  });
}

export async function DELETE(request: Request) {
  return guard(async () => {
    const id = new URL(request.url).searchParams.get("id");
    await removeEndpoint(requireString(id, "id"));
    return { status: await probeEngine(true), endpoints: await listEndpoints() };
  });
}
