import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, metricSamples, metrics, nodes, commandRuns } from "@/db/schema";
import type { MetricSnapshot, NodeStatus, NodeType, TopologyNode } from "@/lib/types";
import { MONITORED_TYPES } from "@/lib/types";
import { buildSeedTopology, FORCED_STATUSES, SEED_EVENT_TEMPLATES, type SeedNode } from "@/lib/seed/topology";

const globalForSeed = globalThis as typeof globalThis & {
  __opsSeedPromise?: Promise<number>;
  __opsSeeded?: boolean;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(99117);
const between = (min: number, max: number) => min + rnd() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));
const round1 = (n: number) => Math.round(n * 10) / 10;

export function baselineFor(type: NodeType, status: NodeStatus): Omit<MetricSnapshot, "updatedAt"> {
  const stress =
    status === "critical" ? 1 : status === "degraded" ? 0.72 : status === "maintenance" ? 0.2 : status === "offline" ? 0 : 0.45;
  const hostish = type === "server" || type === "container" || type === "pod" || type === "namespace" || type === "datacenter";
  const isEndpoint = type === "endpoint";
  const cpu = status === "offline" ? 0 : round1(between(6, 24) + stress * between(30, 70));
  const memory = status === "offline" ? 0 : round1(between(22, 48) + stress * between(12, 46));
  const disk = status === "offline" ? 0 : round1(between(18, 42) + stress * between(6, 40));
  return {
    cpu,
    memory,
    disk,
    networkIn: hostish ? round1(between(4, 240) * (0.4 + stress)) : round1(between(0.2, 24) * (0.4 + stress)),
    networkOut: hostish ? round1(between(4, 320) * (0.4 + stress)) : round1(between(0.2, 30) * (0.4 + stress)),
    requestsPerSec: isEndpoint ? round1(between(2, 900)) : hostish ? round1(between(50, 4000)) : round1(between(10, 1800)),
    errorRate: status === "critical" ? round1(between(2, 14)) : status === "degraded" ? round1(between(0.4, 2.4)) : round1(between(0, 0.35)),
    latencyMs: round1(between(8, 90) + stress * between(20, 260)),
    uptimePct: status === "offline" ? round1(between(82, 96)) : status === "critical" ? round1(between(97.5, 99.4)) : round1(between(99.9, 99.999)),
    replicasReady: hostish || isEndpoint ? 0 : status === "critical" ? intBetween(0, 2) : intBetween(2, 8),
    replicasDesired: hostish || isEndpoint ? 0 : intBetween(3, 8),
    source: type === "container" ? "docker" : type === "pod" || type === "namespace" ? "kubernetes" : hostish ? "agent" : "prometheus",
  };
}

async function writeSeed() {
  const seedNodes = buildSeedTopology();
  const withOverrides = seedNodes.map((n) =>
    FORCED_STATUSES[n.id] ? { ...n, status: FORCED_STATUSES[n.id] } : n,
  );

  // wipe in FK-safe order (cascade handles the rest)
  await db.delete(commandRuns);
  await db.delete(events);
  await db.delete(metricSamples);
  await db.delete(metrics);
  await db.delete(nodes);

  // CRITICAL RULE: parents are inserted before children (generator already emits them in order)
  for (let i = 0; i < withOverrides.length; i += 100) {
    const chunk = withOverrides.slice(i, i + 100).map((n) => ({
      id: n.id,
      parentId: n.parentId,
      name: n.name,
      type: n.type,
      kind: n.kind,
      status: n.status,
      region: n.region,
      owner: n.owner,
      meta: n.meta,
      sortOrder: n.sortOrder,
      collapsed: false,
      x: null,
      y: null,
    }));
    await db.insert(nodes).values(chunk);
  }

  const monitored = withOverrides.filter((n) => MONITORED_TYPES.has(n.type) && n.type !== "resource");
  const metricRows = monitored.map((n) => ({ nodeId: n.id, ...baselineFor(n.type, n.status) }));
  for (let i = 0; i < metricRows.length; i += 200) {
    await db.insert(metrics).values(metricRows.slice(i, i + 200));
  }

  // ---- 48 points of history per node/metric at 30s resolution (sparkline reference data)
  const now = Date.now();
  const sampleRows: { nodeId: string; metric: string; value: number; ts: Date }[] = [];
  for (const row of metricRows) {
    const seedNode = withOverrides.find((n) => n.id === row.nodeId)!;
    (["cpu", "memory", "disk"] as const).forEach((metric) => {
      const target = row[metric];
      let value = Math.max(0, target - between(6, 22));
      for (let s = 47; s >= 0; s--) {
        value += (target - value) * 0.22 + between(-3.4, 3.4);
        value = Math.min(99.4, Math.max(0.4, value));
        sampleRows.push({
          nodeId: row.nodeId,
          metric,
          value: round1(value),
          ts: new Date(now - s * 30_000),
        });
      }
      void seedNode;
    });
  }
  for (let i = 0; i < sampleRows.length; i += 2000) {
    await db.insert(metricSamples).values(sampleRows.slice(i, i + 2000));
  }

  // ---- historical alert/audit stream
  const eventRows = Array.from({ length: 46 }, (_, i) => {
    const template = SEED_EVENT_TEMPLATES[i % SEED_EVENT_TEMPLATES.length];
    const target = monitored[intBetween(0, monitored.length - 1)];
    return {
      nodeId: target.id,
      severity: template.severity,
      source: template.source,
      title: template.title,
      detail: template.detail,
      acknowledged: i > 12 ? false : rnd() > 0.5,
      ts: new Date(now - (i + 1) * intBetween(35_000, 260_000)),
    };
  });
  await db.insert(events).values(eventRows);

  return withOverrides.length;
}

/** Idempotent bootstrap: seeds the reference dataset the first time it is needed. */
export function ensureSeeded(): Promise<number> {
  if (globalForSeed.__opsSeeded) return Promise.resolve(0);
  if (!globalForSeed.__opsSeedPromise) {
    globalForSeed.__opsSeedPromise = (async () => {
      const [existing] = await db.select({ value: count() }).from(nodes);
      if ((existing?.value ?? 0) > 0) {
        globalForSeed.__opsSeeded = true;
        return existing?.value ?? 0;
      }
      const total = await writeSeed();
      globalForSeed.__opsSeeded = true;
      return total;
    })().finally(() => {
      globalForSeed.__opsSeedPromise = undefined;
    });
  }
  return globalForSeed.__opsSeedPromise;
}

export async function reseed(): Promise<number> {
  globalForSeed.__opsSeeded = false;
  const total = await writeSeed();
  globalForSeed.__opsSeeded = true;
  return total;
}

export function toTopologyNode(row: {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  kind: string | null;
  status: string;
  region: string | null;
  owner: string | null;
  meta: Record<string, unknown>;
  sortOrder: number;
  collapsed: boolean;
  x: number | null;
  y: number | null;
}): TopologyNode {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    type: row.type as NodeType,
    kind: row.kind,
    status: row.status as NodeStatus,
    region: row.region,
    owner: row.owner,
    meta: row.meta,
    sortOrder: row.sortOrder,
    collapsed: row.collapsed,
    x: row.x,
    y: row.y,
  };
}

export async function loadSeries(nodeIds: string[], points = 24) {
  if (nodeIds.length === 0) return {} as Record<string, { cpu: number[]; memory: number[]; disk: number[] }>;
  const since = new Date(Date.now() - 1000 * 60 * 60);
  const rows = await db
    .select({
      nodeId: metricSamples.nodeId,
      metric: metricSamples.metric,
      value: metricSamples.value,
      ts: metricSamples.ts,
    })
    .from(metricSamples)
    .where(and(inArray(metricSamples.nodeId, nodeIds), gte(metricSamples.ts, since)))
    .orderBy(metricSamples.ts);

  const grouped = new Map<string, Map<string, { ts: number; value: number }[]>>();
  for (const row of rows) {
    if (!grouped.has(row.nodeId)) grouped.set(row.nodeId, new Map());
    const byMetric = grouped.get(row.nodeId)!;
    if (!byMetric.has(row.metric)) byMetric.set(row.metric, []);
    byMetric.get(row.metric)!.push({ ts: new Date(row.ts).getTime(), value: row.value });
  }

  const out: Record<string, { cpu: number[]; memory: number[]; disk: number[] }> = {};
  for (const [nodeId, byMetric] of grouped) {
    const series = { cpu: [] as number[], memory: [] as number[], disk: [] as number[] };
    (["cpu", "memory", "disk"] as const).forEach((metric) => {
      const values = byMetric.get(metric) ?? [];
      series[metric] = values.slice(-points).map((v) => v.value);
    });
    out[nodeId] = series;
  }
  return out;
}

export async function recentEvents(limit = 60) {
  const rows = await db
    .select({
      id: events.id,
      nodeId: events.nodeId,
      severity: events.severity,
      source: events.source,
      title: events.title,
      detail: events.detail,
      acknowledged: events.acknowledged,
      ts: events.ts,
      nodeName: nodes.name,
    })
    .from(events)
    .leftJoin(nodes, eq(nodes.id, events.nodeId))
    .orderBy(desc(events.ts))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    nodeId: row.nodeId,
    nodeName: row.nodeName ?? null,
    severity: row.severity as "info" | "warning" | "critical",
    source: row.source,
    title: row.title,
    detail: row.detail,
    acknowledged: row.acknowledged,
    ts: new Date(row.ts).toISOString(),
  }));
}

export { type SeedNode };
