"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, postJson, timeAgo, usePoll } from "@/lib/client";
import type { ContainerInfo, EngineStatus, NetworkInfo, VolumeInfo } from "@/lib/docker/types";
import { MapCanvas, type MapCard, type MapEdge } from "@/components/map/MapCanvas";
import { Button, Chip, Dot, Drawer, ErrorNote, KeyValue, Notice, PageHeader, Panel, TONE_TEXT, type Tone } from "@/components/ui/primitives";

interface OverviewPayload {
  status: EngineStatus;
  containers: ContainerInfo[];
  projects: { name: string; containers: number; running: number }[];
  counts: { containers: number; running: number; stopped: number; attention: number; cpu: number; memory: number };
  resources: { images: number; volumes: number; networks: number; danglingVolumes: number; unusedImages: number };
}

const containerTone = (container: ContainerInfo): Tone =>
  container.health === "unhealthy" || (container.state === "exited" && (container.exitCode ?? 0) !== 0)
    ? "bad"
    : container.state === "restarting" || container.health === "starting"
      ? "warn"
      : container.state === "running"
        ? "ok"
        : "muted";

export default function GraphPage() {
  const overview = usePoll<OverviewPayload>("/api/engine/overview", 7000);
  const resources = usePoll<{ images: unknown[]; volumes: VolumeInfo[]; networks: NetworkInfo[] }>("/api/engine/resources", 15_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);

  const containers = useMemo(() => overview.data?.containers ?? [], [overview.data]);
  const status = overview.data?.status;

  const { cards, edges } = useMemo(() => {
    const nodes: MapCard[] = [];
    const links: MapEdge[] = [];
    if (!status && !containers.length) return { cards: nodes, edges: links };

    const hostId = "host";
    nodes.push({
      id: hostId,
      parentId: null,
      title: status?.engine?.host ?? "local host",
      subtitle: status?.endpoint ?? "no endpoint",
      kind: "host",
      tone: status?.mode === "live" ? "ok" : status?.mode === "demo" ? "warn" : "bad",
      badge: status?.mode,
      chips: [
        status?.engine ? `${status.engine.cpus} cpu` : "cpu ?",
        status?.engine ? formatBytes(status.engine.memoryBytes) : "memory ?",
        `${containers.length} containers`,
      ],
      stats: [
        { label: "cpu", pct: Math.min(100, overview.data?.counts.cpu ?? 0), value: `${(overview.data?.counts.cpu ?? 0).toFixed(0)}%`, tone: "info" },
        {
          label: "mem",
          pct: overview.data && status?.engine?.memoryBytes ? (overview.data.counts.memory / status.engine.memoryBytes) * 100 : 0,
          value: formatBytes(overview.data?.counts.memory ?? 0),
          tone: "accent",
        },
      ],
    });

    const projectIds = new Set<string>();
    const serviceIds = new Set<string>();
    for (const container of containers) {
      const projectName = container.composeProject ?? "standalone";
      const projectId = `project:${projectName}`;
      if (!projectIds.has(projectId)) {
        projectIds.add(projectId);
        const members = containers.filter((entry) => (entry.composeProject ?? "standalone") === projectName);
        const tones = members.map(containerTone);
        nodes.push({
          id: projectId,
          parentId: hostId,
          title: projectName,
          subtitle: `${members.length} container${members.length === 1 ? "" : "s"}`,
          kind: "project",
          tone: tones.includes("bad") ? "bad" : tones.includes("warn") ? "warn" : "ok",
          chips: [
            `${members.filter((entry) => entry.state === "running").length}/${members.length} up`,
            ...Array.from(new Set(members.map((entry) => entry.composeService ?? "adhoc"))).slice(0, 2),
          ],
        });
        links.push({ source: hostId, target: projectId, label: "runs", tone: "accent" });
      }

      const serviceName = container.composeService ?? "adhoc";
      const serviceId = `${projectId}:service:${serviceName}`;
      if (projectName !== "standalone" && !serviceIds.has(serviceId)) {
        serviceIds.add(serviceId);
        nodes.push({
          id: serviceId,
          parentId: projectId,
          title: serviceName,
          subtitle: container.image,
          kind: "service",
          tone: "info",
          chips: [container.image.split("/").pop() ?? container.image],
        });
        links.push({ source: projectId, target: serviceId, label: "service", tone: "accent" });
      }

      const containerId = `container:${container.id}`;
      nodes.push({
        id: containerId,
        parentId: projectName === "standalone" ? projectId : serviceId,
        title: container.name,
        subtitle: `${container.image} · ${container.statusText}`,
        kind: "container",
        glyph: "▢",
        tone: containerTone(container),
        badge: container.state,
        chips: [
          ...container.ports.slice(0, 2).map((port) => (port.hostPort ? `${port.hostPort}→${port.containerPort}` : `${port.containerPort}/${port.protocol}`)),
          ...container.networks.slice(0, 1).map((network) => network.name),
          container.restartCount ? `${container.restartCount} restarts` : "stable",
        ],
        stats: [
          { label: "cpu", pct: container.cpuPct, value: `${container.cpuPct.toFixed(0)}%`, tone: container.cpuPct > 75 ? "bad" : "ok" },
          { label: "mem", pct: container.memoryPct, value: formatBytes(container.memoryBytes).replace(" ", ""), tone: container.memoryPct > 85 ? "bad" : "accent" },
        ],
      });
      links.push({
        source: projectName === "standalone" ? projectId : serviceId,
        target: containerId,
        label: container.state === "running" ? "live" : container.state,
        tone: containerTone(container),
      });

      if (container.networks.length) {
        const networkGroupId = `${containerId}:net`;
        nodes.push({
          id: networkGroupId,
          parentId: containerId,
          title: "networks",
          subtitle: `${container.networks.length} attached`,
          kind: "network",
          chips: container.networks.map((network) => network.ipAddress).slice(0, 2),
        });
        nodes.push({
          id: `${networkGroupId}:line`,
          parentId: networkGroupId,
          title: container.networks.map((network) => network.name).join(", "),
          subtitle: container.networks.map((network) => network.ipAddress || "no ip").join(" · "),
          kind: "network",
          tone: "accent",
          chips: ["bridge"],
        });
      }
      if (container.mounts.length) {
        const mountGroupId = `${containerId}:vol`;
        nodes.push({
          id: mountGroupId,
          parentId: containerId,
          title: "mounts",
          subtitle: `${container.mounts.length} volume(s)`,
          kind: "volume",
          chips: container.mounts.map((mount) => mount.destination).slice(0, 2),
        });
        container.mounts.slice(0, 2).forEach((mount, index) => {
          nodes.push({
            id: `${mountGroupId}:${index}`,
            parentId: mountGroupId,
            title: mount.destination,
            subtitle: mount.source,
            kind: "volume",
            tone: "warn",
            chips: [mount.type, mount.mode],
          });
        });
      }
    }

    const engineId = "engine";
    nodes.push({
      id: engineId,
      parentId: hostId,
      title: "engine resources",
      subtitle: `${overview.data?.resources.images ?? 0} images · ${resources.data?.volumes.length ?? 0} volumes · ${resources.data?.networks.length ?? 0} networks`,
      kind: "engine",
      chips: [status?.engine?.storageDriver ?? "storage ?", status?.engine?.runtime ?? "runtime ?", status?.engine?.cgroupVersion ?? "cgroup ?"],
    });
    links.push({ source: hostId, target: engineId, label: "hosts", tone: "muted" });

    const imagesId = "engine:images";
    nodes.push({
      id: imagesId,
      parentId: engineId,
      title: "images",
      subtitle: `${overview.data?.resources.images ?? 0} local · ${overview.data?.resources.unusedImages ?? 0} unused`,
      kind: "image",
      tone: (overview.data?.resources.unusedImages ?? 0) > 0 ? "warn" : "muted",
      chips: [`${overview.data?.resources.images ?? 0}`],
    });
    const volumesId = "engine:volumes";
    nodes.push({
      id: volumesId,
      parentId: engineId,
      title: "volumes",
      subtitle: `${resources.data?.volumes.length ?? 0} defined · ${overview.data?.resources.danglingVolumes ?? 0} dangling`,
      kind: "volume",
      tone: "warn",
      chips: [`${resources.data?.volumes.length ?? 0}`],
    });
    const networksId = "engine:networks";
    nodes.push({
      id: networksId,
      parentId: engineId,
      title: "networks",
      subtitle: `${resources.data?.networks.length ?? 0} networks`,
      kind: "network",
      tone: "accent",
      chips: [`${resources.data?.networks.length ?? 0}`],
    });
    links.push(
      { source: engineId, target: imagesId, label: "caches", tone: "muted" },
      { source: engineId, target: volumesId, label: "persists", tone: "warn" },
      { source: engineId, target: networksId, label: "bridges", tone: "accent" },
    );

    for (const volume of (resources.data?.volumes ?? []).slice(0, 8)) {
      nodes.push({
        id: `volume:${volume.name}`,
        parentId: volumesId,
        title: volume.name,
        subtitle: `${volume.driver} · ${volume.sizeBytes ? formatBytes(volume.sizeBytes) : "size ?"}`,
        kind: "volume",
        tone: volume.inUse ? "muted" : "warn",
        chips: volume.usedBy.slice(0, 2).length ? volume.usedBy.slice(0, 2) : ["dangling"],
      });
      links.push({ source: volumesId, target: `volume:${volume.name}`, label: volume.inUse ? "in use" : "dangling", tone: volume.inUse ? "muted" : "warn" });
    }
    for (const network of (resources.data?.networks ?? []).slice(0, 8)) {
      nodes.push({
        id: `network:${network.name}`,
        parentId: networksId,
        title: network.name,
        subtitle: `${network.driver} · ${network.subnet ?? "no subnet"}`,
        kind: "network",
        tone: network.internal ? "warn" : "accent",
        chips: [`${network.containers.length} attached`, network.scope],
      });
      links.push({ source: networksId, target: `network:${network.name}`, label: "attached", tone: "accent" });
    }

    return { cards: nodes, edges: links };
  }, [containers, status, overview.data, resources.data]);

  const detail = cards.find((card) => card.id === selected) ?? null;
  const selectedContainer = selected?.startsWith("container:") ? containers.find((container) => `container:${container.id}` === selected) ?? null : null;

  const act = async (action: string, target: string) => {
    setBusy(target);
    try {
      const result = await postJson<{ message?: string }>("/api/engine/actions", { action, target });
      setNotice({ tone: "ok", message: result.message ?? `${action} applied` });
      overview.refresh();
      resources.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="topology / hierarchical estate map"
        title="Estate topology"
        description="Host → compose project → service → container → networks and mounts, plus the engine's own resource branch. Expand a card to reveal children; click one to inspect it."
        actions={
          <>
            <Button icon="refresh" onClick={() => { overview.refresh(); resources.refresh(); }}>
              refresh
            </Button>
            {status?.demo ? <Chip tone="warn">demo engine</Chip> : null}
          </>
        }
      />

      {overview.error ? <ErrorNote message={overview.error} onRetry={overview.refresh} /> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <Panel padded={false} className="min-h-0 flex-1 overflow-hidden">
        <MapCanvas
          cards={cards}
          edges={edges}
          layout="tree"
          initialLevels={2}
          selectedId={selected}
          onSelect={setSelected}
          emptyMessage="No containers yet — the engine map appears as soon as the adapter answers."
          legend={[
            { label: "healthy", tone: "ok" },
            { label: "degraded", tone: "warn" },
            { label: "failing", tone: "bad" },
            { label: "stopped", tone: "muted" },
          ]}
          overlay={
            <Chip tone="info">
              {cards.length} nodes · {edges.length} links
            </Chip>
          }
        />
      </Panel>

      <Drawer
        open={Boolean(detail)}
        onClose={() => setSelected(null)}
        title={detail?.title ?? ""}
        subtitle={detail?.subtitle}
        footer={
          selectedContainer ? (
            <div className="flex flex-wrap gap-1.5">
              {selectedContainer.state === "running" ? (
                <Button icon="stop" onClick={() => act("stop", selectedContainer.id)} disabled={busy === selectedContainer.id}>
                  stop
                </Button>
              ) : (
                <Button icon="play" onClick={() => act("start", selectedContainer.id)} disabled={busy === selectedContainer.id}>
                  start
                </Button>
              )}
              <Button icon="rotate" onClick={() => act("restart", selectedContainer.id)} disabled={busy === selectedContainer.id}>
                restart
              </Button>
              <Button variant="danger" icon="trash" onClick={() => act("remove", selectedContainer.id)} disabled={busy === selectedContainer.id || selectedContainer.state === "running"}>
                remove
              </Button>
            </div>
          ) : null
        }
      >
        {detail ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Dot tone={detail.tone ?? "muted"} />
              <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", TONE_TEXT[detail.tone ?? "muted"])}>{detail.kind}</span>
              {detail.badge ? <Chip tone={detail.tone ?? "muted"}>{detail.badge}</Chip> : null}
            </div>
            <KeyValue
              rows={[
                { label: "node id", value: detail.id },
                { label: "parent", value: detail.parentId ?? "—" },
                { label: "children", value: String(cards.filter((card) => card.parentId === detail.id).length) },
              ]}
            />
            {detail.chips?.length ? (
              <div className="flex flex-wrap gap-1">
                {detail.chips.map((chip, index) => (
                  <Chip key={`${chip}-${index}`} tone={detail.tone ?? "muted"}>
                    {chip}
                  </Chip>
                ))}
              </div>
            ) : null}

            {selectedContainer ? (
              <>
                <KeyValue
                  rows={[
                    { label: "image", value: selectedContainer.image },
                    { label: "state", value: `${selectedContainer.state} / ${selectedContainer.health}` },
                    { label: "command", value: selectedContainer.command || "—" },
                    { label: "created", value: timeAgo(selectedContainer.createdAt) },
                    { label: "cpu", value: `${selectedContainer.cpuPct.toFixed(2)}%` },
                    { label: "memory", value: `${formatBytes(selectedContainer.memoryBytes)} (${selectedContainer.memoryPct.toFixed(1)}%)` },
                    {
                      label: "ports",
                      value:
                        selectedContainer.ports.map((port) => (port.hostPort ? `${port.hostPort}→${port.containerPort}` : `${port.containerPort}`)).join(", ") || "—",
                    },
                    { label: "networks", value: selectedContainer.networks.map((network) => network.name).join(", ") || "—" },
                  ]}
                />
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">children</p>
                  {cards
                    .filter((card) => card.parentId === detail.id)
                    .map((child) => (
                      <div key={child.id} className="flex items-center gap-1.5 rounded border border-line/60 px-2 py-1">
                        <Dot tone={child.tone ?? "muted"} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-300">{child.title}</span>
                        <span className="shrink-0 font-mono text-[9px] text-slate-500">{child.kind}</span>
                      </div>
                    ))}
                  {!cards.some((card) => card.parentId === detail.id) ? <p className="text-[11px] text-slate-500">leaf node</p> : null}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
