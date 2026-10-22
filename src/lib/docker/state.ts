import { TtlCache } from "@/lib/cache";
import type { ContainerInfo, ContainerStats, EngineStatus, ImageInfo, NetworkInfo, VolumeInfo } from "./types";

/**
 * Shared engine caches. TTLs follow the mission contract:
 * probe 15s, container inspect 4s, stats 5s. Endpoint writes clear them so a
 * stale in-memory list can never hide a newly added host.
 */
export const probeCache = new TtlCache<EngineStatus>(15_000);
export const inspectCache = new TtlCache<ContainerInfo>(4_000);
export const statsCache = new TtlCache<ContainerStats>(5_000);
export const resourceCache = new TtlCache<{ images: ImageInfo[]; volumes: VolumeInfo[]; networks: NetworkInfo[] }>(4_000);

export function invalidateEngineCaches(): void {
  probeCache.clear();
  inspectCache.clear();
  statsCache.clear();
  resourceCache.clear();
}
