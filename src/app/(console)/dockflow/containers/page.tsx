"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, postJson, timeAgo, usePoll } from "@/lib/client";
import type { ContainerInfo, ImageInfo, NetworkInfo, VolumeInfo } from "@/lib/docker/types";
import { Button, Chip, Dot, ErrorNote, Field, IconButton, Metric, Modal, Notice, PageHeader, Panel, Select, Table, Tabs, Td, TextInput, Th, TONE_TEXT, type Tone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { ContainerDrawer } from "@/components/containers/ContainerDrawer";

type Tab = "containers" | "images" | "volumes" | "networks";

const stateTone = (container: ContainerInfo): Tone =>
  container.state === "running" ? (container.health === "unhealthy" ? "bad" : container.health === "starting" ? "warn" : "ok") : container.state === "restarting" ? "warn" : "muted";

export default function ContainersPage() {
  const [tab, setTab] = useState<Tab>("containers");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [selected, setSelected] = useState<ContainerInfo | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);

  const containers = usePoll<{ containers: ContainerInfo[]; projects: string[] }>("/api/engine/containers", 5000);
  const resources = usePoll<{ images: ImageInfo[]; volumes: VolumeInfo[]; networks: NetworkInfo[] }>("/api/engine/resources", 8000);

  const list = containers.data?.containers ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.filter((container) => {
      if (stateFilter !== "all" && container.state !== stateFilter) return false;
      if (projectFilter !== "all" && (container.composeProject ?? "standalone") !== projectFilter) return false;
      if (!needle) return true;
      return (
        container.name.toLowerCase().includes(needle) ||
        container.image.toLowerCase().includes(needle) ||
        container.id.toLowerCase().includes(needle) ||
        (container.composeProject ?? "").toLowerCase().includes(needle)
      );
    });
  }, [list, query, stateFilter, projectFilter]);

  const totals = useMemo(() => {
    const running = list.filter((container) => container.state === "running");
    return {
      total: list.length,
      running: running.length,
      attention: list.filter((c) => c.state === "restarting" || c.health === "unhealthy" || (c.state === "exited" && (c.exitCode ?? 0) !== 0)).length,
      cpu: running.reduce((sum, c) => sum + c.cpuPct, 0),
      memory: running.reduce((sum, c) => sum + c.memoryBytes, 0),
    };
  }, [list]);

  const act = async (action: string, target: string) => {
    setBusy(target);
    setNotice(null);
    try {
      const result = await postJson<{ message?: string }>("/api/engine/actions", { action, target });
      setNotice({ tone: "ok", message: result.message ?? `${action} applied to ${target}` });
      containers.refresh();
      resources.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const removeResource = async (target: string) => {
    setBusy(target);
    setNotice(null);
    try {
      const result = await postJson<{ message?: string }>("/api/engine/actions", { action: "remove", target });
      setNotice({ tone: "ok", message: result.message ?? `${target} removed` });
      resources.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const prune = async (kind: "images" | "volumes" | "networks" | "containers") => {
    setNotice(null);
    try {
      const result = await postJson<{ result?: { reclaimedBytes?: number; details?: string[] } }>("/api/engine/actions", { prune: kind });
      const reclaimed = result.result?.reclaimedBytes ?? 0;
      setNotice({ tone: "ok", message: `Pruned ${kind} · reclaimed ${formatBytes(reclaimed)}` });
      resources.refresh();
      containers.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="engine / inventory"
        title="Containers & resources"
        description="Everything the engine knows about, straight from the adapter — containers, images, volumes and networks with live actions."
        actions={
          <>
            <Button icon="refresh" onClick={() => { containers.refresh(); resources.refresh(); }}>
              refresh
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setRunOpen(true)}>
              docker run
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="containers" value={totals.total} hint={`${totals.running} running`} icon="box" tone="accent" />
        <Metric label="attention" value={totals.attention} hint="unhealthy · restarting · failed" icon="alert" tone={totals.attention ? "bad" : "ok"} />
        <Metric label="cpu" value={`${totals.cpu.toFixed(1)}%`} hint="sum of running" icon="cpu" tone={totals.cpu > 200 ? "warn" : "ok"} />
        <Metric label="memory" value={formatBytes(totals.memory)} hint="resident total" icon="memory" tone="info" />
        <Metric label="images" value={resources.data?.images.length ?? "…"} hint={`${resources.data?.images.filter((image) => image.containers === 0).length ?? 0} unused`} icon="image" />
        <Metric label="volumes · networks" value={`${resources.data?.volumes.length ?? "…"} · ${resources.data?.networks.length ?? "…"}`} hint={`${resources.data?.volumes.filter((volume) => !volume.inUse).length ?? 0} dangling`} icon="disk" />
      </div>

      {containers.error ? <ErrorNote message={containers.error} onRetry={containers.refresh} /> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "containers", label: "containers", count: list.length, icon: "box" },
            { value: "images", label: "images", count: resources.data?.images.length, icon: "image" },
            { value: "volumes", label: "volumes", count: resources.data?.volumes.length, icon: "disk" },
            { value: "networks", label: "networks", count: resources.data?.networks.length, icon: "network" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Icon name="search" size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="filter name / image / id"
              className="h-7 w-[210px] rounded-md border border-line bg-ink-900/60 pl-6 pr-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none"
            />
          </div>
          {tab === "containers" ? (
            <>
              <Select
                value={stateFilter}
                onChange={setStateFilter}
                className="w-[124px]"
                options={[
                  { value: "all", label: "all states" },
                  ...["running", "exited", "paused", "restarting", "created", "dead"].map((state) => ({ value: state, label: state })),
                ]}
              />
              <Select
                value={projectFilter}
                onChange={setProjectFilter}
                className="w-[142px]"
                options={[
                  { value: "all", label: "all projects" },
                  ...(containers.data?.projects ?? []).map((project) => ({ value: project, label: project })),
                  { value: "standalone", label: "standalone" },
                ]}
              />
            </>
          ) : (
            <Button icon="trash" onClick={() => prune(tab === "images" ? "images" : tab === "volumes" ? "volumes" : "networks")}>
              prune {tab}
            </Button>
          )}
        </div>
      </div>

      <Panel padded={false} className="min-h-0 flex-1">
        {tab === "containers" ? (
          <Table
            className="h-full"
            head={
              <tr className="border-b border-line">
                <Th>container</Th>
                <Th>state</Th>
                <Th>image</Th>
                <Th>ports</Th>
                <Th>cpu</Th>
                <Th>mem</Th>
                <Th>restarts</Th>
                <Th>age</Th>
                <Th className="text-right">actions</Th>
              </tr>
            }
          >
            {filtered.map((container) => {
              const tone = stateTone(container);
              return (
                <tr key={container.id} className="cursor-pointer border-b border-line-soft/60" onClick={() => setSelected(container)}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Dot tone={tone} pulse={container.state === "running"} />
                      <span className="max-w-[190px] truncate font-mono text-[11px] text-slate-100">{container.name}</span>
                      {container.composeProject ? <Chip tone="info">{container.composeProject}</Chip> : null}
                    </div>
                  </Td>
                  <Td>
                    <span className={cn("font-mono text-[10px] uppercase tracking-[0.1em]", TONE_TEXT[tone])}>{container.statusText}</span>
                  </Td>
                  <Td className="max-w-[210px] truncate font-mono text-[10.5px] text-slate-400">{container.image}</Td>
                  <Td className="font-mono text-[10px] text-slate-400">
                    {container.ports.filter((port) => port.hostPort).map((port) => `${port.hostPort}→${port.containerPort}`).join(" ") || "—"}
                  </Td>
                  <Td className="tabular font-mono text-[10.5px]">{container.state === "running" ? `${container.cpuPct.toFixed(1)}%` : "—"}</Td>
                  <Td className="tabular font-mono text-[10.5px]">{container.memoryBytes ? formatBytes(container.memoryBytes) : "—"}</Td>
                  <Td className="tabular font-mono text-[10.5px]">{container.restartCount}</Td>
                  <Td className="font-mono text-[10px] text-slate-500">{timeAgo(container.createdAt)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                      {container.state === "running" ? (
                        <IconButton icon="stop" label="stop" onClick={() => act("stop", container.id)} disabled={busy === container.id} />
                      ) : (
                        <IconButton icon="play" label="start" onClick={() => act("start", container.id)} disabled={busy === container.id} />
                      )}
                      <IconButton icon="rotate" label="restart" onClick={() => act("restart", container.id)} disabled={busy === container.id} />
                      <IconButton icon="terminal" label="logs" onClick={() => setSelected(container)} />
                      <IconButton icon="trash" label="remove" tone="bad" onClick={() => act("remove", container.id)} disabled={busy === container.id || container.state === "running"} />
                    </div>
                  </Td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <Td className="py-10 text-center text-slate-500" >
                  {containers.loading ? "loading containers…" : "no container matches the filters"}
                </Td>
              </tr>
            ) : null}
          </Table>
        ) : null}

        {tab === "images" ? (
          <Table
            className="h-full"
            head={
              <tr className="border-b border-line">
                <Th>repository:tag</Th>
                <Th>id</Th>
                <Th>size</Th>
                <Th>containers</Th>
                <Th>created</Th>
                <Th className="text-right">actions</Th>
              </tr>
            }
          >
            {(resources.data?.images ?? [])
              .filter((image) => !query || image.repoTags.join(" ").toLowerCase().includes(query.toLowerCase()) || image.id.includes(query))
              .map((image) => (
                <tr key={image.id} className="border-b border-line-soft/60">
                  <Td className="font-mono text-[11px] text-slate-100">{image.repoTags[0] ?? "<none>"}</Td>
                  <Td className="font-mono text-[10px] text-slate-500">{image.id.replace("sha256:", "").slice(0, 12)}</Td>
                  <Td className="tabular font-mono text-[10.5px]">{formatBytes(image.sizeBytes)}</Td>
                  <Td>
                    <Chip tone={image.containers ? "ok" : "muted"}>{image.containers} in use</Chip>
                  </Td>
                  <Td className="font-mono text-[10px] text-slate-500">{timeAgo(image.created)}</Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button
                        size="xs"
                        variant="danger"
                        icon="trash"
                        disabled={busy === `image:${image.repoTags[0]}`}
                        onClick={() => removeResource(`image:${image.repoTags[0] ?? image.id}`)}
                      >
                        remove
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
          </Table>
        ) : null}

        {tab === "volumes" ? (
          <Table
            className="h-full"
            head={
              <tr className="border-b border-line">
                <Th>volume</Th>
                <Th>driver</Th>
                <Th>size</Th>
                <Th>used by</Th>
                <Th>created</Th>
                <Th className="text-right">actions</Th>
              </tr>
            }
          >
            {(resources.data?.volumes ?? [])
              .filter((volume) => !query || volume.name.toLowerCase().includes(query.toLowerCase()))
              .map((volume) => (
                <tr key={volume.name} className="border-b border-line-soft/60">
                  <Td className="font-mono text-[11px] text-slate-100">{volume.name}</Td>
                  <Td className="font-mono text-[10.5px] text-slate-400">{volume.driver}</Td>
                  <Td className="tabular font-mono text-[10.5px]">{volume.sizeBytes ? formatBytes(volume.sizeBytes) : "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {volume.usedBy.length ? volume.usedBy.slice(0, 3).map((name) => <Chip key={name} tone="info">{name}</Chip>) : <Chip tone="muted">dangling</Chip>}
                    </div>
                  </Td>
                  <Td className="font-mono text-[10px] text-slate-500">{timeAgo(volume.createdAt)}</Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button size="xs" variant="danger" icon="trash" disabled={volume.inUse || busy === `volume:${volume.name}`} onClick={() => removeResource(`volume:${volume.name}`)}>
                        remove
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
          </Table>
        ) : null}

        {tab === "networks" ? (
          <Table
            className="h-full"
            head={
              <tr className="border-b border-line">
                <Th>network</Th>
                <Th>driver</Th>
                <Th>scope</Th>
                <Th>subnet</Th>
                <Th>containers</Th>
                <Th className="text-right">actions</Th>
              </tr>
            }
          >
            {(resources.data?.networks ?? [])
              .filter((network) => !query || network.name.toLowerCase().includes(query.toLowerCase()))
              .map((network) => (
                <tr key={network.id} className="border-b border-line-soft/60">
                  <Td className="font-mono text-[11px] text-slate-100">
                    {network.name}
                    {network.internal ? <span className="ml-1.5"><Chip tone="warn">internal</Chip></span> : null}
                  </Td>
                  <Td className="font-mono text-[10.5px] text-slate-400">{network.driver}</Td>
                  <Td className="font-mono text-[10.5px] text-slate-400">{network.scope}</Td>
                  <Td className="font-mono text-[10.5px] text-slate-400">{network.subnet ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {network.containers.slice(0, 2).map((member) => (
                        <Chip key={member.id} tone="info">{member.name}</Chip>
                      ))}
                      {network.containers.length > 2 ? <Chip tone="muted">+{network.containers.length - 2}</Chip> : null}
                      {!network.containers.length ? <span className="text-slate-500">—</span> : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button size="xs" variant="danger" icon="trash" disabled={busy === `network:${network.name}`} onClick={() => removeResource(`network:${network.name}`)}>
                        remove
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
          </Table>
        ) : null}
      </Panel>

      <ContainerDrawer container={selected} onClose={() => setSelected(null)} onAction={act} busy={busy} />
      <RunModal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        onDone={(message, tone) => {
          setNotice({ tone, message });
          containers.refresh();
        }}
      />
    </div>
  );
}

function RunModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string, tone: Tone) => void }) {
  const [image, setImage] = useState("nginx:1.27-alpine");
  const [name, setName] = useState("dockflow-nginx");
  const [ports, setPorts] = useState("8088:80");
  const [env, setEnv] = useState("");
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setRunning(true);
    setError(null);
    try {
      const payload = await postJson<{ id: string; name: string }>("/api/engine/actions", {
        run: {
          image,
          name: name || undefined,
          ports: ports.split(",").map((value) => value.trim()).filter(Boolean),
          env: env.split("\n").map((value) => value.trim()).filter(Boolean),
          command: command || undefined,
        },
      });
      onDone(`Started ${payload.name || payload.id}`, "ok");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="docker run"
      footer={
        <div className="flex justify-end gap-1.5">
          <Button onClick={onClose}>cancel</Button>
          <Button variant="primary" icon="play" onClick={submit} disabled={running || !image.trim()}>
            {running ? "starting…" : "start container"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="image" required hint="tag or digest — pulled if missing">
          <TextInput value={image} onChange={setImage} placeholder="nginx:1.27-alpine" />
        </Field>
        <Field label="name">
          <TextInput value={name} onChange={setName} placeholder="dockflow-nginx" />
        </Field>
        <Field label="ports" hint="comma separated host:container">
          <TextInput value={ports} onChange={setPorts} placeholder="8088:80" />
        </Field>
        <Field label="environment" hint="one KEY=value per line">
          <textarea
            value={env}
            onChange={(event) => setEnv(event.target.value)}
            rows={3}
            placeholder={"LOG_LEVEL=info"}
            className="scroll-thin w-full rounded-md border border-line bg-ink-900/60 px-2 py-1.5 font-mono text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none"
          />
        </Field>
        <Field label="command">
          <TextInput value={command} onChange={setCommand} placeholder="sh -lc 'echo hello'" />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
