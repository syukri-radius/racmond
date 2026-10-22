import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflowRuns, workflows } from "@/db/schema";
import { guard, HttpError, readJson } from "@/lib/api";
import { executeWorkflowRun } from "@/lib/workflows/runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id));
    if (!workflow) throw new HttpError(404, "workflow not found");
    const body = await readJson<{ trigger?: Record<string, unknown> }>(request).catch(() => ({ trigger: undefined as Record<string, unknown> | undefined }));

    const [run] = await db
      .insert(workflowRuns)
      .values({
        id: randomUUID(),
        workflowId: id,
        workflowName: workflow.name,
        status: "pending",
        trigger: body.trigger ?? { manual: true, startedAt: new Date().toISOString() },
        steps: [],
        startedAt: new Date(),
      })
      .returning();

    // fire and forget: the runner persists every transition, the UI polls
    void executeWorkflowRun(run.id, workflow.name).catch(async (error) => {
      await db
        .update(workflowRuns)
        .set({ status: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() })
        .where(eq(workflowRuns.id, run.id));
    });

    return { run };
  });
}
