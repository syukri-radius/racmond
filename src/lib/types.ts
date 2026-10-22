export type NodeType =
  | "organization"
  | "sub_org"
  | "project"
  | "sub_project"
  | "datacenter"
  | "namespace"
  | "server"
  | "container"
  | "pod"
  | "service_group"
  | "service_sub_group"
  | "service"
  | "endpoint"
  | "resource";

export type NodeStatus = "healthy" | "degraded" | "critical" | "offline" | "maintenance";

export type MetricSource = "prometheus" | "docker" | "kubernetes" | "agent";

export interface MetricSnapshot {
  cpu: number;
  memory: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  requestsPerSec: number;
  errorRate: number;
  latencyMs: number;
  uptimePct: number;
  replicasReady: number;
  replicasDesired: number;
  source: MetricSource;
  updatedAt: string;
}

export interface TopologyNode {
  id: string;
  parentId: string | null;
  name: string;
  type: NodeType;
  kind: string | null;
  status: NodeStatus;
  region: string | null;
  owner: string | null;
  meta: Record<string, unknown>;
  sortOrder: number;
  collapsed: boolean;
  /** persisted manual offset inside the parent container */
  x: number | null;
  y: number | null;
}

export interface EventItem {
  id: number;
  nodeId: string | null;
  nodeName: string | null;
  severity: "info" | "warning" | "critical";
  source: string;
  title: string;
  detail: string | null;
  acknowledged: boolean;
  ts: string;
}

export interface CommandRun {
  id: number;
  nodeId: string | null;
  nodeName: string | null;
  command: string;
  operator: string;
  status: "running" | "success" | "failed";
  exitCode: number | null;
  output: string;
  startedAt: string;
  finishedAt: string | null;
}

export interface TopologyPayload {
  nodes: TopologyNode[];
  metrics: Record<string, MetricSnapshot>;
  series: Record<string, { cpu: number[]; memory: number[]; disk: number[] }>;
  events: EventItem[];
  runs: CommandRun[];
  generatedAt: string;
}

/** Node types rendered as containers that hold children (extent: 'parent'). */
export const GROUP_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
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
]);

/** Node types that carry CPU / memory / disk gauges. */
export const MONITORED_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
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
]);

/** Nodes that always render the 3-gauge strip (CPU / Memory / Disk). */
export const GAUGE_STRIP_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "server",
  "container",
  "pod",
]);

export const NODE_LABEL: Record<NodeType, string> = {
  organization: "Organization",
  sub_org: "Sub-Organization",
  project: "Project",
  sub_project: "Sub-Project",
  datacenter: "Datacenter",
  namespace: "Namespace",
  server: "Server",
  container: "Container",
  pod: "Pod",
  service_group: "Service Group",
  service_sub_group: "Service Sub-Group",
  service: "Service",
  endpoint: "Endpoint",
  resource: "Resource",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  critical: "Critical",
  offline: "Offline",
  maintenance: "Maintenance",
};

export const STATUS_ORDER: NodeStatus[] = ["critical", "degraded", "offline", "maintenance", "healthy"];

/** Fixed intrinsic sizes for leaf nodes (ELK needs a size for non-container nodes). */
export const LEAF_SIZE: Partial<Record<NodeType, { width: number; height: number }>> = {
  service: { width: 224, height: 96 },
  endpoint: { width: 224, height: 66 },
  resource: { width: 108, height: 100 },
};

/** Size used when a container node is collapsed (becomes a leaf for the layout pass). */
export const COLLAPSED_SIZE: Record<string, { width: number; height: number }> = {
  default: { width: 236, height: 66 },
  server: { width: 276, height: 118 },
  container: { width: 268, height: 112 },
  pod: { width: 268, height: 112 },
};

export const MIN_GROUP_SIZE: Partial<Record<NodeType, { width: number; height: number }>> = {
  organization: { width: 344, height: 128 },
  sub_org: { width: 324, height: 120 },
  project: { width: 304, height: 112 },
  sub_project: { width: 288, height: 108 },
  datacenter: { width: 288, height: 108 },
  namespace: { width: 268, height: 104 },
  server: { width: 276, height: 136 },
  container: { width: 268, height: 130 },
  pod: { width: 268, height: 130 },
  service_group: { width: 252, height: 112 },
  service_sub_group: { width: 244, height: 104 },
};

/** Height of the fixed header strip inside each container type (children are laid out below it). */
export const HEADER_HEIGHT: Partial<Record<NodeType, number>> = {
  organization: 54,
  sub_org: 50,
  project: 48,
  sub_project: 46,
  datacenter: 48,
  namespace: 50,
  server: 98,
  container: 94,
  pod: 94,
  service_group: 48,
  service_sub_group: 44,
};

/** Padding inside a container node: sides/bottom are constant, top comes from HEADER_HEIGHT. */
export const GROUP_PADDING = { right: 14, bottom: 14, left: 14 };

export function statusRank(status: NodeStatus): number {
  return STATUS_ORDER.indexOf(status);
}

export function worstStatus(a: NodeStatus, b: NodeStatus): NodeStatus {
  return statusRank(a) <= statusRank(b) ? a : b;
}
