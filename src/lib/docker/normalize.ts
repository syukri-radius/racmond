import type {
  ContainerHealth,
  ContainerInfo,
  ContainerState,
  ContainerStats,
  EngineInfo,
  ImageInfo,
  NetworkInfo,
  Tone,
  VolumeInfo,
} from "./types";
import { stateTone } from "./types";

/* Dockerode payloads are not fully typed — these are the fields we consume. */
export interface RawContainerSummary {
  Id: string;
  Names?: string[];
  Image?: string;
  ImageID?: string;
  Command?: string;
  Created?: number;
  State?: string;
  Status?: string;
  Ports?: { IP?: string; PrivatePort?: number; PublicPort?: number; Type?: string }[];
  Labels?: Record<string, string>;
}

export interface RawContainerInspect {
  Id: string;
  Name: string;
  Created: string;
  State?: {
    Status?: string;
    Running?: boolean;
    Paused?: boolean;
    Restarting?: boolean;
    ExitCode?: number;
    StartedAt?: string;
    FinishedAt?: string;
    Health?: { Status?: string };
  };
  RestartCount?: number;
  Config?: { Image?: string; Cmd?: string[]; Env?: string[]; Labels?: Record<string, string> };
  HostConfig?: { NetworkMode?: string };
  Platform?: string;
  Mounts?: { Type?: string; Name?: string; Source?: string; Destination?: string; Mode?: string }[];
  NetworkSettings?: {
    Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null>;
    Networks?: Record<string, { IPAddress?: string; Aliases?: string[] | null }>;
  };
}

export interface RawStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number; stats?: Record<string, number> };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
  blkio_stats?: { io_service_bytes_recursive?: { op?: string; value?: number }[] | null };
  pids_stats?: { current?: number };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function mapState(raw: string | undefined): ContainerState {
  switch (raw) {
    case "running":
    case "paused":
    case "restarting":
    case "created":
    case "dead":
      return raw;
    case "exited":
    case "removing":
      return "exited";
    default:
      return "created";
  }
}

export function mapHealth(raw: string | undefined): ContainerHealth {
  if (raw === "healthy" || raw === "unhealthy" || raw === "starting") return raw;
  return "none";
}

/** CPU% from cpu_stats deltas × online CPUs (Docker CLI formula). */
export function computeCpuPct(stats: RawStats): number {
  const cpu = stats.cpu_stats;
  const pre = stats.precpu_stats;
  if (!cpu || !pre) return 0;
  const cpuDelta = num(cpu.cpu_usage?.total_usage) - num(pre.cpu_usage?.total_usage);
  const systemDelta = num(cpu.system_cpu_usage) - num(pre.system_cpu_usage);
  const online = num(cpu.online_cpus, cpu.cpu_usage?.percpu_usage?.length ?? 1) || 1;
  if (systemDelta <= 0 || cpuDelta <= 0) return 0;
  return Math.min(100 * online, (cpuDelta / systemDelta) * online * 100);
}

/** Memory usage minus inactive file / cache, like `docker stats`. */
export function computeMemory(stats: RawStats): { usage: number; limit: number; pct: number } {
  const mem = stats.memory_stats ?? {};
  const rawUsage = num(mem.usage);
  const detail = mem.stats ?? {};
  const inactiveFile = num(detail.total_inactive_file, num(detail.inactive_file));
  const usage = Math.max(0, rawUsage - inactiveFile);
  const limit = num(mem.limit);
  const pct = limit > 0 ? (usage / limit) * 100 : 0;
  return { usage, limit, pct };
}

export function normalizeStats(stats: RawStats): ContainerStats {
  const memory = computeMemory(stats);
  let rx = 0;
  let tx = 0;
  for (const iface of Object.values(stats.networks ?? {})) {
    rx += num(iface.rx_bytes);
    tx += num(iface.tx_bytes);
  }
  let read = 0;
  let write = 0;
  for (const entry of stats.blkio_stats?.io_service_bytes_recursive ?? []) {
    const op = (entry.op ?? "").toLowerCase();
    if (op === "read") read += num(entry.value);
    if (op === "write") write += num(entry.value);
  }
  return {
    cpuPct: Math.round(computeCpuPct(stats) * 100) / 100,
    memoryBytes: memory.usage,
    memoryLimitBytes: memory.limit,
    memoryPct: Math.round(memory.pct * 100) / 100,
    netRxBytes: rx,
    netTxBytes: tx,
    blockReadBytes: read,
    blockWriteBytes: write,
    pids: num(stats.pids_stats?.current),
  };
}

export function normalizeContainer(
  summary: RawContainerSummary | null,
  inspect: RawContainerInspect | null,
  stats: ContainerStats | null,
  history?: ContainerInfo["history"],
): ContainerInfo {
  const state = mapState(inspect?.State?.Status ?? summary?.State);
  const health = mapHealth(inspect?.State?.Health?.Status);
  const labels = inspect?.Config?.Labels ?? summary?.Labels ?? {};
  const ports = summary?.Ports?.length
    ? summary.Ports.map((port) => ({
        containerPort: num(port.PrivatePort),
        hostPort: port.PublicPort ?? null,
        hostIp: port.IP ?? null,
        protocol: port.Type ?? "tcp",
      }))
    : Object.entries(inspect?.NetworkSettings?.Ports ?? {}).flatMap(([key, bindings]) => {
        const [port, protocol] = key.split("/");
        if (!bindings?.length) {
          return [{ containerPort: Number(port), hostPort: null, hostIp: null, protocol: protocol ?? "tcp" }];
        }
        return bindings.map((binding) => ({
          containerPort: Number(port),
          hostPort: binding.HostPort ? Number(binding.HostPort) : null,
          hostIp: binding.HostIp ?? null,
          protocol: protocol ?? "tcp",
        }));
      });

  const networks = Object.entries(inspect?.NetworkSettings?.Networks ?? {}).map(([name, network]) => ({
    name,
    ipAddress: network.IPAddress ?? "",
    aliases: (network.Aliases ?? []).filter(Boolean) as string[],
  }));

  const mounts = (inspect?.Mounts ?? []).map((mount) => ({
    type: mount.Type ?? "volume",
    source: mount.Name || mount.Source || "",
    destination: mount.Destination ?? "",
    mode: mount.Mode ?? "rw",
  }));

  const exitCode = inspect?.State?.ExitCode ?? null;
  const tone: Tone = stateTone(state, health);

  return {
    id: inspect?.Id ?? summary?.Id ?? "",
    name: (inspect?.Name ?? summary?.Names?.[0] ?? "").replace(/^\//, ""),
    image: inspect?.Config?.Image ?? summary?.Image ?? "",
    imageId: summary?.ImageID ?? "",
    command: (inspect?.Config?.Cmd ?? []).join(" ") || summary?.Command || "",
    createdAt: inspect?.Created ?? new Date(num(summary?.Created) * 1000).toISOString(),
    startedAt: inspect?.State?.StartedAt && !inspect.State.StartedAt.startsWith("0001") ? inspect.State.StartedAt : null,
    finishedAt: inspect?.State?.FinishedAt && !inspect.State.FinishedAt.startsWith("0001") ? inspect.State.FinishedAt : null,
    state,
    health,
    tone,
    statusText: summary?.Status ?? `${state}${exitCode !== null ? ` (${exitCode})` : ""}`,
    exitCode,
    restartCount: num(inspect?.RestartCount),
    platform: inspect?.Platform ?? "linux/amd64",
    composeProject: labels["com.docker.compose.project"] ?? null,
    composeService: labels["com.docker.compose.service"] ?? null,
    ports,
    networks,
    mounts,
    labels,
    env: inspect?.Config?.Env ?? [],
    cpuPct: stats?.cpuPct ?? 0,
    memoryBytes: stats?.memoryBytes ?? 0,
    memoryLimitBytes: stats?.memoryLimitBytes ?? 0,
    memoryPct: stats?.memoryPct ?? 0,
    netRxBytes: stats?.netRxBytes ?? 0,
    netTxBytes: stats?.netTxBytes ?? 0,
    blockReadBytes: stats?.blockReadBytes ?? 0,
    blockWriteBytes: stats?.blockWriteBytes ?? 0,
    pids: stats?.pids ?? 0,
    history,
  };
}

export function normalizeEngine(info: Record<string, unknown>, version: Record<string, unknown>): EngineInfo {
  const warnings = Array.isArray(info.Warnings) ? (info.Warnings as string[]) : [];
  return {
    id: str(info.ID),
    name: str(info.Name, "docker"),
    serverVersion: str(version.Version, "unknown"),
    apiVersion: str(version.ApiVersion, "unknown"),
    os: str(info.OperatingSystem, str(version.Os, "unknown")),
    arch: str(info.Architecture, str(version.Arch, "unknown")),
    kernel: str(info.KernelVersion),
    host: str(info.Name),
    cpus: num(info.NCPU),
    memoryBytes: num(info.MemTotal),
    storageDriver: str(info.Driver),
    runtime: str(info.DefaultRuntime),
    loggingDriver: str(info.LoggingDriver),
    cgroupVersion: str(info.CgroupVersion),
    warnings,
  };
}

export function normalizeImage(raw: Record<string, unknown>): ImageInfo {
  const tags = Array.isArray(raw.RepoTags) ? (raw.RepoTags as string[]) : [];
  return {
    id: str(raw.Id),
    repoTags: tags.length ? tags : ["<none>:<none>"],
    repoDigests: Array.isArray(raw.RepoDigests) ? (raw.RepoDigests as string[]) : [],
    sizeBytes: num(raw.Size),
    created: new Date(num(raw.Created) * 1000).toISOString(),
    containers: num(raw.Containers),
    labels: (raw.Labels as Record<string, string>) ?? {},
  };
}

export function normalizeVolume(raw: Record<string, unknown>, usedBy: string[]): VolumeInfo {
  return {
    name: str(raw.Name),
    driver: str(raw.Driver, "local"),
    mountpoint: str(raw.Mountpoint),
    sizeBytes: typeof raw.UsageData === "object" && raw.UsageData ? num((raw.UsageData as { Size?: number }).Size) : null,
    createdAt: str(raw.CreatedAt) || null,
    usedBy,
    inUse: usedBy.length > 0,
  };
}

export function normalizeNetwork(raw: Record<string, unknown>): NetworkInfo {
  const configs = (raw.IPAM as { Config?: { Subnet?: string; Gateway?: string }[] } | undefined)?.Config ?? [];
  const containers = (raw.Containers as Record<string, { Name?: string; IPv4Address?: string }> | undefined) ?? {};
  return {
    id: str(raw.Id),
    name: str(raw.Name),
    driver: str(raw.Driver),
    scope: str(raw.Scope),
    internal: Boolean(raw.Internal),
    subnet: configs[0]?.Subnet ?? null,
    gateway: configs[0]?.Gateway ?? null,
    created: str(raw.Created) || null,
    containers: Object.entries(containers).map(([id, entry]) => ({
      id: id.slice(0, 12),
      name: entry.Name ?? id.slice(0, 12),
      ipv4: (entry.IPv4Address ?? "").split("/")[0],
    })),
  };
}

/**
 * The engine multiplexes stdout/stderr with an 8-byte frame header when TTY is
 * off: [stream:1][0,0,0][size:4 BE][payload]. Falls back to raw UTF-8 when the
 * buffer is not framed.
 */
export function demuxDockerLogs(buffer: Buffer): string {
  const chunks: string[] = [];
  let offset = 0;
  let framed = true;

  while (offset + 8 <= buffer.length) {
    const stream = buffer[offset];
    if (stream !== 0 && stream !== 1 && stream !== 2) {
      framed = false;
      break;
    }
    if (buffer[offset + 1] !== 0 || buffer[offset + 2] !== 0 || buffer[offset + 3] !== 0) {
      framed = false;
      break;
    }
    const size = buffer.readUInt32BE(offset + 4);
    if (size < 0 || offset + 8 + size > buffer.length) {
      framed = false;
      break;
    }
    chunks.push(buffer.subarray(offset + 8, offset + 8 + size).toString("utf8"));
    offset += 8 + size;
  }

  if (!framed || chunks.length === 0) {
    if (offset === 0) return buffer.toString("utf8");
    chunks.push(buffer.subarray(offset).toString("utf8"));
  }
  return chunks.join("");
}
