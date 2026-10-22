import { HttpError, guard, ok, readJson } from "@/lib/api";
import { DEMO_COMPOSE, parseCompose } from "@/lib/config/compose";
import { loadCompose } from "@/lib/config/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/config/compose → parses the bundled demo project. */
export async function GET() {
  return guard(async () => {
    const model = parseCompose(DEMO_COMPOSE, "demo-compose.yml");
    return ok({ model });
  });
}

/** POST /api/config/compose { content?, path? } */
export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ content?: string; path?: string }>(request);
    if (!body.content && !body.path) throw new HttpError(400, "provide content or path");
    return ok({ model: await loadCompose({ content: body.content ?? null, path: body.path ?? null }) });
  });
}
