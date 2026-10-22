import { HttpError, guard, ok, readJson, requireString } from "@/lib/api";
import { listSources, saveSource } from "@/lib/config/service";
import type { ConfigSourceKind } from "@/lib/config/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ConfigSourceKind[] = ["compose", "terraform", "github", "dockerfile", "workspace"];

export async function GET() {
  return guard(async () => ok({ sources: await listSources() }));
}

/** POST /api/config/sources { name, kind, target, content? } */
export async function POST(request: Request) {
  return guard(async () => {
    const body = await readJson<{ name?: string; kind?: string; target?: string; content?: string }>(request);
    const name = requireString(body.name, "name");
    const target = requireString(body.target, "target");
    const kind = requireString(body.kind, "kind") as ConfigSourceKind;
    if (!KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(", ")}`);
    const source = await saveSource({ name, kind, target, content: body.content ?? null });
    return ok({ source }, { status: 201 });
  });
}
