export type JvmKind = "jolokia" | "actuator" | "simulated";

export interface JvmTarget {
  id: string;
  name: string;
  kind: JvmKind;
  url: string | null;
  containerId: string | null;
  note: string | null;
  available: boolean;
  error: string | null;
  discovered: boolean;
}

export interface MemoryPool {
  name: string;
  type: "heap" | "non-heap";
  used: number;
  committed: number;
  max: number;
}

export interface GcCollector {
  name: string;
  collections: number;
  totalTimeMs: number;
  avgPauseMs: number;
  pools: string[];
}

export interface GcEvent {
  at: number;
  collector: string;
  cause: string;
  pauseMs: number;
  reclaimedBytes: number;
}

export type ThreadState = "RUNNABLE" | "BLOCKED" | "WAITING" | "TIMED_WAITING" | "NEW" | "TERMINATED";

export interface JvmThread {
  id: number;
  name: string;
  daemon: boolean;
  priority: number;
  state: ThreadState;
  blockedTimeMs: number;
  blockedCount: number;
  waitedCount: number;
  lockName: string | null;
  lockOwnerId: number | null;
  lockOwnerName: string | null;
  stack: string[];
}

export interface JvmSnapshot {
  targetId: string;
  name: string;
  source: JvmKind;
  fetchedAt: number;
  online: boolean;
  error: string | null;
  identity: {
    vmName: string;
    vmVersion: string;
    vmVendor: string;
    uptimeMs: number;
    pid: number;
    host: string;
    args: string[];
    classPath: string;
    systemProperties: Record<string, string>;
  };
  memory: {
    heapUsed: number;
    heapCommitted: number;
    heapMax: number;
    nonHeapUsed: number;
    nonHeapCommitted: number;
    nonHeapMax: number;
    pools: MemoryPool[];
  };
  gc: {
    collectors: GcCollector[];
    totalCollections: number;
    totalTimeMs: number;
    overheadPct: number;
    events: GcEvent[];
  };
  threadsInfo: {
    live: number;
    daemon: number;
    peak: number;
    started: number;
    blocked: number;
    waiting: number;
    timedWaiting: number;
    deadlocked: number;
  };
  threads: JvmThread[];
  classes: { loaded: number; unloaded: number; total: number };
  cpu: { processPct: number; systemPct: number; loadAverage: number; cpuTimeMs: number };
  nio: { name: string; count: number; memoryUsed: number; memoryCapacity: number }[];
  history: { at: number; heap: number; nonHeap: number; cpu: number; threads: number }[];
}

export interface DeadlockReport {
  detected: boolean;
  cycles: { threads: string[]; lock: string }[];
  message: string;
}

export interface SamplerResult {
  targetId: string;
  /** session handle, present on start/status/stop responses */
  sessionId?: string;
  status: "idle" | "running" | "stopped" | "saved";
  startedAt: number;
  stoppedAt: number | null;
  windowMs: number;
  intervalMs: number;
  samples: number;
  observedThreads: number;
  hotMethods: { method: string; selfPct: number; samples: number; class: string }[];
  allocations: { className: string; bytes: number; pct: number }[];
  callTree: CallTreeNode;
}

export interface CallTreeNode {
  id: string;
  frame: string;
  className: string;
  self: number;
  total: number;
  children: CallTreeNode[];
}

export interface JvmDump {
  id: number;
  targetId: string;
  kind: "thread" | "heap" | "profiler";
  label: string;
  size: number;
  path: string | null;
  summary: Record<string, unknown> | null;
  createdAt: number;
  content?: string | null;
}

export interface MBeanAttribute {
  name: string;
  value: string;
  type: string;
}

export interface MBeanInfo {
  domain: string;
  name: string;
  attributes: MBeanAttribute[];
}

export interface AnatomyNode {
  id: string;
  parentId: string | null;
  title: string;
  subtitle: string;
  kind: string;
  utilization: number | null;
  chips: string[];
}
