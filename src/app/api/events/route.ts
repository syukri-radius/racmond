import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events as eventsTable } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { recentEvents } from "@/lib/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await ensureSeeded();
  const url = new URL(request.url);
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 60));
  const rows = await recentEvents(limit);
  return NextResponse.json({ events: rows });
}

export async function POST(request: Request) {
  await ensureSeeded();
  const body = (await request.json().catch(() => ({}))) as { id?: number; all?: boolean };
  if (body.all) {
    await db.update(eventsTable).set({ acknowledged: true }).where(eq(eventsTable.acknowledged, false));
    return NextResponse.json({ ok: true, acknowledged: "all" });
  }
  if (typeof body.id === "number") {
    await db.update(eventsTable).set({ acknowledged: true }).where(eq(eventsTable.id, body.id));
    return NextResponse.json({ ok: true, acknowledged: body.id });
  }
  return NextResponse.json({ error: "id or all required" }, { status: 400 });
}
