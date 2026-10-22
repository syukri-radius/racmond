import { guard, ok, readJson } from "@/lib/api";
import { loadTerraform } from "@/lib/config/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config/terraform?dir= → parses `dir` (or the bundled demo). */
export async function GET(request: Request) {
  return guard(async () => {
    const dir = new URL(request.url).searchParams.get("dir");
    return ok({ model: await loadTerraform({ dir }) });
  });
}

/** POST /api/config/terraform { dir? } | { files: { name: content } } */
export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ dir?: string; files?: Record<string, string> }>(request);
    return ok({ model: await loadTerraform({ dir: body.dir ?? null, files: body.files ?? null }) });
  });
}
