import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/seed";
import { executeRunbook, RUNBOOKS, startEngine } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ runbooks: RUNBOOKS });
}

export async function POST(request: Request) {
  await ensureSeeded();
  await startEngine();
  const body = (await request.json().catch(() => ({}))) as {
    nodeId?: string;
    runbookId?: string;
    operator?: string;
  };
  if (!body.nodeId || !body.runbookId) {
    return NextResponse.json({ error: "nodeId and runbookId are required" }, { status: 400 });
  }
  const run = await executeRunbook(body.nodeId, body.runbookId, body.operator);
  return NextResponse.json({ run });
}
