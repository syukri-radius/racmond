import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { nodes as nodesTable } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { engine, startEngine } from "@/lib/telemetry";
import type { NodeStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PatchBody {
  x?: number | null;
  y?: number | null;
  collapsed?: boolean;
  status?: NodeStatus;
}

/** Persists drag offsets (extent: 'parent' relative), collapse state and manual status overrides. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  await startEngine();
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.x === "number" || body.x === null) set.x = body.x;
  if (typeof body.y === "number" || body.y === null) set.y = body.y;
  if (typeof body.collapsed === "boolean") set.collapsed = body.collapsed;
  if (body.status) {
    set.status = body.status;
    engine.status.set(id, body.status);
  }

  const [updated] = await db.update(nodesTable).set(set).where(eq(nodesTable.id, id)).returning();
  if (!updated) {
    return NextResponse.json({ error: "node not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    node: {
      id: updated.id,
      x: updated.x,
      y: updated.y,
      collapsed: updated.collapsed,
      status: updated.status,
    },
  });
}
