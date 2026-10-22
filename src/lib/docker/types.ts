export type Tone = "ok" | "warn" | "bad" | "muted" | "info";

export type ContainerState = "running" | "exited" | "paused" | "restarting" | "created" | "dead";
export type ContainerHealth = "healthy" | "unhealthy" | "starting" | "none";

export interface PortMapping {
  containerPort: number;
  hostPort: number | null;
  hostIp?: string | null;
  protocol: string;
}

export interface MountInfo {
  type: string;
  source: string;
  destination: string;
  mode: string;
  sizeBytes?: number;
}

export interface NetworkAttachment {
  name: string;
  ipAddress: string;
  aliases?: string[];
}

export interface ContainerStats {
  cpuPct: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPct: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
  history?: { cpu: number[]; memory: number[]; net: number[]; block: number[] };
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  imageId: string;
  command: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  state: ContainerState;
  health: ContainerHealth;
  tone: Tone;
  statusText: string;
  exitCode: number | null;
  restartCount: number;
  platform: string;
  composeProject: string | null;
  composeService: string | null;
  ports: PortMapping[];
  networks: NetworkAttachment[];
  mounts: MountInfo[];
  labels: Record<string, string>;
  env: string[];
  cpuPct: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPct: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
  history?: { cpu: number[]; memory: number[]; net: number[]; block: number[] };
}

export interface ImageInfo {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  sizeBytes: number;
  created: string;
  containers: number;
  labels: Record<string, string>;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  sizeBytes: number | null;
  createdAt: string | null;
  usedBy: string[];
  inUse: boolean;
}

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet: string | null;
  gateway: string | null;
  created: string | null;
  containers: { id: string; name: string; ipv4: string }[];
}

export interface EngineInfo {
  id: string;
  name: string;
  serverVersion: string;
  apiVersion: string;
  os: string;
  arch: string;
  kernel: string;
  host: string;
  cpus: number;
  memoryBytes: number;
  storageDriver: string;
  runtime: string;
  loggingDriver: string;
  cgroupVersion: string;
  warnings: string[];
}

export interface EngineEndpointInfo {
  id: string;
  name: string;
  endpoint: string;
  kind: "unix" | "tcp" | "npipe";
  isDefault: boolean;
}

export interface EngineStatus {
  mode: "live" | "demo" | "offline";
  demo: boolean;
  endpoint: string | null;
  endpoints: EngineEndpointInfo[];
  error: string | null;
  engine: EngineInfo | null;
  probedAt: string;
  latencyMs: number | null;
  containerCount?: number;
}

export interface RunSpec {
  image: string;
  name?: string;
  ports?: string[];
  env?: string[];
  command?: string;
  detach?: boolean;
}

export interface ExecResult {
  exitCode: number | null;
  output: string;
  durationMs: number;
}

export interface LogOptions {
  tail?: number;
  timestamps?: boolean;
  since?: number;
}

export interface PruneResult {
  kind: string;
  reclaimedBytes: number;
  details: string[];
}

export interface EngineAdapter {
  kind: "live" | "demo";
  info(): Promise<EngineInfo>;
  containers(): Promise<ContainerInfo[]>;
  container(id: string): Promise<ContainerInfo | null>;
  logs(id: string, options?: LogOptions): Promise<string>;
  exec(id: string, command: string): Promise<ExecResult>;
  images(): Promise<ImageInfo[]>;
  volumes(): Promise<VolumeInfo[]>;
  networks(): Promise<NetworkInfo[]>;
  action(action: string, target: string, payload?: Record<string, unknown>): Promise<{ ok: true; message: string }>;
  run(spec: RunSpec): Promise<{ id: string; name: string }>;
  prune(kind: "images" | "volumes" | "networks" | "containers"): Promise<PruneResult>;
  projectAction(project: string, action: "start" | "stop" | "restart"): Promise<{ ok: true; message: string; affected: number }>;
}

export const TONE_CLASS: Record<Tone, { text: string; dot: string; border: string; bg: string }> = {
  ok: { text: "text-emerald-300", dot: "bg-emerald-400", border: "border-emerald-500/40", bg: "bg-emerald-500/10" },
  warn: { text: "text-amber-300", dot: "bg-amber-400", border: "border-amber-500/40", bg: "bg-amber-500/10" },
  bad: { text: "text-rose-300", dot: "bg-rose-500", border: "border-rose-500/40", bg: "bg-rose-500/10" },
  info: { text: "text-sky-300", dot: "bg-sky-400", border: "border-sky-500/40", bg: "bg-sky-500/10" },
  muted: { text: "text-slate-400", dot: "bg-slate-500", border: "border-line", bg: "bg-slate-500/10" },
};

export function stateTone(state: ContainerState, health: ContainerHealth): Tone {
  if (state === "running") {
    if (health === "unhealthy") return "bad";
    if (health === "starting") return "warn";
    return "ok";
  }
  if (state === "restarting" || state === "paused") return "warn";
  if (state === "exited" || state === "dead") return "muted";
  return "info";
}
