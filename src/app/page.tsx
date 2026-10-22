"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, formatMs, postJson, timeAgo, usePoll } from "@/lib/client";
import type { EngineStatus, ContainerInfo } from "@/lib/docker/types";
import type { ApmMap } from "@/lib/apm-types";
import type { BinaryInfo } from "@/lib/cli";
import { Button, Chip, Dot, ErrorNote, Metric, Notice, PageHeader, Panel, TONE_TEXT, type Tone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { Sparkline } from "@/components/ui/primitives";

interface OverviewPayload {
  status: EngineStatus;
  containers: ContainerInfo[];
  projects: { name: string; containers: number; running: number }[];
  counts: { containers: number; running: number; stopped: number; attention: number; cpu: number; memory: number };
  resources: { images: number; volumes: number; networks: number; danglingVolumes: number; unusedImages: number };
}

interface RunRow {
  id: string;
  workflowName: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  startedAt: string;
  finishedAt: string | null;
  steps: { status: string }[];
  error: string | null;
}

const runTone = (status: RunRow["status"]): Tone =>
  status === "success" ? "ok" : status === "failed" ? "bad" : status === "cancelled" ? "warn" : status === "running" ? "info" : "muted";

export default function OverviewPage() {
  const overview = usePoll<OverviewPayload>("/api/engine/overview", 6000);
  const apm = usePoll<ApmMap & { agents: unknown[] }>("/api/apm/map", 10_000);
  const runs = usePoll<{ runs: RunRow[] }>("/api/workflows/runs?limit=6", 8000);
  const binaries = usePoll<{ binaries: BinaryInfo[] }>("/api/cli/detect?limit=10", 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);

  const data = overview.data;
  const busiest = useMemo(
    () => [...(data?.containers ?? [])].filter((container) => container.state === "running").sort((a, b) => b.cpuPct - a.cpuPct).slice(0, 5),
    [data],
  );
  const attention = useMemo(
    () => (data?.containers ?? []).filter((c) => c.state === "restarting" || c.health === "unhealthy" || (c.state === "exited" && (c.exitCode ?? 0) !== 0)),
    [data],
  );

  const apmSummary = useMemo(() => {
    const services = apm.data?.services ?? [];
    const weighted = services.length ? services.reduce((sum, service) => sum + service.apdex, 0) / services.length : 0;
    const errors = services.reduce((sum, service) => sum + service.errors, 0);
    const requests = services.reduce((sum, service) => sum + service.requests, 0);
    const slowest = [...services].sort((a, b) => b.p95Ms - a.p95Ms)[0];
    return { weighted, errors, requests, slowest, breaching: services.filter((service) => service.p95Ms > service.slaLatencyMs) };
  }, [apm.data]);

  const act = async (body: Record<string, unknown>, key: string, message: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await postJson("/api/engine/actions", body);
      setNotice({ tone: "ok", message });
      overview.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        eyebrow="console / overview"
        title="Engine at a glance"
        description="One screen for the local Docker estate: engine health, the busiest containers, project controls, APM posture, recent automation and the CLI tooling on your PATH."
        actions={
          <>
            <Button icon="refresh" onClick={() => { overview.refresh(); apm.refresh(); runs.refresh(); }}>
              refresh
            </Button>
            <Link href="/containers">
              <Button variant="primary" icon="box">
                inventory
              </Button>
            </Link>
          </>
        }
      />

      {data?.status.demo ? (
        <Notice tone="warn" icon="alert">
          <strong className="font-semibold">Demo engine.</strong> No Docker endpoint answered the probe, so every figure below comes from the in-memory simulator.
          {data.status.error ? <span className="ml-1 break-all font-mono text-[10.5px] text-amber-200/80">Real error: {data.status.error}</span> : null}
        </Notice>
      ) : null}
      {overview.error ? <ErrorNote message={overview.error} onRetry={overview.refresh} /> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="engine" value={data?.status.mode ?? "…"} hint={data?.status.engine?.serverVersion ?? "probing"} icon="engine" tone={data?.status.mode === "live" ? "ok" : data?.status.mode === "demo" ? "warn" : "bad"} />
        <Metric label="containers" value={data?.counts.containers ?? "…"} hint={`${data?.counts.running ?? 0} running · ${data?.counts.stopped ?? 0} stopped`} icon="box" tone="accent" />
        <Metric label="attention" value={data?.counts.attention ?? "…"} hint="need a human" icon="alert" tone={(data?.counts.attention ?? 0) > 0 ? "bad" : "ok"} />
        <Metric label="cpu load" value={`${(data?.counts.cpu ?? 0).toFixed(1)}%`} hint="sum of running containers" icon="cpu" tone="info" />
        <Metric label="memory" value={formatBytes(data?.counts.memory ?? 0)} hint={`${data?.resources.images ?? 0} images · ${data?.resources.volumes ?? 0} volumes`} icon="memory" />
        <Metric label="apdex" value={apm.data ? apmSummary.weighted.toFixed(2) : "…"} hint={`${apmSummary.requests} req · ${apmSummary.errors} err`} icon="activity" tone={apmSummary.weighted > 0.9 ? "ok" : apmSummary.weighted > 0.75 ? "warn" : "bad"} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Panel
          title="engine"
          subtitle={data?.status.endpoint ?? "no endpoint configured"}
          icon="engine"
          actions={
            <Button size="xs" icon="refresh" onClick={() => overview.refresh()}>
              probe
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {[
              { label: "mode", value: data?.status.mode ?? "—" },
              { label: "server", value: data?.status.engine?.serverVersion ?? "—" },
              { label: "api", value: data?.status.engine?.apiVersion ?? "—" },
              { label: "host", value: data?.status.engine?.host ?? "—" },
              { label: "os / arch", value: data?.status.engine ? `${data.status.engine.os} / ${data.status.engine.arch}` : "—" },
              { label: "kernel", value: data?.status.engine?.kernel ?? "—" },
              { label: "cpus", value: String(data?.status.engine?.cpus ?? "—") },
              { label: "memory", value: formatBytes(data?.status.engine?.memoryBytes ?? 0) },
              { label: "storage", value: data?.status.engine?.storageDriver ?? "—" },
              { label: "runtime", value: data?.status.engine?.runtime ?? "—" },
              { label: "cgroup", value: data?.status.engine?.cgroupVersion ?? "—" },
              { label: "latency", value: data?.status.latencyMs !== null && data?.status.latencyMs !== undefined ? `${data.status.latencyMs}ms` : "—" },
            ].map((row) => (
              <div key={row.label} className="flex min-w-0 flex-col">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">{row.label}</span>
                <span className="truncate font-mono text-[11px] text-slate-200" title={row.value}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          {data?.status.engine?.warnings?.length ? (
            <div className="mt-2 flex flex-col gap-1">
              {data.status.engine.warnings.map((warning) => (
                <Notice key={warning} tone="warn" icon="alert">
                  {warning}
                </Notice>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button size="xs" icon="trash" variant="danger" onClick={() => act({ prune: "images" }, "prune-images", "Pruned unused images")}>
              prune images ({data?.resources.unusedImages ?? 0})
            </Button>
            <Button size="xs" icon="trash" variant="danger" onClick={() => act({ prune: "volumes" }, "prune-volumes", "Pruned dangling volumes")}>
              prune volumes ({data?.resources.danglingVolumes ?? 0})
            </Button>
            <Button size="xs" icon="trash" variant="danger" onClick={() => act({ prune: "networks" }, "prune-networks", "Pruned unused networks")}>
              prune networks
            </Button>
          </div>
        </Panel>

        <Panel title="busiest containers" subtitle="top five by cpu" icon="cpu" padded={false}>
          <div className="flex flex-col divide-y divide-[var(--line-soft)]">
            {busiest.length ? (
              busiest.map((container) => (
                <div key={container.id} className="flex items-center gap-2 px-3.5 py-2">
                  <Dot tone={container.health === "unhealthy" ? "bad" : "ok"} pulse />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-slate-100">{container.name}</p>
                    <p className="truncate font-mono text-[9.5px] text-slate-500">{container.image}</p>
                  </div>
                  <div className="w-[92px] shrink-0">
                    <Sparkline values={container.history?.cpu ?? [container.cpuPct]} width={92} height={22} tone={container.cpuPct > 70 ? "bad" : "accent"} />
                  </div>
                  <div className="w-14 shrink-0 text-right">
                    <p className="tabular font-mono text-[10.5px] text-slate-200">{container.cpuPct.toFixed(1)}%</p>
                    <p className="tabular font-mono text-[9px] text-slate-500">{formatBytes(container.memoryBytes)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-3.5 py-6 text-center text-[11.5px] text-slate-500">{overview.loading ? "loading…" : "no running containers"}</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Panel title="projects" subtitle="compose controls" icon="stack">
          <div className="flex flex-col gap-1.5">
            {(data?.projects ?? []).length ? (
              data?.projects.map((project) => (
                <div key={project.name} className="flex items-center gap-2 rounded-md border border-line/60 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] text-slate-100">{project.name}</p>
                    <p className="font-mono text-[9.5px] text-slate-500">
                      {project.running}/{project.containers} running
                    </p>
                  </div>
                  <Button size="xs" icon="play" disabled={busy === `p-${project.name}`} onClick={() => act({ project: project.name, action: "start" }, `p-${project.name}`, `${project.name} start requested`)}>
                    start
                  </Button>
                  <Button size="xs" icon="rotate" disabled={busy === `p-${project.name}`} onClick={() => act({ project: project.name, action: "restart" }, `p-${project.name}`, `${project.name} restart requested`)}>
                    restart
                  </Button>
                  <Button size="xs" icon="stop" disabled={busy === `p-${project.name}`} onClick={() => act({ project: project.name, action: "stop" }, `p-${project.name}`, `${project.name} stop requested`)}>
                    stop
                  </Button>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-[11.5px] text-slate-500">no compose projects detected</p>
            )}
          </div>
          {attention.length ? (
            <div className="mt-3 flex flex-col gap-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">needs attention</p>
              {attention.slice(0, 4).map((container) => (
                <div key={container.id} className="flex items-center gap-1.5">
                  <Dot tone="bad" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-300">{container.name}</span>
                  <Chip tone="bad">{container.statusText}</Chip>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel
          title="apm snapshot"
          subtitle={apm.data ? `${apm.data.services.length} services · ${Math.round(apm.data.windowSeconds / 60)} min window` : "loading"}
          icon="activity"
          actions={
            <Link href="/apm">
              <Button size="xs" icon="arrowRight">
                open
              </Button>
            </Link>
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">weighted apdex</p>
                <p className={cn("tabular text-[26px] font-semibold leading-none", TONE_TEXT[apmSummary.weighted > 0.9 ? "ok" : apmSummary.weighted > 0.75 ? "warn" : "bad"])}>
                  {apmSummary.weighted.toFixed(2)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">requests</p>
                <p className="tabular font-mono text-[13px] text-slate-100">{apmSummary.requests}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">errors</p>
                <p className={cn("tabular font-mono text-[13px]", apmSummary.errors ? "text-rose-300" : "text-slate-100")}>{apmSummary.errors}</p>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {(apm.data?.services ?? []).slice(0, 4).map((service) => (
                <div key={service.key} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-300">{service.name}</span>
                  <span className="shrink-0 font-mono text-[9.5px] text-slate-500">p95 {formatMs(service.p95Ms)}</span>
                  <Chip tone={service.p95Ms > service.slaLatencyMs ? "bad" : service.apdex > 0.9 ? "ok" : "warn"}>
                    {service.apdex.toFixed(2)}
                  </Chip>
                </div>
              ))}
            </div>
            {apmSummary.breaching.length ? (
              <p className="font-mono text-[9.5px] text-amber-300">{apmSummary.breaching.length} service(s) over their latency SLA</p>
            ) : (
              <p className="font-mono text-[9.5px] text-emerald-300">all services inside their SLA</p>
            )}
          </div>
        </Panel>

        <Panel
          title="recent runs"
          subtitle="workflow automation"
          icon="workflow"
          actions={
            <Link href="/workflows">
              <Button size="xs" icon="arrowRight">
                builder
              </Button>
            </Link>
          }
        >
          <div className="flex flex-col gap-1">
            {(runs.data?.runs ?? []).length ? (
              runs.data?.runs.slice(0, 5).map((run) => (
                <div key={run.id} className="flex items-center gap-2 rounded border border-line/60 px-2 py-1">
                  <Dot tone={runTone(run.status)} pulse={run.status === "running"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[10.5px] text-slate-200">{run.workflowName ?? "workflow"}</p>
                    <p className="font-mono text-[9px] text-slate-500">
                      {timeAgo(run.startedAt)} · {run.steps?.length ?? 0} steps
                    </p>
                  </div>
                  <Chip tone={runTone(run.status)}>{run.status}</Chip>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-[11.5px] text-slate-500">{runs.loading ? "loading…" : "no runs recorded yet"}</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title="local tooling"
        subtitle="PATH scan — installed binaries only"
        icon="terminal"
        actions={
          <>
            <Button size="xs" icon="refresh" onClick={() => binaries.refresh()}>
              rescan
            </Button>
            <Link href="/cli">
              <Button size="xs" icon="terminal">
                runner
              </Button>
            </Link>
          </>
        }
      >
        {binaries.error ? <ErrorNote message={binaries.error} onRetry={binaries.refresh} /> : null}
        <div className="flex flex-wrap gap-1.5">
          {(binaries.data?.binaries ?? []).map((binary) => (
            <span
              key={binary.name}
              className={cn(
                "inline-flex items-center gap-1.5 rounded border px-1.5 py-1 font-mono text-[10px]",
                binary.installed ? "border-emerald-500/30 bg-emerald-500/8 text-slate-200" : "border-line bg-slate-500/5 text-slate-500",
              )}
              title={binary.installed ? binary.version ?? "" : binary.error}
            >
              <Icon name={binary.installed ? "check" : "x"} size={10} className={binary.installed ? "text-emerald-300" : "text-slate-500"} />
              {binary.name}
              {binary.installed ? <span className="text-[9px] text-slate-500">{binary.version?.slice(0, 26)}</span> : null}
            </span>
          ))}
          {binaries.loading ? <span className="font-mono text-[10.5px] text-slate-500">scanning PATH…</span> : null}
        </div>
      </Panel>
    </div>
  );
}
