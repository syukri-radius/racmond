import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { mapLimit, withTimeout } from "@/lib/cache";
import {
  demuxDockerLogs,
  normalizeContainer,
  normalizeEngine,
  normalizeImage,
  normalizeNetwork,
  normalizeStats,
  normalizeVolume,
  type RawContainerInspect,
  type RawContainerSummary,
  type RawStats,
} from "./normalize";
import { inspectCache, resourceCache, statsCache } from "./state";
import type {
  ContainerInfo,
  ContainerStats,
  EngineAdapter,
  EngineInfo,
  ExecResult,
  ImageInfo,
  LogOptions,
  NetworkInfo,
  PruneResult,
  RunSpec,
  VolumeInfo,
} from "./types";

/** dockerode client for unix://, tcp:// and npipe:// endpoints. */
export function createDockerClient(endpoint: string): Docker {
  if (endpoint.startsWith("unix://")) {
    return new Docker({ socketPath: endpoint.replace("unix://", "") });
  }
  if (endpoint.startsWith("npipe://")) {
    return new Docker({ socketPath: endpoint.replace("npipe://", "//") });
  }
  if (endpoint.startsWith("tcp://") || endpoint.startsWith("http://")) {
    const url = new URL(endpoint.replace(/^tcp:\/\//, "http://"));
    return new Docker({
      host: url.hostname,
      port: url.port ? Number(url.port) : 2375,
      protocol: url.protocol === "https:" ? "https" : "http",
    });
  }
  return new Docker();
}

function parsePortBindings(ports: string[] | undefined): {
  exposed: Record<string, Record<string, never>>;
  bindings: Record<string, { HostPort: string }[]>;
} {
  const exposed: Record<string, Record<string, never>> = {};
  const bindings: Record<string, { HostPort: string }[]> = {};
  for (const entry of ports ?? []) {
    const [host, container] = entry.split(":");
    const containerPort = Number(container ?? host);
    if (!Number.isFinite(containerPort)) continue;
    const key = `${containerPort}/tcp`;
    exposed[key] = {};
    if (container) bindings[key] = [{ HostPort: String(Number(host)) }];
  }
  return { exposed, bindings };
}

export class LiveEngine implements EngineAdapter {
  kind = "live" as const;
  private docker: Docker;

  constructor(public endpoint: string) {
    this.docker = createDockerClient(endpoint);
  }

  get client(): Docker {
    return this.docker;
  }

  async probe(): Promise<{ info: EngineInfo; version: Record<string, unknown> }> {
    await withTimeout(this.docker.ping(), 2500, "docker ping");
    const [version, info] = await Promise.all([
      withTimeout(this.docker.version(), 2500, "docker version") as unknown as Promise<Record<string, unknown>>,
      withTimeout(this.docker.info(), 2500, "docker info") as Promise<Record<string, unknown>>,
    ]);
    return { info: normalizeEngine(info, version), version };
  }

  async info(): Promise<EngineInfo> {
    const { info } = await this.probe();
    return info;
  }

  private async inspect(id: string): Promise<RawContainerInspect | null> {
    try {
      return (await withTimeout(this.docker.getContainer(id).inspect(), 4000, "container inspect")) as unknown as RawContainerInspect;
    } catch {
      return null;
    }
  }

  private async statsOf(id: string, running: boolean): Promise<ContainerStats | null> {
    if (!running) return null;
    const cached = statsCache.get(id);
    if (cached) return cached;
    try {
      const raw = (await withTimeout(
        this.docker.getContainer(id).stats({ stream: false }),
        5000,
        "container stats",
      )) as unknown as RawStats;
      return statsCache.set(id, normalizeStats(raw));
    } catch {
      return null;
    }
  }

  async containers(): Promise<ContainerInfo[]> {
    const summaries = (await this.docker.listContainers({ all: true })) as unknown as RawContainerSummary[];
    const detailed = await mapLimit(summaries.slice(0, 400), 8, async (summary) => {
      const cached = inspectCache.get(summary.Id);
      if (cached) return cached;
      const inspect = await this.inspect(summary.Id);
      const state = inspect?.State?.Status ?? summary.State ?? "";
      const stats = await this.statsOf(summary.Id, state === "running");
      return inspectCache.set(summary.Id, normalizeContainer(summary, inspect, stats));
    });
    return detailed.sort((a, b) => a.name.localeCompare(b.name));
  }

  async container(id: string): Promise<ContainerInfo | null> {
    const inspect = await this.inspect(id);
    if (!inspect) return null;
    const running = inspect.State?.Status === "running";
    const stats = await this.statsOf(id, running);
    const info = normalizeContainer(null, inspect, stats);
    return inspectCache.set(id, info);
  }

  async logs(id: string, options: LogOptions = {}): Promise<string> {
    const container = this.docker.getContainer(id);
    const buffer = (await withTimeout(
      container.logs({
        stdout: true,
        stderr: true,
        timestamps: options.timestamps ?? true,
        tail: options.tail ?? 250,
        follow: false,
        ...(options.since ? { since: options.since } : {}),
      }),
      6000,
      "container logs",
    )) as unknown as Buffer;
    return demuxDockerLogs(Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer)));
  }

  async exec(id: string, command: string): Promise<ExecResult> {
    const container = this.docker.getContainer(id);
    const started = Date.now();
    const exec = await container.exec({
      Cmd: ["/bin/sh", "-lc", command],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    stdout.on("data", (chunk: Buffer) => out.push(chunk));
    stderr.on("data", (chunk: Buffer) => err.push(chunk));
    this.docker.modem.demuxStream(stream, stdout, stderr);
    await new Promise<void>((resolve) => {
      stream.on("end", () => resolve());
      stream.on("error", () => resolve());
      setTimeout(resolve, 20_000);
    });
    const inspect = await exec.inspect();
    const output = Buffer.concat(out).toString("utf8") + Buffer.concat(err).toString("utf8");
    return { exitCode: inspect.ExitCode ?? null, output, durationMs: Date.now() - started };
  }

  async images(): Promise<ImageInfo[]> {
    const raw = (await this.docker.listImages({ all: false })) as unknown as Record<string, unknown>[];
    return raw.map(normalizeImage).sort((a, b) => a.repoTags[0].localeCompare(b.repoTags[0]));
  }

  async volumes(): Promise<VolumeInfo[]> {
    const response = (await this.docker.listVolumes()) as unknown as { Volumes?: Record<string, unknown>[] };
    const containers = await this.containers();
    return (response.Volumes ?? []).map((volume) => {
      const name = String(volume.Name ?? "");
      const usedBy = containers
        .filter((container) => container.mounts.some((mount) => mount.source === name))
        .map((container) => container.name);
      return normalizeVolume(volume, usedBy);
    });
  }

  async networks(): Promise<NetworkInfo[]> {
    const raw = (await this.docker.listNetworks()) as unknown as Record<string, unknown>[];
    return raw.map(normalizeNetwork);
  }

  async resources(): Promise<{ images: ImageInfo[]; volumes: VolumeInfo[]; networks: NetworkInfo[] }> {
    const cached = resourceCache.get(this.endpoint);
    if (cached) return cached;
    const [images, volumes, networks] = await Promise.all([this.images(), this.volumes(), this.networks()]);
    return resourceCache.set(this.endpoint, { images, volumes, networks });
  }

  async action(action: string, target: string, payload: Record<string, unknown> = {}): Promise<{ ok: true; message: string }> {
    const [scope, ...rest] = target.includes(":") ? target.split(":") : ["container", target];
    const ref = rest.join(":");

    if (scope === "image") {
      if (action !== "remove") throw new Error(`unsupported image action ${action}`);
      await this.docker.getImage(ref).remove({ force: Boolean(payload.force) });
      resourceCache.clear();
      return { ok: true, message: `image ${ref} removed` };
    }
    if (scope === "volume") {
      if (action !== "remove") throw new Error(`unsupported volume action ${action}`);
      await this.docker.getVolume(ref).remove({ force: Boolean(payload.force) });
      resourceCache.clear();
      return { ok: true, message: `volume ${ref} removed` };
    }
    if (scope === "network") {
      if (action !== "remove") throw new Error(`unsupported network action ${action}`);
      await this.docker.getNetwork(ref).remove();
      resourceCache.clear();
      return { ok: true, message: `network ${ref} removed` };
    }

    const container = this.docker.getContainer(ref);
    switch (action) {
      case "start":
        await container.start();
        break;
      case "stop":
        await container.stop({ t: Number(payload.timeout ?? 10) });
        break;
      case "restart":
        await container.restart({ t: Number(payload.timeout ?? 10) });
        break;
      case "pause":
        await container.pause();
        break;
      case "unpause":
        await container.unpause();
        break;
      case "kill":
        await container.kill({ signal: String(payload.signal ?? "SIGKILL") });
        break;
      case "remove":
        await container.remove({ force: Boolean(payload.force), v: Boolean(payload.volumes) });
        break;
      default:
        throw new Error(`unsupported action ${action}`);
    }
    inspectCache.clear();
    statsCache.clear();
    return { ok: true, message: `${action} ${ref}` };
  }

  async run(spec: RunSpec): Promise<{ id: string; name: string }> {
    const { exposed, bindings } = parsePortBindings(spec.ports);
    const container = await this.docker.createContainer({
      Image: spec.image,
      name: spec.name?.trim() || undefined,
      Env: spec.env?.length ? spec.env : undefined,
      Cmd: spec.command?.trim() ? ["/bin/sh", "-lc", spec.command] : undefined,
      ExposedPorts: exposed,
      HostConfig: { PortBindings: bindings },
    });
    await container.start();
    const inspect = (await container.inspect()) as unknown as RawContainerInspect;
    inspectCache.clear();
    return { id: inspect.Id, name: (inspect.Name ?? "").replace(/^\//, "") };
  }

  async prune(kind: "images" | "volumes" | "networks" | "containers"): Promise<PruneResult> {
    let reclaimed = 0;
    const details: string[] = [];
    if (kind === "images") {
      const result = (await this.docker.pruneImages()) as unknown as { ImagesDeleted?: { Deleted?: string }[]; SpaceReclaimed?: number };
      reclaimed = result.SpaceReclaimed ?? 0;
      details.push(...(result.ImagesDeleted ?? []).map((entry) => entry.Deleted ?? ""));
    } else if (kind === "volumes") {
      const result = (await this.docker.pruneVolumes()) as unknown as { VolumesDeleted?: string[]; SpaceReclaimed?: number };
      reclaimed = result.SpaceReclaimed ?? 0;
      details.push(...(result.VolumesDeleted ?? []));
    } else if (kind === "networks") {
      const result = (await this.docker.pruneNetworks()) as unknown as { NetworksDeleted?: string[] };
      details.push(...(result.NetworksDeleted ?? []));
    } else {
      const result = (await this.docker.pruneContainers()) as unknown as { ContainersDeleted?: string[]; SpaceReclaimed?: number };
      reclaimed = result.SpaceReclaimed ?? 0;
      details.push(...(result.ContainersDeleted ?? []));
    }
    resourceCache.clear();
    inspectCache.clear();
    return { kind, reclaimedBytes: reclaimed, details: details.filter(Boolean) };
  }

  async projectAction(project: string, action: "start" | "stop" | "restart") {
    const list = (await this.containers()).filter((container) => container.composeProject === project);
    if (!list.length) throw new Error(`compose project ${project} has no containers`);
    let affected = 0;
    for (const container of list) {
      try {
        await this.action(action, `container:${container.id}`);
        affected += 1;
      } catch {
        /* keep going: one bad container must not block the project action */
      }
    }
    return { ok: true as const, message: `${action} ${affected}/${list.length} containers in ${project}`, affected };
  }
}
