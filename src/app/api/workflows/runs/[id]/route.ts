import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflowRuns } from "@/db/schema";
import { guard, HttpError, readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    if (!run) throw new HttpError(404, "run not found");
    return { run };
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return guard(async () => {
    const body = await readJson<{ action?: string }>(request);
    if (body.action !== "cancel") throw new HttpError(400, "unsupported action");
    await db.update(workflowRuns).set({ cancelRequested: true }).where(eq(workflowRuns.id, id));
    return { ok: true, cancelRequested: true };
  });
}
