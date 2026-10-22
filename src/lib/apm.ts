import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { apmAgents, apmEdges, apmServices, apmSpans } from "@/db/schema";
import { listContainers } from "@/lib/docker/service";
import type {
  ApmEdge,
  ApmMap,
  ApmService,
  IngestPayload,
  OperationStat,
  ServiceDetail,
  ServiceKind,
  SpanRecord,
  TraceBucket,
  TraceGroup,
  TracesResponse,
} from "@/lib/apm-types";

export const APM_WINDOW_SECONDS = 600; // 10 minutes for aggregates + traces
export const APM_SPAN_RETENTION_SECONDS = 1200; // 20 minutes of raw spans
export const APM_EDGE_WINDOW_SECONDS = 3600; // 60 minute edge rollup
const MAX_BATCH = 2000;

/* --------------------------------------------------------------- helpers */

export function classifyKind(image: string, service: string): ServiceKind {
  const haystack = `${image} ${service}`.toLowerCase();
  if (/(gateway|proxy|nginx|traefik|envoy|kong|haproxy|ingress)/.test(haystack)) return "gateway";
  if (/(postgres|mysql|mariadb|mongo|clickhouse|sqlite|cassandra|dynamodb)/.test(haystack)) return "db";
  if (/(redis|memcached|valkey)/.test(haystack)) return "cache";
  if (/(rabbit|kafka|nats|pulsar|activemq|sqs|mq)/.test(haystack)) return "queue";
  if (/(prometheus|grafana|otel|jaeger|tempo|loki|collector|zipkin)/.test(haystack)) return "external";
  return "service";
}

export function runtimeOf(image: string): string {
  const value = image.toLowerCase();
  if (/java|jdk|jre|tomcat|spring/.test(value)) return "jvm";
  if (/node|next|nestjs/.test(value)) return "node";
  if (/python|uvicorn|gunicorn|flask/.test(value)) return "python";
  if (/golang|go1|/i.test(value) && /\bgo\b/.test(value)) return "go";
  if (/rust|axum/.test(value)) return "rust";
  if (/nginx|alpine|debian/.test(value)) return "native";
  return "container";
}

export function serviceKeyFrom(name: string, composeService: string | null): string {
  const base = composeService || name;
  return base
    .replace(/^[a-z0-9]+[-_](?=[a-z])/i, (match) => (/^(vega|observability|shop|prod|dev|staging)[-_]/i.test(match) ? "" : match))
    .replace(/[-_]1$/, "")
    .replace(/[^a-z0-9._-]/gi, "-")
    .toLowerCase();
}

function p95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[index];
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function slaDefaults(kind: ServiceKind): { latency: number; errorRate: number } {
  switch (kind) {
    case "gateway":
      return { latency: 120, errorRate: 0.5 };
    case "db":
      return { latency: 40, errorRate: 0.1 };
    case "cache":
      return { latency: 8, errorRate: 0.05 };
    case "queue":
      return { latency: 25, errorRate: 0.2 };
    case "external":
      return { latency: 900, errorRate: 2 };
    default:
      return { latency: 300, errorRate: 1 };
  }
}

const nowMs = () => Date.now();
const secondsAgo = (seconds: number) => Math.floor(nowMs() / 1000) - seconds;

/* ------------------------------------------------------- service registry */

/** Merges live engine containers, the registry and telemetry-only services. */
export async function deriveServices(): Promise<{ services: ApmService[]; containers: Awaited<ReturnType<typeof listContainers>> }> {
  const [containers, registry, agents] = await Promise.all([
    listContainers().catch(() => []),
    db.select().from(apmServices),
    db.select().from(apmAgents),
  ]);

  const windowStart = secondsAgo(APM_WINDOW_SECONDS) * 1000;
  const spans = await db.select().from(apmSpans).where(gte(apmSpans.startTime, windowStart)).limit(20000);

  const byKey = new Map<string, ApmService>();
  const registryByKey = new Map(registry.map((row) => [row.key, row]));

  const ensure = (key: string, name: string, kind: ServiceKind, runtime: string | null): ApmService => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const registered = registryByKey.get(key);
    const defaults = slaDefaults(kind);
    const service: ApmService = {
      key,
      name,
      team: registered?.team ?? null,
      kind: (registered?.kind as ServiceKind) ?? kind,
      runtime: registered?.runtime ?? runtime,
      slaLatencyMs: registered?.slaLatencyMs ?? defaults.latency,
      slaErrorRate: registered?.slaErrorRate ?? defaults.errorRate,
      requests: 0,
      errors: 0,
      errorRate: 0,
      avgMs: 0,
      p95Ms: 0,
      maxMs: 0,
      apdex: 1,
      callers: [],
      callees: [],
      lastSeenAt: null,
      agents: [],
      containerName: null,
      containerState: null,
    };
    byKey.set(key, service);
    return service;
  };

  for (const container of containers) {
    if (container.state === "paused") continue;
    const key = serviceKeyFrom(container.name, container.composeService);
    const service = ensure(key, container.composeService ?? container.name, classifyKind(container.image, key), runtimeOf(container.image));
    service.containerName = container.name;
    service.containerState = container.state;
  }

  for (const row of registry) {
    ensure(row.key, row.name, row.kind as ServiceKind, row.runtime);
  }
  for (const span of spans) {
    if (!byKey.has(span.serviceKey)) ensure(span.serviceKey, span.serviceKey, "service", null);
  }
  for (const agent of agents) {
    if (!byKey.has(agent.serviceKey)) ensure(agent.serviceKey, agent.serviceKey, "service", agent.runtime);
    byKey.get(agent.serviceKey)?.agents.push({
      agent: agent.agent,
      host: agent.host,
      runtime: agent.runtime,
      lastSeenAt: agent.lastSeenAt.getTime(),
      spanCount: agent.spanCount,
    });
  }

  const durations = new Map<string, number[]>();
  for (const span of spans) {
    const service = byKey.get(span.serviceKey);
    if (!service) continue;
    if (span.kind === "server" || !service.requests) {
      service.requests += 1;
    }
    if (span.status === "error") service.errors += 1;
    service.maxMs = Math.max(service.maxMs, span.durationMs);
    service.lastSeenAt = Math.max(service.lastSeenAt ?? 0, span.startTime);
    const list = durations.get(service.key) ?? [];
    list.push(span.durationMs);
    durations.set(service.key, list);
  }

  const edgeRows = await db.select().from(apmEdges).where(gte(apmEdges.updatedAt, new Date(Date.now() - APM_EDGE_WINDOW_SECONDS * 1000)));
  for (const edge of edgeRows) {
    byKey.get(edge.sourceService)?.callees.push(edge.targetService);
    byKey.get(edge.targetService)?.callers.push(edge.sourceService);
  }

  for (const service of byKey.values()) {
    const list = durations.get(service.key) ?? [];
    service.avgMs = list.length ? round(list.reduce((a, b) => a + b, 0) / list.length) : 0;
    service.p95Ms = round(p95(list));
    service.errorRate = service.requests ? round((service.errors / service.requests) * 100, 2) : 0;
    const tolerated = service.slaLatencyMs * 4;
    const satisfied = list.filter((value) => value <= service.slaLatencyMs).length;
    const tolerating = list.filter((value) => value > service.slaLatencyMs && value <= tolerated).length;
    service.apdex = list.length ? round((satisfied + tolerating / 2) / list.length, 3) : 1;
    service.callers = Array.from(new Set(service.callers));
    service.callees = Array.from(new Set(service.callees));
  }

  const services = Array.from(byKey.values()).sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  return { services, containers };
}

export async function apmMap(): Promise<ApmMap> {
  const { services } = await deriveServices();
  const edges = await db
    .select()
    .from(apmEdges)
    .where(gte(apmEdges.updatedAt, new Date(Date.now() - APM_EDGE_WINDOW_SECONDS * 1000)));
  const derived = edges.length
    ? edges.map<ApmEdge>((edge) => ({
        source: edge.sourceService,
        target: edge.targetService,
        calls: edge.calls,
        errors: edge.errors,
        avgMs: edge.calls ? round(edge.totalMs / edge.calls) : 0,
        errorRate: edge.calls ? round((edge.errors / edge.calls) * 100, 2) : 0,
      }))
    : heuristicEdges(services);
  return {
    services,
    edges: derived,
    windowSeconds: APM_WINDOW_SECONDS,
    generatedAt: new Date().toISOString(),
    demo: false,
  };
}

/** Fallback call graph so the map is legible before any telemetry arrives. */
function heuristicEdges(services: ApmService[]): ApmEdge[] {
  const gateways = services.filter((s) => s.kind === "gateway");
  const runtimes = services.filter((s) => s.kind === "service" || s.kind === "runtime");
  const data = services.filter((s) => ["db", "cache", "queue"].includes(s.kind));
  const edges: ApmEdge[] = [];
  const add = (source: string, target: string) => {
    if (source === target) return;
    if (edges.some((e) => e.source === source && e.target === target)) return;
    edges.push({ source, target, calls: 0, errors: 0, avgMs: 0, errorRate: 0 });
  };
  for (const gateway of gateways) {
    for (const runtime of runtimes.filter((r) => /api|web|app|frontend/.test(r.key)).slice(0, 3)) add(gateway.key, runtime.key);
  }
  const entry = runtimes.find((r) => /api|web|app/.test(r.key)) ?? runtimes[0];
  if (entry) {
    for (const runtime of runtimes.filter((r) => r.key !== entry.key)) add(entry.key, runtime.key);
    for (const store of data) add(entry.key, store.key);
  }
  return edges.slice(0, 40);
}

/* ---------------------------------------------------------------- ingest */

export async function ingestSpans(payload: IngestPayload): Promise<{
  accepted: number;
  rejected: number;
  services: number;
  edges: number;
  pruned: number;
}> {
  const spans = (payload.spans ?? []).slice(0, MAX_BATCH);
  if (!spans.length) return { accepted: 0, rejected: 0, services: 0, edges: 0, pruned: 0 };

  const fallbackService = payload.service ?? payload.agent ?? "unknown-service";
  const serviceKeys = new Map<string, { kind: ServiceKind; runtime: string | null }>();

  const rows = spans
    .filter((span) => typeof span.operation === "string" && Number.isFinite(Number(span.durationMs)))
    .map((span) => {
      const serviceKey = span.serviceKey ?? fallbackService;
      const kind = (payload.kind ?? "service") as ServiceKind;
      if (!serviceKeys.has(serviceKey)) serviceKeys.set(serviceKey, { kind, runtime: payload.runtime ?? null });
      return {
        traceId: span.traceId ?? randomUUID().replace(/-/g, ""),
        spanId: span.spanId ?? randomUUID().replace(/-/g, "").slice(0, 16),
        parentSpanId: span.parentSpanId ?? null,
        serviceKey,
        operation: span.operation as string,
        kind: (span.kind ?? "server") as "server" | "client" | "internal",
        startTime: Number(span.startTime ?? Date.now()),
        durationMs: Number(span.durationMs ?? 0),
        status: (span.status ?? "ok") as "ok" | "error",
        errorMessage: span.errorMessage ?? null,
        tags: span.tags ?? null,
        createdAt: new Date(),
      };
    });

  await db.insert(apmSpans).values(rows);

  for (const [key, meta] of serviceKeys) {
    const defaults = slaDefaults(meta.kind);
    await db
      .insert(apmServices)
      .values({
        id: randomUUID(),
        key,
        name: key,
        kind: meta.kind,
        runtime: meta.runtime,
        slaLatencyMs: defaults.latency,
        slaErrorRate: defaults.errorRate,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({ target: apmServices.key, set: { updatedAt: new Date() } });
  }

  if (payload.agent) {
    const serviceKey = payload.service ?? serviceKeys.keys().next().value ?? fallbackService;
    await db
      .insert(apmAgents)
      .values({
        id: randomUUID(),
        agent: payload.agent,
        serviceKey,
        host: payload.host ?? null,
        runtime: payload.runtime ?? null,
        lastSeenAt: new Date(),
        spanCount: rows.length,
      })
      .onConflictDoUpdate({
        target: apmAgents.agent,
        set: {
          lastSeenAt: new Date(),
          spanCount: sql`${apmAgents.spanCount} + ${rows.length}`,
          serviceKey,
          host: payload.host ?? null,
          runtime: payload.runtime ?? null,
        },
      });
  }

  const edgeCount = await rollupEdges(rows);
  const pruned = await pruneSpans();

  return {
    accepted: rows.length,
    rejected: spans.length - rows.length,
    services: serviceKeys.size,
    edges: edgeCount,
    pruned,
  };
}

/**
 * The call graph is derived, not declared: every client span is paired with its
 * child server span, and only pairs that cross a service boundary become edges.
 */
async function rollupEdges(rows: (typeof apmSpans.$inferInsert)[]): Promise<number> {
  const traceIds = Array.from(new Set(rows.map((row) => row.traceId)));
  if (!traceIds.length) return 0;
  const traceSpans = await db
    .select({
      traceId: apmSpans.traceId,
      spanId: apmSpans.spanId,
      parentSpanId: apmSpans.parentSpanId,
      serviceKey: apmSpans.serviceKey,
      kind: apmSpans.kind,
      status: apmSpans.status,
      durationMs: apmSpans.durationMs,
      startTime: apmSpans.startTime,
    })
    .from(apmSpans)
    .where(inArray(apmSpans.traceId, traceIds.slice(0, 400)));

  const byTrace = new Map<string, typeof traceSpans>();
  for (const span of traceSpans) {
    const list = byTrace.get(span.traceId) ?? [];
    list.push(span);
    byTrace.set(span.traceId, list);
  }

  const pairs = new Map<string, { source: string; target: string; calls: number; errors: number; totalMs: number }>();
  for (const list of byTrace.values()) {
    const byId = new Map(list.map((span) => [span.spanId, span]));
    for (const span of list) {
      if (span.kind !== "client" || !span.parentSpanId) continue;
      const child = list.find(
        (candidate) =>
          candidate.parentSpanId === span.spanId &&
          candidate.kind === "server" &&
          candidate.serviceKey !== span.serviceKey,
      ) ?? (byId.get(span.spanId) ? undefined : undefined);
      if (!child) continue;
      const key = `${span.serviceKey}->${child.serviceKey}`;
      const entry = pairs.get(key) ?? { source: span.serviceKey, target: child.serviceKey, calls: 0, errors: 0, totalMs: 0 };
      entry.calls += 1;
      entry.totalMs += span.durationMs;
      if (span.status === "error" || child.status === "error") entry.errors += 1;
      pairs.set(key, entry);
    }
  }

  let count = 0;
  for (const entry of pairs.values()) {
    await db
      .insert(apmEdges)
      .values({
        id: randomUUID(),
        sourceService: entry.source,
        targetService: entry.target,
        calls: entry.calls,
        errors: entry.errors,
        totalMs: entry.totalMs,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [apmEdges.sourceService, apmEdges.targetService],
        set: {
          calls: sql`${apmEdges.calls} + ${entry.calls}`,
          errors: sql`${apmEdges.errors} + ${entry.errors}`,
          totalMs: sql`${apmEdges.totalMs} + ${entry.totalMs}`,
          updatedAt: new Date(),
        },
      });
    count += 1;
  }
  return count;
}

export async function pruneSpans(): Promise<number> {
  const cutoff = nowMs() - APM_SPAN_RETENTION_SECONDS * 1000;
  const result = await db.delete(apmSpans).where(lt(apmSpans.startTime, cutoff)).returning({ id: apmSpans.id });
  await db.delete(apmEdges).where(lt(apmEdges.updatedAt, new Date(nowMs() - APM_EDGE_WINDOW_SECONDS * 1000)));
  return result.length;
}

/* ----------------------------------------------------------------- query */

export async function tracesResponse(filters: {
  service?: string;
  status?: "ok" | "error" | "";
  minDuration?: number;
  limit?: number;
} = {}): Promise<TracesResponse> {
  const windowStart = nowMs() - APM_WINDOW_SECONDS * 1000;
  const conditions = [gte(apmSpans.startTime, windowStart)];
  if (filters.service) conditions.push(eq(apmSpans.serviceKey, filters.service));
  if (filters.status) conditions.push(eq(apmSpans.status, filters.status));

  const rows = await db
    .select()
    .from(apmSpans)
    .where(and(...conditions))
    .orderBy(desc(apmSpans.startTime))
    .limit(12000);

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = groups.get(row.traceId) ?? [];
    list.push(row);
    groups.set(row.traceId, list);
  }

  const traces: TraceGroup[] = [];
  for (const [traceId, list] of groups) {
    const sorted = [...list].sort((a, b) => a.startTime - b.startTime);
    const start = sorted[0].startTime;
    const end = Math.max(...sorted.map((span) => span.startTime + span.durationMs));
    const duration = end - start;
    if (filters.minDuration && duration < filters.minDuration) continue;
    const hasError = sorted.some((span) => span.status === "error");
    if (filters.status === "error" && !hasError) continue;
    if (filters.status === "ok" && hasError) continue;
    const root = sorted.find((span) => !span.parentSpanId) ?? sorted[0];
    traces.push({
      traceId,
      startTime: start,
      durationMs: round(duration),
      status: hasError ? "error" : "ok",
      errorCount: sorted.filter((span) => span.status === "error").length,
      services: Array.from(new Set(sorted.map((span) => span.serviceKey))),
      spanCount: sorted.length,
      entryOperation: `${root.serviceKey} · ${root.operation}`,
      spans: sorted.map(toSpanRecord),
    });
  }

  traces.sort((a, b) => b.startTime - a.startTime);

  const allSpans = rows;
  const minuteBuckets = new Map<number, { requests: number; errors: number }>();
  const bucketCount = 30;
  const bucketMs = (APM_WINDOW_SECONDS * 1000) / bucketCount;
  const base = Math.floor(windowStart / bucketMs) * bucketMs;
  for (let i = 0; i < bucketCount; i += 1) minuteBuckets.set(base + i * bucketMs, { requests: 0, errors: 0 });
  for (const span of allSpans) {
    const index = Math.floor((span.startTime - base) / bucketMs);
    const key = base + index * bucketMs;
    const bucket = minuteBuckets.get(key);
    if (!bucket) continue;
    bucket.requests += 1;
    if (span.status === "error") bucket.errors += 1;
  }
  const buckets: TraceBucket[] = Array.from(minuteBuckets.entries()).map(([minute, value]) => ({
    minute,
    label: new Date(minute).toISOString().slice(11, 16),
    requests: value.requests,
    errors: value.errors,
  }));

  return {
    traces: traces.slice(0, filters.limit ?? 40),
    buckets,
    total: traces.length,
    errorTraces: traces.filter((trace) => trace.status === "error").length,
  };
}

function toSpanRecord(row: typeof apmSpans.$inferSelect): SpanRecord {
  return {
    traceId: row.traceId,
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    serviceKey: row.serviceKey,
    operation: row.operation,
    kind: row.kind as SpanRecord["kind"],
    startTime: row.startTime,
    durationMs: row.durationMs,
    status: row.status as SpanRecord["status"],
    errorMessage: row.errorMessage,
    tags: row.tags ?? null,
  };
}

export async function serviceDetail(key: string): Promise<ServiceDetail> {
  const windowStart = nowMs() - APM_WINDOW_SECONDS * 1000;
  const spans = await db
    .select()
    .from(apmSpans)
    .where(and(eq(apmSpans.serviceKey, key), gte(apmSpans.startTime, windowStart)))
    .orderBy(desc(apmSpans.startTime))
    .limit(5000);

  const { services } = await deriveServices();
  const service = services.find((entry) => entry.key === key);
  if (!service) throw new Error(`service ${key} not found`);

  const ops = new Map<string, { calls: number; errors: number; durations: number[] }>();
  for (const span of spans) {
    const entry = ops.get(span.operation) ?? { calls: 0, errors: 0, durations: [] };
    entry.calls += 1;
    entry.durations.push(span.durationMs);
    if (span.status === "error") entry.errors += 1;
    ops.set(span.operation, entry);
  }
  const operations: OperationStat[] = Array.from(ops.entries())
    .map(([operation, entry]) => ({
      operation,
      calls: entry.calls,
      errors: entry.errors,
      avgMs: round(entry.durations.reduce((a, b) => a + b, 0) / entry.calls),
      p95Ms: round(p95(entry.durations)),
    }))
    .sort((a, b) => b.calls - a.calls);

  const signatures = new Map<string, { count: number; lastSeen: number }>();
  for (const span of spans) {
    if (span.status !== "error") continue;
    const message = span.errorMessage ?? "error";
    const entry = signatures.get(message) ?? { count: 0, lastSeen: 0 };
    entry.count += 1;
    entry.lastSeen = Math.max(entry.lastSeen, span.startTime);
    signatures.set(message, entry);
  }

  const edges = await db.select().from(apmEdges);
  const toEdge = (row: typeof apmEdges.$inferSelect): ApmEdge => ({
    source: row.sourceService,
    target: row.targetService,
    calls: row.calls,
    errors: row.errors,
    avgMs: row.calls ? round(row.totalMs / row.calls) : 0,
    errorRate: row.calls ? round((row.errors / row.calls) * 100, 2) : 0,
  });

  return {
    service,
    operations,
    errorSignatures: Array.from(signatures.entries())
      .map(([message, entry]) => ({ message, count: entry.count, lastSeen: entry.lastSeen }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    slowest: spans
      .slice()
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 8)
      .map(toSpanRecord),
    callers: edges.filter((edge) => edge.targetService === key).map(toEdge),
    callees: edges.filter((edge) => edge.sourceService === key).map(toEdge),
  };
}

/* ------------------------------------------------------------- simulator */

/**
 * Synthetic traffic that writes REAL rows: walks the derived call graph from the
 * entry service up to depth 3, ~15% errors and ~28% slow spans, emits
 * client+server pairs (+ a db/cache child) and feeds them through ingestSpans.
 */
export async function simulateTraffic(batch = 8): Promise<{ traces: number; spans: number; edges: number }> {
  const map = await apmMap();
  const services = map.services.filter((service) => service.containerState !== "exited" || service.requests > 0);
  if (!services.length) return { traces: 0, spans: 0, edges: 0 };
  const byKey = new Map(services.map((service) => [service.key, service]));
  const adjacency = new Map<string, string[]>();
  for (const edge of map.edges) {
    const list = adjacency.get(edge.source) ?? [];
    if (byKey.has(edge.target)) list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const entry =
    services.find((service) => service.kind === "gateway") ??
    services.find((service) => /api|web|app/.test(service.key)) ??
    services[0];

  const operations = ["GET /", "POST /checkout", "GET /catalog", "GET /orders/{id}", "POST /login", "GET /healthz", "PUT /cart"];
  const errors = [
    "upstream timeout after 3000ms",
    "connection refused: dial tcp 172.20.0.11:5432",
    "HTTP 502 from orders",
    "context deadline exceeded",
    "OOMKilled: exit status 137",
  ];

  const spans: Partial<SpanRecord>[] = [];
  let traces = 0;

  for (let i = 0; i < batch; i += 1) {
    const traceId = randomUUID().replace(/-/g, "");
    const startedAt = Date.now();
    traces += 1;
    const slowTrace = Math.random() < 0.28;
    const errorTrace = Math.random() < 0.15;
    let parentSpanId: string | null = null;
    let cursor = startedAt;
    let current = entry.key;
    const visited = new Set<string>([current]);

    for (let depth = 0; depth < 4; depth += 1) {
      const isEntry = depth === 0;
      const operation = isEntry ? operations[Math.floor(Math.random() * operations.length)] : `call ${current}`;
      const baseDuration = slowTrace ? 380 + Math.random() * 900 : 12 + Math.random() * 120;
      const target = byKey.get(current);
      const duration = Math.max(4, baseDuration * (target?.kind === "db" ? 0.4 : target?.kind === "cache" ? 0.2 : 1));
      const serviceSpanId = randomUUID().replace(/-/g, "").slice(0, 16);
      const failed = errorTrace && Math.random() < 0.6;

      spans.push({
        traceId,
        spanId: serviceSpanId,
        parentSpanId,
        serviceKey: current,
        operation,
        kind: depth === 0 ? "server" : "server",
        startTime: Math.round(cursor),
        durationMs: round(duration, 2),
        status: failed ? "error" : "ok",
        errorMessage: failed ? errors[Math.floor(Math.random() * errors.length)] : null,
        tags: { "http.method": operation.split(" ")[0], "deployment.environment": "production" },
      });

      const next = (adjacency.get(current) ?? []).filter((key) => !visited.has(key))[0];
      if (!next) break;
      const clientSpanId = randomUUID().replace(/-/g, "").slice(0, 16);
      spans.push({
        traceId,
        spanId: clientSpanId,
        parentSpanId: serviceSpanId,
        serviceKey: current,
        operation: `call ${next}`,
        kind: "client",
        startTime: Math.round(cursor + duration * 0.15),
        durationMs: round(duration * 0.8, 2),
        status: failed ? "error" : "ok",
        errorMessage: failed ? errors[Math.floor(Math.random() * errors.length)] : null,
        tags: { "peer.service": next },
      });
      parentSpanId = clientSpanId;
      cursor += duration * 0.15;
      current = next;
      visited.add(current);

      const targetKind = byKey.get(current)?.kind;
      if (targetKind === "db" || targetKind === "cache") {
        spans.push({
          traceId,
          spanId: randomUUID().replace(/-/g, "").slice(0, 16),
          parentSpanId: clientSpanId,
          serviceKey: current,
          operation: targetKind === "db" ? "SELECT orders WHERE id=$1" : "GET session:{id}",
          kind: "internal",
          startTime: Math.round(cursor),
          durationMs: round(Math.random() * (targetKind === "db" ? 22 : 4) + 1, 2),
          status: "ok",
          errorMessage: null,
          tags: null,
        });
        break;
      }
    }
  }

  const result = await ingestSpans({ agent: "dockflow-simulator", service: entry.key, spans });
  return { traces, spans: result.accepted, edges: result.edges };
}

export async function resetTelemetry(): Promise<{ cleared: boolean }> {
  await db.delete(apmSpans);
  await db.delete(apmEdges);
  await db.delete(apmAgents);
  return { cleared: true };
}

export async function listAgents() {
  return db.select().from(apmAgents).orderBy(desc(apmAgents.lastSeenAt)).limit(50);
}

export async function ensureServiceRegistry(): Promise<void> {
  const { services } = await deriveServices();
  const existing = await db.select({ key: apmServices.key }).from(apmServices);
  const known = new Set(existing.map((row) => row.key));
  const missing = services.filter((service) => !known.has(service.key));
  if (!missing.length) return;
  await db
    .insert(apmServices)
    .values(
      missing.map((service) => ({
        id: randomUUID(),
        key: service.key,
        name: service.name,
        team: /auth|orders|checkout/i.test(service.key) ? "commerce" : /postgres|redis|rabbit/i.test(service.key) ? "platform" : "sre",
        kind: service.kind,
        runtime: service.runtime,
        slaLatencyMs: service.slaLatencyMs,
        slaErrorRate: service.slaErrorRate,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    )
    .onConflictDoNothing();
}
