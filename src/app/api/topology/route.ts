import { NextResponse } from "next/server";
import { getTopologyPayload } from "@/lib/topology-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const payload = await getTopologyPayload();
  return NextResponse.json(payload);
}
