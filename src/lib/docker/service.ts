import { demoEngine } from "./demo";
import { LiveEngine } from "./live";
import { endpointReachable, ensureEndpoints, socketPathOf } from "./endpoints";
import { inspectCache, probeCache, statsCache } from "./state";
import type {
  ContainerInfo,
  ContainerStats,
  EngineAdapter,
  EngineStatus,
  ImageInfo,
  LogOptions,
  NetworkInfo,
  VolumeInfo,
} from "./types";

export interface EngineContext {
  adapter: EngineAdapter;
  status: EngineStatus;
  live: LiveEngine | null;
}

/**
 * Probes the default endpoint first, then the rest.
 * A successful probe short-circuits; if nothing answers we fall back to the
 * demo engine and keep the real error string visible for the UI.
 */
export async function probeEngine(force = false): Promise<EngineStatus> {
  if (!force) {
    const cached = probeCache.get("status");
    if (cached) return cached;
  }

  const endpoints = await ensureEndpoints();
  const ordered = [...endpoints].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const errors: string[] = [];
  const startedAt = Date.now();

  for (const endpoint of ordered) {
    if (!endpointReachable(endpoint.endpoint)) {
      const socket = socketPathOf(endpoint.endpoint);
      errors.push(`${endpoint.name}: socket not found at ${socket}`);
      continue;
    }
    const live = new LiveEngine(endpoint.endpoint);
    try {
      const { info } = await live.probe();
      const containers = await live.containers().catch(() => []);
      const status: EngineStatus = {
        mode: "live",
        demo: false,
        endpoint: endpoint.endpoint,
        endpoints,
        error: null,
        engine: info,
        probedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        containerCount: containers.length,
      };
      return probeCache.set("status", status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${endpoint.name} (${endpoint.endpoint}): ${message}`);
    }
  }

  const demoInfo = await demoEngine.info();
  const demoContainers = await demoEngine.containers().catch(() => []);
  const status: EngineStatus = {
    mode: "demo",
    demo: true,
    endpoint: ordered[0]?.endpoint ?? null,
    endpoints,
    error:
      errors.join(" · ") ||
      "No Docker endpoint is registered. Showing the demo engine.",
    engine: demoInfo,
    probedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    containerCount: demoContainers.length,
  };
  return probeCache.set("status", status);
}

export async function getEngine(force = false): Promise<EngineContext> {
  const status = await probeEngine(force);
  if (status.mode === "live" && status.endpoint) {
    return { adapter: new LiveEngine(status.endpoint), status, live: new LiveEngine(status.endpoint) };
  }
  return { adapter: demoEngine, status, live: null };
}

export async function engineInfo(force = false) {
  const { status } = await getEngine(force);
  return status.engine;
}

/* ------------------------------------------------------------ containers */

export async function listContainers(force = false): Promise<ContainerInfo[]> {
  if (force) {
    inspectCache.clear();
    statsCache.clear();
  }
  const { adapter } = await getEngine();
  return adapter.containers();
}

export async function getContainer(id: string): Promise<ContainerInfo | null> {
  const cached = inspectCache.get(id);
  if (cached) return cached;
  const { adapter } = await getEngine();
  const info = await adapter.container(id);
  return info ? inspectCache.set(id, info) : null;
}

export async function getContainerStats(id: string): Promise<ContainerStats | null> {
  const cached = statsCache.get(id);
  if (cached) return cached;
  const { adapter } = await getEngine();
  // the adapter's inspect already merges stats; derive the stats view from it
  const info = await adapter.container(id);
  if (!info) return null;
  const stats: ContainerStats = {
    cpuPct: info.cpuPct,
    memoryBytes: info.memoryBytes,
    memoryLimitBytes: info.memoryLimitBytes,
    memoryPct: info.memoryPct,
    netRxBytes: info.netRxBytes,
    netTxBytes: info.netTxBytes,
    blockReadBytes: info.blockReadBytes,
    blockWriteBytes: info.blockWriteBytes,
    pids: info.pids,
    history: info.history,
  };
  return statsCache.set(id, stats);
}

export async function getLogs(id: string, options: LogOptions = {}): Promise<string> {
  const { adapter } = await getEngine();
  return adapter.logs(id, options);
}

export async function listImages(force = false): Promise<ImageInfo[]> {
  if (force) {
    const { adapter } = await getEngine();
    return adapter.images();
  }
  const { adapter } = await getEngine();
  return adapter.images();
}

export async function listVolumes(force = false): Promise<VolumeInfo[]> {
  if (force) {
    const { adapter } = await getEngine();
    return adapter.volumes();
  }
  const { adapter } = await getEngine();
  return adapter.volumes();
}

export async function listNetworks(force = false): Promise<NetworkInfo[]> {
  if (force) {
    const { adapter } = await getEngine();
    return adapter.networks();
  }
  const { adapter } = await getEngine();
  return adapter.networks();
}

export async function engineResources(force = false) {
  const { adapter } = await getEngine();
  if (adapter.kind === "live") {
    if (force) {
      const [images, volumes, networks] = await Promise.all([adapter.images(), adapter.volumes(), adapter.networks()]);
      return { images, volumes, networks };
    }
    const [images, volumes, networks] = await Promise.all([adapter.images(), adapter.volumes(), adapter.networks()]);
    return { images, volumes, networks };
  }
  const [images, volumes, networks] = await Promise.all([adapter.images(), adapter.volumes(), adapter.networks()]);
  return { images, volumes, networks };
}

export function invalidateContainer(id: string): void {
  inspectCache.clear();
  statsCache.clear();
  void id;
}
