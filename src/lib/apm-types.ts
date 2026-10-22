export type ServiceKind = "gateway" | "service" | "db" | "cache" | "queue" | "external" | "runtime";

export interface ApmAgent {
  agent: string;
  host: string | null;
  runtime: string | null;
  lastSeenAt: number;
  spanCount: number;
}

export interface ApmService {
  key: string;
  name: string;
  team: string | null;
  kind: ServiceKind;
  runtime: string | null;
  slaLatencyMs: number;
  slaErrorRate: number;
  requests: number;
  errors: number;
  errorRate: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  apdex: number;
  callers: string[];
  callees: string[];
  lastSeenAt: number | null;
  agents: ApmAgent[];
  containerName: string | null;
  containerState: string | null;
}

export interface ApmEdge {
  source: string;
  target: string;
  calls: number;
  errors: number;
  avgMs: number;
  errorRate: number;
}

export interface ApmMap {
  services: ApmService[];
  edges: ApmEdge[];
  windowSeconds: number;
  generatedAt: string;
  demo: boolean;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  serviceKey: string;
  operation: string;
  kind: "server" | "client" | "internal";
  startTime: number;
  durationMs: number;
  status: "ok" | "error";
  errorMessage: string | null;
  tags: Record<string, unknown> | null;
}

export interface TraceGroup {
  traceId: string;
  startTime: number;
  durationMs: number;
  status: "ok" | "error";
  errorCount: number;
  services: string[];
  spanCount: number;
  entryOperation: string;
  spans: SpanRecord[];
}

export interface TraceBucket {
  minute: number;
  label: string;
  requests: number;
  errors: number;
}

export interface TracesResponse {
  traces: TraceGroup[];
  buckets: TraceBucket[];
  total: number;
  errorTraces: number;
}

export interface OperationStat {
  operation: string;
  calls: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

export interface ServiceDetail {
  service: ApmService;
  operations: OperationStat[];
  errorSignatures: { message: string; count: number; lastSeen: number }[];
  slowest: SpanRecord[];
  callers: ApmEdge[];
  callees: ApmEdge[];
}

export interface IngestPayload {
  agent?: string;
  service?: string;
  kind?: ServiceKind;
  runtime?: string;
  host?: string;
  spans?: Partial<SpanRecord>[];
}
