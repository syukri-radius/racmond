import { desc } from "drizzle-orm";
import { db } from "@/db";
import { workflowRuns } from "@/db/schema";
import { guard } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 25)));
  return guard(async () => ({ runs: await db.select().from(workflowRuns).orderBy(desc(workflowRuns.startedAt)).limit(limit) }));
}
