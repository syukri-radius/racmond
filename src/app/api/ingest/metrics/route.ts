import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/ops";
import { metrics } from "@/db/ops-schema";
import { ensureSeeded } from "@/lib/seed";
import { broadcast, engine, startEngine } from "@/lib/telemetry";
import type { MetricSource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/**
 * POST /api/ingest/metrics
 * Push-style ingestion for external collectors (Laravel, Spring, Node, Go, Rust, Python...).
 * Body: { nodeId, cpu, memory, disk, networkIn?, networkOut?, requestsPerSec?, errorRate?, latencyMs?, uptimePct?, replicasReady?, replicasDesired?, source? }
 */
export async function POST(request: Request) {
  await ensureSeeded();
  await startEngine();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const nodeId = String(body.nodeId ?? "").trim();
  if (!nodeId) return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  if (!engine.type.has(nodeId)) {
    return NextResponse.json(
      { error: `unknown nodeId '${nodeId}'. Register it first via POST /api/ingest/nodes` },
      { status: 404 },
    );
  }

  const num = (key: string, fallback: number) => {
    const v = body[key];
    return typeof v === "number" ? v : fallback;
  };
  const prev = engine.live.get(nodeId);
  const snapshot = {
    cpu: clamp(num("cpu", prev?.cpu ?? 0), 0, 100),
    memory: clamp(num("memory", prev?.memory ?? 0), 0, 100),
    disk: clamp(num("disk", prev?.disk ?? 0), 0, 100),
    networkIn: clamp(num("networkIn", prev?.networkIn ?? 0), 0, 4000),
    networkOut: clamp(num("networkOut", prev?.networkOut ?? 0), 0, 5000),
    requestsPerSec: clamp(
      num("requestsPerSec", num("rps", prev?.requestsPerSec ?? 0)),
      0,
      20000,
    ),
    errorRate: clamp(num("errorRate", prev?.errorRate ?? 0), 0, 40),
    latencyMs: clamp(num("latencyMs", num("latency", prev?.latencyMs ?? 10)), 1, 4000),
    uptimePct: clamp(num("uptimePct", prev?.uptimePct ?? 100), 80, 99.999),
    replicasReady: Math.round(num("replicasReady", prev?.replicasReady ?? 0)),
    replicasDesired: Math.round(num("replicasDesired", prev?.replicasDesired ?? 0)),
    source: (["prometheus", "docker", "kubernetes", "agent"].includes(String(body.source))
      ? String(body.source)
      : (prev?.source ?? "agent")) as MetricSource,
    updatedAt: new Date(),
  };

  await db
    .insert(metrics)
    .values({ nodeId, ...snapshot })
    .onConflictDoUpdate({
      target: metrics.nodeId,
      set: {
        cpu: sql`excluded.cpu`,
        memory: sql`excluded.memory`,
        disk: sql`excluded.disk`,
        networkIn: sql`excluded.network_in`,
        networkOut: sql`excluded.network_out`,
        requestsPerSec: sql`excluded.requests_per_sec`,
        errorRate: sql`excluded.error_rate`,
        latencyMs: sql`excluded.latency_ms`,
        uptimePct: sql`excluded.uptime_pct`,
        replicasReady: sql`excluded.replicas_ready`,
        replicasDesired: sql`excluded.replicas_desired`,
        source: sql`excluded.source`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  const iso = snapshot.updatedAt.toISOString();
  engine.live.set(nodeId, { ...snapshot, updatedAt: iso });
  engine.target.set(nodeId, {
    cpu: snapshot.cpu,
    memory: snapshot.memory,
    disk: snapshot.disk,
    networkIn: snapshot.networkIn,
    networkOut: snapshot.networkOut,
    requestsPerSec: snapshot.requestsPerSec,
    latencyMs: snapshot.latencyMs,
    errorRate: snapshot.errorRate,
  });

  // status derived the same way the simulator does
  const current = engine.status.get(nodeId) ?? "healthy";
  if (current !== "offline" && current !== "maintenance") {
    const next =
      snapshot.cpu > 92 || snapshot.errorRate > 5
        ? "critical"
        : snapshot.cpu > 79 || snapshot.errorRate > 1.4 || snapshot.memory > 88
          ? "degraded"
          : "healthy";
    if (next !== current) {
      const { db: dbClient } = await import("@/db");
      const { nodes } = await import("@/db/ops-schema");
      const { eq } = await import("drizzle-orm");
      await dbClient.update(nodes).set({ status: next }).where(eq(nodes.id, nodeId));
      engine.status.set(nodeId, next);
    }
  }

  broadcast({
    type: "metrics",
    at: iso,
    updates: [{ nodeId, ...engine.live.get(nodeId)!, status: engine.status.get(nodeId) }],
  });

  return NextResponse.json({ ok: true, nodeId, at: iso, status: engine.status.get(nodeId) });
}

export async function GET(request: Request) {
  await ensureSeeded();
  await startEngine();
  const url = new URL(request.url);
  const nodeId = url.searchParams.get("nodeId");
  if (nodeId) {
    const snapshot = engine.live.get(nodeId);
    if (!snapshot) return NextResponse.json({ error: "unknown nodeId" }, { status: 404 });
    return NextResponse.json({ nodeId, status: engine.status.get(nodeId), ...snapshot });
  }
  return NextResponse.json({
    hint: "POST metrics here, or GET ?nodeId=<id> for the latest snapshot. Use GET /api/topology for the full estate.",
    ingested: engine.live.size,
  });
}
