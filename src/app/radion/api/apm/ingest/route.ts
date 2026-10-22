import { NextResponse } from "next/server";
import { guard, readJson } from "@/lib/api";
import { ingestSpans, listAgents } from "@/lib/apm";
import { resetTelemetry } from "@/lib/apm";
import type { IngestPayload } from "@/lib/apm-types";

export const dynamic = "force-dynamic";

const CONTRACT = {
  endpoint: "POST /radion/api/apm/ingest",
  body: {
    agent: "string — agent/collector id, heartbeats on this key",
    service: "string — default serviceKey for spans without one",
    kind: "gateway | service | db | cache | queue | external | runtime",
    runtime: "jvm | node | python | go | rust …",
    host: "string",
    spans: "Span[] (max 2000 per request)",
  },
  span: {
    traceId: "string (generated when omitted)",
    spanId: "string (generated when omitted)",
    parentSpanId: "string | null — pair a client span with its child server span to create a call edge",
    serviceKey: "string",
    operation: "string",
    kind: "server | client | internal",
    startTime: "epoch milliseconds",
    durationMs: "number",
    status: "ok | error",
    errorMessage: "string | null",
    tags: "record<string, unknown>",
  },
  notes: [
    "Blank serviceKey falls back to body.service (or agent).",
    "Spans older than 20 minutes are pruned on every ingest.",
    "Edges are derived from client→server parent/child pairs that cross services.",
    "Aggregates use a 10 minute window; edge rollups keep 60 minutes.",
  ],
};

export async function GET() {
  return guard(async () => ({ contract: CONTRACT, agents: await listAgents() }));
}

export async function POST(request: Request) {
  return guard(async () => {
    const payload = await readJson<IngestPayload>(request);
    const result = await ingestSpans(payload);
    return { ok: true, ...result };
  });
}

export async function DELETE() {
  return guard(async () => {
    const result = await resetTelemetry();
    return NextResponse.json({ ok: true, ...result });
  });
}
