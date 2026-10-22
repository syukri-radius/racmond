import { guard, ok, readJson } from "@/lib/api";
import { configRoot, loadWorkspace } from "@/lib/config/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config/scan?path= → bounded workspace scan under CONFIG_ROOT. */
export async function GET(request: Request) {
  return guard(async () => {
    const target = new URL(request.url).searchParams.get("path");
    const result = await loadWorkspace(target);
    return ok({ ...result, configRoot: configRoot() });
  });
}

/** POST /api/config/scan { path? } */
export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ path?: string }>(request).catch(() => ({ path: undefined }));
    return ok(await loadWorkspace(body.path ?? null));
  });
}
