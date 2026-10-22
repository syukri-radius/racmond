import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/ops";
import { metrics, nodes } from "@/db/ops-schema";
import { ensureSeeded } from "@/lib/seed";
import { baselineFor } from "@/lib/seed";
import { engine, startEngine } from "@/lib/telemetry";
import type { NodeStatus, NodeType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES: NodeType[] = [
  "organization",
  "sub_org",
  "project",
  "sub_project",
  "datacenter",
  "namespace",
  "server",
  "container",
  "pod",
  "service_group",
  "service_sub_group",
  "service",
  "endpoint",
  "resource",
];
const VALID_STATUS: NodeStatus[] = ["healthy", "degraded", "critical", "offline", "maintenance"];

/**
 * POST /api/ingest/nodes — register (or update) a hierarchy node from any stack.
 * Parents MUST be registered before children (parents-first rule).
 * Body: { id, parentId?, name, type, kind?, status?, region?, owner?, meta?, sortOrder? }
 */
export async function POST(request: Request) {
  await ensureSeeded();
  await startEngine();
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    parentId?: string | null;
    name?: string;
    type?: string;
    kind?: string | null;
    status?: string;
    region?: string | null;
    owner?: string | null;
    meta?: Record<string, unknown>;
    sortOrder?: number;
  };

  const id = String(body.id ?? "").trim();
  const name = String(body.name ?? "").trim();
  const type = String(body.type ?? "").trim() as NodeType;
  if (!id || !name || !VALID_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "id, name and a valid type are required", validTypes: VALID_TYPES },
      { status: 400 },
    );
  }
  const parentId = body.parentId ? String(body.parentId) : null;
  if (parentId && !engine.type.has(parentId)) {
    return NextResponse.json(
      { error: `parent '${parentId}' is unknown. Register parents before children.` },
      { status: 400 },
    );
  }
  const status: NodeStatus = VALID_STATUS.includes(body.status as NodeStatus)
    ? (body.status as NodeStatus)
    : "healthy";

  const row = {
    id,
    parentId,
    name,
    type,
    kind: body.kind ?? null,
    status,
    region: body.region ?? null,
    owner: body.owner ?? null,
    meta: body.meta ?? {},
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    updatedAt: new Date(),
  };

  await db
    .insert(nodes)
    .values(row)
    .onConflictDoUpdate({
      target: nodes.id,
      set: {
        parentId: sql`excluded.parent_id`,
        name: sql`excluded.name`,
        type: sql`excluded.type`,
        kind: sql`excluded.kind`,
        status: sql`excluded.status`,
        region: sql`excluded.region`,
        owner: sql`excluded.owner`,
        meta: sql`excluded.meta`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  // keep the live engine in sync so the canvas shows the node immediately
  engine.type.set(id, type);
  engine.status.set(id, status);
  engine.name.set(id, name);
  engine.parent.set(id, parentId);
  if (!engine.order.includes(id)) engine.order.push(id);
  if (parentId) {
    const key = parentId;
    const siblings = engine.children.get(key) ?? [];
    if (!siblings.includes(id)) siblings.push(id);
    engine.children.set(key, siblings);
  }
  if (!engine.children.has(id)) engine.children.set(id, []);
  if (type !== "resource" && !engine.live.has(id)) {
    const base = baselineFor(type, status);
    engine.live.set(id, { ...base, updatedAt: new Date().toISOString() });
    engine.target.set(id, {
      cpu: base.cpu,
      memory: base.memory,
      disk: base.disk,
      networkIn: base.networkIn,
      networkOut: base.networkOut,
      requestsPerSec: base.requestsPerSec,
      latencyMs: base.latencyMs,
      errorRate: base.errorRate,
    });
    await db
      .insert(metrics)
      .values({ nodeId: id, ...base, updatedAt: new Date() })
      .onConflictDoNothing();
  }

  return NextResponse.json({ ok: true, node: { id, parentId, name, type, status } });
}

export async function GET() {
  await ensureSeeded();
  const rows = await db.select({ id: nodes.id, type: nodes.type }).from(nodes).limit(5);
  void eq;
  return NextResponse.json({
    hint: "POST { id, parentId, name, type, ... } here. Parents must be registered before children.",
    validTypes: VALID_TYPES,
    sampleCount: rows.length,
  });
}
