import { NextResponse } from "next/server";
import { db } from "@/db/ops";
import { events } from "@/db/ops-schema";
import { ensureSeeded } from "@/lib/seed";
import { broadcast, engine, startEngine } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_SEVERITY = ["info", "warning", "critical"] as const;
type Severity = (typeof VALID_SEVERITY)[number];

/**
 * POST /api/ingest/events — raise an alert / audit entry from any external system
 * (deploy pipeline, MinIO webhook, DB watchdog, framework exception handler...).
 * Body: { nodeId?, severity?, source?, title, detail? }
 */
export async function POST(request: Request) {
  await ensureSeeded();
  await startEngine();
  const body = (await request.json().catch(() => ({}))) as {
    nodeId?: string | null;
    severity?: string;
    source?: string;
    title?: string;
    detail?: string | null;
  };
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const severity: Severity = VALID_SEVERITY.includes(body.severity as Severity)
    ? (body.severity as Severity)
    : "info";
  const nodeId = body.nodeId ? String(body.nodeId) : null;
  if (nodeId && !engine.type.has(nodeId)) {
    return NextResponse.json({ error: `unknown nodeId '${nodeId}'` }, { status: 404 });
  }
  const source = String(body.source ?? "integration").slice(0, 48);
  const at = new Date();

  const [inserted] = await db
    .insert(events)
    .values({
      nodeId,
      severity,
      source,
      title: title.slice(0, 240),
      detail: body.detail ? String(body.detail).slice(0, 2000) : null,
      acknowledged: false,
      ts: at,
    })
    .returning({ id: events.id });

  const event = {
    id: inserted.id,
    nodeId,
    nodeName: nodeId ? (engine.name.get(nodeId) ?? null) : null,
    severity,
    source,
    title: title.slice(0, 240),
    detail: body.detail ? String(body.detail).slice(0, 2000) : null,
    acknowledged: false,
    ts: at.toISOString(),
  };
  broadcast({ type: "event", event });

  // a critical external alert also escalates the node status on the canvas
  if (nodeId && severity === "critical") {
    const { db: dbClient } = await import("@/db");
    const { nodes } = await import("@/db/ops-schema");
    const { eq } = await import("drizzle-orm");
    await dbClient.update(nodes).set({ status: "critical" }).where(eq(nodes.id, nodeId));
    engine.status.set(nodeId, "critical");
    const snapshot = engine.live.get(nodeId);
    if (snapshot) {
      broadcast({
        type: "metrics",
        at: at.toISOString(),
        updates: [{ nodeId, ...snapshot, status: "critical" }],
      });
    }
  }

  return NextResponse.json({ ok: true, event });
}

export async function GET() {
  return NextResponse.json({
    hint: "POST { nodeId?, severity: info|warning|critical, source?, title, detail? } to raise an alert on the live stream.",
  });
}
