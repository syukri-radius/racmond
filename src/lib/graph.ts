import type { MetricSnapshot, NodeStatus, NodeType, TopologyNode } from "@/lib/types";
import { GROUP_TYPES, MONITORED_TYPES } from "@/lib/types";

export interface GraphIndexes {
  nodesById: Record<string, TopologyNode>;
  childrenOf: Record<string, string[]>;
  rootIds: string[];
  depthOf: Record<string, number>;
  descendantCount: Record<string, number>;
  leafCount: Record<string, number>;
}

/** Parents always appear before children in the incoming array (critical rule). */
export function buildIndexes(list: TopologyNode[]): GraphIndexes {
  const nodesById: Record<string, TopologyNode> = {};
  const childrenOf: Record<string, string[]> = {};
  const depthOf: Record<string, number> = {};
  const descendantCount: Record<string, number> = {};
  const leafCount: Record<string, number> = {};

  for (const node of list) {
    nodesById[node.id] = node;
    childrenOf[node.id] = [];
  }
  const rootIds: string[] = [];
  for (const node of list) {
    if (node.parentId && nodesById[node.parentId]) {
      childrenOf[node.parentId].push(node.id);
    } else {
      rootIds.push(node.id);
    }
  }
  for (const key of Object.keys(childrenOf)) {
    childrenOf[key].sort((a, b) => nodesById[a].sortOrder - nodesById[b].sortOrder);
  }

  const computeDepth = (id: string, depth: number) => {
    depthOf[id] = depth;
    let descendants = 0;
    let leaves = 0;
    for (const child of childrenOf[id]) {
      const sub = computeDepth(child, depth + 1);
      descendants += sub.descendants + 1;
      leaves += sub.leaves + (childrenOf[child].length === 0 ? 1 : 0);
    }
    descendantCount[id] = descendants;
    leafCount[id] = leaves;
    return { descendants, leaves };
  };
  rootIds.forEach((id) => computeDepth(id, 0));

  return { nodesById, childrenOf, rootIds, depthOf, descendantCount, leafCount };
}

export function descendantsOf(id: string, childrenOf: Record<string, string[]>): string[] {
  const out: string[] = [];
  const stack = [...(childrenOf[id] ?? [])];
  while (stack.length) {
    const current = stack.pop()!;
    out.push(current);
    stack.push(...(childrenOf[current] ?? []));
  }
  return out;
}

export function ancestorsOf(id: string, nodesById: Record<string, TopologyNode>): TopologyNode[] {
  const chain: TopologyNode[] = [];
  let cursor = nodesById[id]?.parentId ?? null;
  while (cursor && nodesById[cursor]) {
    chain.unshift(nodesById[cursor]);
    cursor = nodesById[cursor].parentId;
  }
  return chain;
}

export function initialCollapsed(
  nodesById: Record<string, TopologyNode>,
  depthOf: Record<string, number>,
  maxDepth: number,
): Record<string, boolean> {
  const collapsed: Record<string, boolean> = {};
  for (const id of Object.keys(nodesById)) {
    if (!GROUP_TYPES.has(nodesById[id].type)) continue;
    collapsed[id] = depthOf[id] >= maxDepth;
  }
  return collapsed;
}

export interface Tally {
  total: number;
  healthy: number;
  degraded: number;
  critical: number;
  offline: number;
  maintenance: number;
  monitored: number;
  groups: number;
  endpoints: number;
  cpu: number;
  memory: number;
  disk: number;
  rps: number;
  errorRate: number;
  latency: number;
}

export function tally(list: TopologyNode[], metrics: Record<string, MetricSnapshot>): Tally {
  const result: Tally = {
    total: list.length,
    healthy: 0,
    degraded: 0,
    critical: 0,
    offline: 0,
    maintenance: 0,
    monitored: 0,
    groups: 0,
    endpoints: 0,
    cpu: 0,
    memory: 0,
    disk: 0,
    rps: 0,
    errorRate: 0,
    latency: 0,
  };
  let cpuSum = 0;
  let memSum = 0;
  let diskSum = 0;
  let metricCount = 0;
  for (const node of list) {
    if (node.type === "resource") continue;
    result[node.status] += 1;
    if (GROUP_TYPES.has(node.type)) result.groups += 1;
    if (node.type === "endpoint") result.endpoints += 1;
    if (MONITORED_TYPES.has(node.type)) result.monitored += 1;
    const metric = metrics[node.id];
    if (metric) {
      result.rps += metric.requestsPerSec;
      cpuSum += metric.cpu;
      memSum += metric.memory;
      diskSum += metric.disk;
      metricCount += 1;
    }
  }
  result.cpu = metricCount ? cpuSum / metricCount : 0;
  result.memory = metricCount ? memSum / metricCount : 0;
  result.disk = metricCount ? diskSum / metricCount : 0;
  const leafMetrics = list.filter((n) => !GROUP_TYPES.has(n.type) && n.type !== "resource").map((n) => metrics[n.id]);
  const withLatency = leafMetrics.filter((m): m is MetricSnapshot => Boolean(m) && m.latencyMs > 0);
  result.latency = withLatency.length ? withLatency.reduce((a, m) => a + m.latencyMs, 0) / withLatency.length : 0;
  result.errorRate = withLatency.length ? withLatency.reduce((a, m) => a + m.errorRate, 0) / withLatency.length : 0;
  return result;
}

export function matchesQuery(node: TopologyNode, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  return (
    node.name.toLowerCase().includes(q) ||
    node.id.toLowerCase().includes(q) ||
    (node.kind ?? "").toLowerCase().includes(q) ||
    (node.region ?? "").toLowerCase().includes(q) ||
    (node.owner ?? "").toLowerCase().includes(q)
  );
}

export const STATUS_TONE: Record<NodeStatus, { dot: string; text: string; ring: string; glow: string; label: string }> = {
  healthy: { dot: "bg-emerald-400", text: "text-emerald-300", ring: "ring-emerald-400/30", glow: "shadow-[0_0_18px_-6px_rgba(52,211,153,0.7)]", label: "Healthy" },
  degraded: { dot: "bg-amber-400", text: "text-amber-300", ring: "ring-amber-400/30", glow: "shadow-[0_0_18px_-6px_rgba(251,191,36,0.7)]", label: "Degraded" },
  critical: { dot: "bg-rose-500", text: "text-rose-300", ring: "ring-rose-500/40", glow: "shadow-[0_0_20px_-4px_rgba(244,63,94,0.85)]", label: "Critical" },
  offline: { dot: "bg-slate-500", text: "text-slate-400", ring: "ring-slate-500/30", glow: "", label: "Offline" },
  maintenance: { dot: "bg-sky-400", text: "text-sky-300", ring: "ring-sky-400/30", glow: "", label: "Maintenance" },
};

export function metricTone(value: number): { stroke: string; text: string; bar: string } {
  if (value >= 90) return { stroke: "#f43f5e", text: "text-rose-300", bar: "bg-rose-500" };
  if (value >= 75) return { stroke: "#fbbf24", text: "text-amber-300", bar: "bg-amber-400" };
  return { stroke: "#34d399", text: "text-emerald-300", bar: "bg-emerald-400" };
}

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(digits);
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

export function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(delta / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

export const NODE_TYPE_ABBREV: Record<NodeType, string> = {
  organization: "ORG",
  sub_org: "DIV",
  project: "PRJ",
  sub_project: "SUB",
  datacenter: "DC",
  namespace: "NS",
  server: "SRV",
  container: "CTR",
  pod: "POD",
  service_group: "GRP",
  service_sub_group: "S-GRP",
  service: "SVC",
  endpoint: "EP",
  resource: "RES",
};
