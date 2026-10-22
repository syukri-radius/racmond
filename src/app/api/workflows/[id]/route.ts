import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { workflowRuns, workflows } from "@/db/schema";
import { guard, HttpError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!workflow) throw new HttpError(404, "workflow not found");
    const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, id)).orderBy(desc(workflowRuns.startedAt)).limit(20);
    return { workflow, runs };
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    const body = await readJson<{ name?: string; description?: string; nodes?: unknown[]; edges?: unknown[]; enabled?: boolean }>(request);
    const [workflow] = await db
      .update(workflows)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.nodes !== undefined ? { nodes: body.nodes } : {}),
        ...(body.edges !== undefined ? { edges: body.edges } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, id))
      .returning();
    if (!workflow) throw new HttpError(404, "workflow not found");
    return { workflow };
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    await db.delete(workflows).where(eq(workflows.id, id));
    return { ok: true };
  });
}
