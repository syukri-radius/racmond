import { eq } from "drizzle-orm";
import { db } from "@/db";
import { configSources } from "@/db/schema";
import { HttpError, guard, ok, readJson } from "@/lib/api";
import { deleteSource, getSource, modelForSource, touchSource } from "@/lib/config/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/config/sources/:id?refresh=1 → persisted source, optionally re-parsed. */
export async function GET(request: Request, { params }: Params) {
  return guard(async () => {
    const { id } = await params;
    const row = await getSource(id);
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (!refresh) {
      return ok({
        source: { id: row.id, name: row.name, kind: row.kind, target: row.target, status: row.status, lastError: row.lastError },
      });
    }
    try {
      const model = await modelForSource(row);
      const summary: Record<string, unknown> = {
        kind: model.kind,
        nodes: model.nodes.length,
        edges: model.edges.length,
        findings: "findings" in model ? model.findings.length : model.insights.length,
      };
      await touchSource(id, { status: "loaded", summary });
      return ok({ model });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await touchSource(id, { status: "error", lastError: message });
      throw error instanceof HttpError ? error : new HttpError(400, message);
    }
  });
}

/** PATCH /api/config/sources/:id { name?, target?, content? } */
export async function PATCH(request: Request, { params }: Params) {
  return guard(async () => {
    const { id } = await params;
    const row = await getSource(id);
    const body = await readJson<{ name?: string; target?: string; content?: string }>(request);
    await db
      .update(configSources)
      .set({
        name: body.name?.trim() || row.name,
        target: body.target?.trim() || row.target,
        content: body.content === undefined ? row.content : body.content,
        updatedAt: new Date(),
      })
      .where(eq(configSources.id, id));
    return ok({ ok: true });
  });
}

/** DELETE /api/config/sources/:id */
export async function DELETE(_request: Request, { params }: Params) {
  return guard(async () => {
    const { id } = await params;
    await deleteSource(id);
    return ok({ deleted: id });
  });
}
