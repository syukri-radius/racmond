import { NextResponse } from "next/server";
import { reseed } from "@/lib/seed";
import { resetEngine } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Rebuilds the reference dataset (hierarchy + metrics + history + events). */
export async function POST() {
  const total = await reseed();
  await resetEngine();
  return NextResponse.json({ ok: true, nodes: total });
}
