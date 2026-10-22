"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatMs, postJson, timeAgo, usePoll } from "@/lib/client";
import type { ApmAgent, ApmMap, ApmService, ServiceDetail, SpanRecord, TraceGroup, TracesResponse } from "@/lib/apm-types";
import { MapCanvas, type MapCard, type MapEdge } from "@/components/map/MapCanvas";
import { Bar, Button, Chip, Dot, Drawer, Empty, ErrorNote, KeyValue, Metric, Notice, PageHeader, Panel, Sparkline, Tabs, Toggle, type Tone } from "@/components/ui/primitives";

const KIND_TONE: Record<ApmService["kind"], Tone> = {
  gateway: "accent",
  service: "info",
  db: "warn",
  cache: "ok",
  queue: "info",
  external: "muted",
  runtime: "muted",
};

const KIND_LABEL: Record<ApmService["kind"], string> = {
  gateway: "gateway",
  service: "service",
  db: "database",
  cache: "cache",
  queue: "queue",
  external: "external",
  runtime: "runtime",
};

type View = "flow" | "hierarchy";

export default function ApmPage() {
  const [tab, setTab] = useState<"map" | "traces">("map");
  const [view, setView] = useState<View>("flow");
  const [selected, setSelected] = useState<string | null>(null);
  const [autoSim, setAutoSim] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);

  const map = usePoll<ApmMap & { agents: ApmAgent[] }>("/api/apm/map", tab === "map" ? 6000 : 0);
  const traces = usePoll<TracesResponse>("/api/apm/traces?limit=40", tab === "traces" ? 6000 : 0);

  const services = map.data?.services ?? [];
  const edges = map.data?.edges ?? [];

  const summary = useMemo(() => {
    const requests = services.reduce((sum, service) => sum + service.requests, 0);
    const errors = services.reduce((sum, service) => sum + service.errors, 0);
    const weighted = services.length ? services.reduce((sum, service) => sum + service.apdex, 0) / services.length : 0;
    const p95 = services.length ? Math.max(...services.map((service) => service.p95Ms)) : 0;
    const minutes = (map.data?.windowSeconds ?? 600) / 60;
    return { requests, errors, weighted, p95, rpm: minutes ? requests / minutes : 0, breaching: services.filter((s) => s.p95Ms > s.slaLatencyMs) };
  }, [services, map.data]);

  const simulate = async (silent = false) => {
    setSimulating(true);
    try {
      const result = await postJson<{ generated?: number; spans?: number }>("/api/apm/simulate", { batch: 8 });
      if (!silent) setNotice({ tone: "ok", message: `Generated synthetic traffic (${result.generated ?? result.spans ?? 0} spans).` });
      map.refresh();
      traces.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    if (!autoSim) return;
    const timer = setInterval(() => void simulate(true), 6000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSim]);

  const reset = async () => {
    try {
      await postJson("/api/apm/reset", {});
      setNotice({ tone: "warn", message: "Telemetry cleared — service registry kept." });
      map.refresh();
      traces.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const { cards, mapEdges } = useMemo(() => {
    const nodes: MapCard[] = [];
    const links: MapEdge[] = [];
    if (!services.length) return { cards: nodes, mapEdges: links };

    if (view === "hierarchy") {
      const rootId = "apm:root";
      nodes.push({
        id: rootId,
        parentId: null,
        title: "service hierarchy",
        subtitle: `${services.length} services · ${edges.length} call paths`,
        kind: "group",
        chips: [`${map.data?.agents.length ?? 0} agents`, `${Math.round((map.data?.windowSeconds ?? 600) / 60)} min window`],
      });
      const groups = new Map<ApmService["kind"], ApmService[]>();
      for (const service of services) groups.set(service.kind, [...(groups.get(service.kind) ?? []), service]);
      for (const [kind, list] of groups) {
        const groupId = `apm:kind:${kind}`;
        nodes.push({
          id: groupId,
          parentId: rootId,
          title: KIND_LABEL[kind],
          subtitle: `${list.length} service${list.length === 1 ? "" : "s"}`,
          kind: "group",
          tone: KIND_TONE[kind],
          chips: [`${list.reduce((sum, service) => sum + service.requests, 0)} req`],
        });
        links.push({ source: rootId, target: groupId, label: "tier", tone: KIND_TONE[kind] });
        for (const service of list) {
          nodes.push(serviceCard(service));
          links.push({ source: groupId, target: service.key, label: "member", tone: KIND_TONE[kind] });
        }
      }
    } else {
      for (const service of services) nodes.push(serviceCard(service));
      for (const edge of edges) {
        links.push({
          source: edge.source,
          target: edge.target,
          label: `${edge.calls} · ${formatMs(edge.avgMs)}`,
          tone: edge.errorRate > 0.05 ? "bad" : edge.errors > 0 ? "warn" : "accent",
          animated: edge.errorRate > 0.05,
        });
      }
    }
    return { cards: nodes, mapEdges: links };
  }, [services, edges, view, map.data]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="apm / service map"
        title="Application performance"
        description="Services are derived from live containers, the registry and telemetry-only agents. Traces are ingested at /radion/api/apm/ingest, rolled up over 60 minutes and pruned after 20."
        actions={
          <>
            <Button icon="refresh" onClick={() => { map.refresh(); traces.refresh(); }}>
              refresh
            </Button>
            <Button variant="primary" icon="zap" onClick={() => void simulate()} disabled={simulating}>
              {simulating ? "generating…" : "synthetic traffic"}
            </Button>
            <Button variant="danger" icon="trash" onClick={reset}>
              reset
            </Button>
          </>
        }
      />

      {map.data?.demo ? (
        <Notice tone="warn" icon="alert">
          Demo telemetry — no live agents have posted spans. Your engine containers are matched into services automatically; synthetic traffic is clearly labelled below.
        </Notice>
      ) : null}
      {map.error ? <ErrorNote message={map.error} onRetry={map.refresh} /> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="services" value={services.length} hint={`${edges.length} call paths`} icon="activity" tone="accent" />
        <Metric label="apdex" value={services.length ? summary.weighted.toFixed(2) : "…"} hint="mean across services" icon="gauge" tone={summary.weighted > 0.9 ? "ok" : summary.weighted > 0.75 ? "warn" : "bad"} />
        <Metric label="requests" value={summary.requests} hint={`${summary.rpm.toFixed(1)} rpm`} icon="send" tone="info" />
        <Metric label="errors" value={summary.errors} hint={summary.requests ? `${((summary.errors / summary.requests) * 100).toFixed(2)}% of traffic` : "no traffic"} icon="alert" tone={summary.errors ? "bad" : "ok"} />
        <Metric label="p95 (worst)" value={formatMs(summary.p95)} hint={`${summary.breaching.length} over SLA`} icon="clock" tone={summary.breaching.length ? "warn" : "ok"} />
        <Metric label="window" value={`${Math.round((map.data?.windowSeconds ?? 600) / 60)}m`} hint="retention 20m · rollup 60m" icon="layers" tone="muted" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "map", label: "service map", count: services.length, icon: "network" },
            { value: "traces", label: "traces", count: traces.data?.total, icon: "activity" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {tab === "map" ? (
            <div className="flex overflow-hidden rounded-md border border-line">
              {(["flow", "hierarchy"] as View[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={cn(
                    "px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em]",
                    view === option ? "bg-ice/15 text-ice" : "text-slate-400 hover:text-slate-200",
                  )}
                >
                  {option === "flow" ? "call flow" : "hierarchy"}
                </button>
              ))}
            </div>
          ) : null}
          <div className="w-[190px]">
            <Toggle checked={autoSim} onChange={setAutoSim} label="synthetic stream" hint="6s · labelled" />
          </div>
          {autoSim ? <Chip tone="warn">SYNTHETIC</Chip> : null}
        </div>
      </div>

      {tab === "map" ? (
        <Panel padded={false} className="min-h-0 flex-1 overflow-hidden">
          <MapCanvas
            cards={cards}
            edges={mapEdges}
            layout={view === "flow" ? "layered" : "tree"}
            initialLevels={3}
            selectedId={selected}
            onSelect={setSelected}
            emptyMessage="No APM services yet — post spans or generate synthetic traffic."
            legend={[
              { label: "healthy", tone: "ok" },
              { label: "errors", tone: "warn" },
              { label: "failing", tone: "bad" },
            ]}
            overlay={
              <>
                {autoSim ? <Chip tone="warn">synthetic stream on</Chip> : null}
                {map.data ? <Chip tone="muted">updated {timeAgo(map.data.generatedAt)}</Chip> : null}
              </>
            }
          />
        </Panel>
      ) : (
        <TracesPanel traces={traces.data} services={services} error={traces.error} onRetry={traces.refresh} />
      )}

      <ServiceDrawer serviceKey={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function serviceCard(service: ApmService): MapCard {
  const tone = KIND_TONE[service.kind];
  return {
    id: service.key,
    parentId: null,
    title: service.name,
    subtitle: `${KIND_LABEL[service.kind]}${service.team ? ` · ${service.team}` : ""}${service.runtime ? ` · ${service.runtime}` : ""}`,
    kind: service.kind === "db" ? "database" : service.kind === "gateway" ? "network" : "service",
    tone,
    badge: service.apdex.toFixed(2),
    chips: [
      `${service.requests} req`,
      `err ${(service.errorRate * 100).toFixed(1)}%`,
      `p95 ${formatMs(service.p95Ms)}`,
      service.containerName ? `⇢ ${service.containerName}` : `${service.agents.length} agent`,
    ],
    stats: [
      {
        label: "apdex",
        pct: service.apdex * 100,
        value: (service.apdex * 100).toFixed(0),
        tone: service.apdex > 0.9 ? "ok" : service.apdex > 0.75 ? "warn" : "bad",
      },
      {
        label: "sla",
        pct: Math.min(100, (service.p95Ms / Math.max(1, service.slaLatencyMs)) * 100),
        value: `${Math.round((service.p95Ms / Math.max(1, service.slaLatencyMs)) * 100)}%`,
        tone: service.p95Ms > service.slaLatencyMs ? "bad" : "ok",
      },
    ],
  };
}

function TracesPanel({
  traces,
  services,
  error,
  onRetry,
}: {
  traces: TracesResponse | null;
  services: ApmService[];
  error: string | null;
  onRetry: () => void;
}) {
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");

  const list = (traces?.traces ?? []).filter((trace) => {
    if (statusFilter !== "all" && trace.status !== statusFilter) return false;
    if (serviceFilter !== "all" && !trace.services.includes(serviceFilter)) return false;
    return true;
  });
  const active = list.find((trace) => trace.traceId === selectedTrace) ?? list[0] ?? null;
  const buckets = traces?.buckets ?? [];
  const maxRpm = Math.max(1, ...buckets.map((bucket) => bucket.requests));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? <ErrorNote message={error} onRetry={onRetry} /> : null}
      <Panel title="requests per minute" subtitle="last 20 minutes · errors stacked in red" icon="activity">
        <div className="flex h-[64px] items-end gap-[3px]">
          {buckets.map((bucket) => (
            <div key={bucket.minute} className="group relative flex-1" title={`${bucket.label} · ${bucket.requests} req · ${bucket.errors} err`}>
              <div className="relative flex w-full flex-col justify-end" style={{ height: 56 }}>
                <div className="w-full rounded-sm bg-ice/40" style={{ height: `${Math.max(2, (bucket.requests / maxRpm) * 56)}px` }}>
                  {bucket.errors ? (
                    <div
                      className="absolute bottom-0 w-full rounded-sm bg-rose-500/70"
                      style={{ height: `${Math.max(2, (bucket.errors / maxRpm) * 56)}px` }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {!buckets.length ? <p className="text-[11.5px] text-slate-500">no buckets in the window</p> : null}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-500">
          <span>{buckets[0]?.label ?? ""}</span>
          <span>now</span>
        </div>
      </Panel>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel
          title="traces"
          subtitle={`${traces?.total ?? 0} in window · ${traces?.errorTraces ?? 0} with errors`}
          icon="layers"
          padded={false}
          actions={
            <div className="flex items-center gap-1">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-6 rounded border border-line bg-ink-900/60 px-1 font-mono text-[9.5px] text-slate-300"
              >
                <option value="all">all</option>
                <option value="error">errors</option>
                <option value="ok">ok</option>
              </select>
              <select
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                className="h-6 max-w-[132px] rounded border border-line bg-ink-900/60 px-1 font-mono text-[9.5px] text-slate-300"
              >
                <option value="all">all services</option>
                {services.map((service) => (
                  <option key={service.key} value={service.key}>
                    {service.name}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <div className="scroll-thin flex max-h-[calc(100vh-330px)] flex-col divide-y divide-[var(--line-soft)] overflow-y-auto">
            {list.map((trace) => (
              <button
                key={trace.traceId}
                type="button"
                onClick={() => setSelectedTrace(trace.traceId)}
                className={cn(
                  "flex flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-ice/[0.06]",
                  active?.traceId === trace.traceId && "bg-ice/[0.09]",
                )}
              >
                <div className="flex items-center gap-2">
                  <Dot tone={trace.status === "error" ? "bad" : "ok"} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-200">{trace.entryOperation}</span>
                  <span className="shrink-0 font-mono text-[9.5px] text-slate-400">{formatMs(trace.durationMs)}</span>
                </div>
                <div className="flex items-center gap-1.5 pl-3">
                  <span className="truncate font-mono text-[9px] text-slate-500">{trace.services.join(" → ")}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-slate-500">{trace.spanCount} spans</span>
                </div>
              </button>
            ))}
            {!list.length ? <Empty icon="activity" title="No traces match" hint="Generate synthetic traffic or post spans to /radion/api/apm/ingest." /> : null}
          </div>
        </Panel>

        <Panel title="waterfall" subtitle={active ? `${active.traceId.slice(0, 16)} · ${active.spanCount} spans` : "select a trace"} icon="layers">
          {active ? <Waterfall trace={active} /> : <Empty icon="layers" title="Pick a trace to see its waterfall" />}
        </Panel>
      </div>
    </div>
  );
}

function Waterfall({ trace }: { trace: TraceGroup }) {
  const spans = [...trace.spans].sort((a, b) => a.startTime - b.startTime);
  const start = Math.min(...spans.map((span) => span.startTime));
  const total = Math.max(trace.durationMs, 1);
  const depthOf = (span: SpanRecord): number => {
    let depth = 0;
    let current = span.parentSpanId;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current)) break;
      seen.add(current);
      const parent = spans.find((candidate) => candidate.spanId === current);
      if (!parent) break;
      depth += 1;
      current = parent.parentSpanId;
    }
    return Math.min(depth, 6);
  };

  return (
    <div className="scroll-thin flex max-h-[calc(100vh-330px)] flex-col gap-1 overflow-y-auto">
      <div className="mb-1 flex items-center gap-2">
        <Chip tone={trace.status === "error" ? "bad" : "ok"}>{trace.status}</Chip>
        <Chip tone="muted">{formatMs(trace.durationMs)} total</Chip>
        <Chip tone="info">{trace.errorCount} errors</Chip>
        <span className="ml-auto font-mono text-[9px] text-slate-500">{new Date(trace.startTime).toLocaleTimeString()}</span>
      </div>
      {spans.map((span) => {
        const depth = depthOf(span);
        const offset = ((span.startTime - start) / total) * 100;
        const width = Math.max(0.6, (span.durationMs / total) * 100);
        return (
          <div key={span.spanId} className="flex items-center gap-2">
            <div className="flex w-[168px] shrink-0 items-center gap-1" style={{ paddingLeft: depth * 10 }}>
              <span className={cn("h-[5px] w-[5px] shrink-0 rounded-full", span.status === "error" ? "bg-rose-400" : span.kind === "client" ? "bg-sky-400" : "bg-emerald-400")} />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300" title={`${span.serviceKey} · ${span.operation}`}>
                {span.operation}
              </span>
            </div>
            <div className="relative h-[14px] min-w-0 flex-1 rounded border border-line/50 bg-ink-900/40">
              <div
                className={cn("absolute top-0 h-full rounded-sm", span.status === "error" ? "bg-rose-500/60" : "bg-ice/45")}
                style={{ left: `${Math.min(99, offset)}%`, width: `${Math.min(100 - offset, width)}%` }}
                title={`${span.serviceKey} · ${formatMs(span.durationMs)}${span.errorMessage ? ` · ${span.errorMessage}` : ""}`}
              />
            </div>
            <span className="w-[54px] shrink-0 text-right font-mono text-[9.5px] text-slate-400">{formatMs(span.durationMs)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ServiceDrawer({ serviceKey, onClose }: { serviceKey: string | null; onClose: () => void }) {
  const detail = usePoll<ServiceDetail>(serviceKey ? `/api/apm/service/${encodeURIComponent(serviceKey)}` : null);
  const service = detail.data?.service;

  return (
    <Drawer
      open={Boolean(serviceKey)}
      onClose={onClose}
      width={480}
      title={service?.name ?? "service"}
      subtitle={service ? `${KIND_LABEL[service.kind]} · ${service.key}` : ""}
    >
      {detail.error ? <ErrorNote message={detail.error} onRetry={detail.refresh} /> : null}
      {service ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            <Metric label="apdex" value={service.apdex.toFixed(2)} tone={service.apdex > 0.9 ? "ok" : service.apdex > 0.75 ? "warn" : "bad"} />
            <Metric label="p95" value={formatMs(service.p95Ms)} hint={`sla ${formatMs(service.slaLatencyMs)}`} tone={service.p95Ms > service.slaLatencyMs ? "bad" : "ok"} />
            <Metric label="errors" value={`${(service.errorRate * 100).toFixed(1)}%`} hint={`${service.errors}/${service.requests}`} tone={service.errorRate > 0.05 ? "bad" : "ok"} />
          </div>
          <KeyValue
            rows={[
              { label: "team", value: service.team ?? "—" },
              { label: "runtime", value: service.runtime ?? "—" },
              { label: "container", value: service.containerName ? `${service.containerName} (${service.containerState})` : "telemetry only" },
              { label: "last seen", value: timeAgo(service.lastSeenAt) },
              { label: "stats", value: <>avg {formatMs(service.avgMs)} · max {formatMs(service.maxMs)}</> },
              { label: "error budget", value: `${(service.slaErrorRate * 100).toFixed(1)}% allowed` },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="glass-inset rounded-lg border p-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">callers</p>
              <div className="mt-1 flex flex-col gap-1">
                {(detail.data?.callers ?? []).map((edge) => (
                  <div key={edge.source} className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{edge.source.split(":").pop()}</span>
                    <span className="font-mono text-[9px] text-slate-500">{formatMs(edge.avgMs)}</span>
                  </div>
                ))}
                {!(detail.data?.callers ?? []).length ? <p className="text-[10.5px] text-slate-500">entry service</p> : null}
              </div>
            </div>
            <div className="glass-inset rounded-lg border p-2">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">callees</p>
              <div className="mt-1 flex flex-col gap-1">
                {(detail.data?.callees ?? []).map((edge) => (
                  <div key={edge.target} className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{edge.target.split(":").pop()}</span>
                    <span className="font-mono text-[9px] text-slate-500">{formatMs(edge.avgMs)}</span>
                  </div>
                ))}
                {!(detail.data?.callees ?? []).length ? <p className="text-[10.5px] text-slate-500">leaf service</p> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">operations</p>
            {(detail.data?.operations ?? []).slice(0, 8).map((operation) => (
              <div key={operation.operation} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-300">{operation.operation}</span>
                <span className="w-14 shrink-0 text-right font-mono text-[9.5px] text-slate-500">{operation.calls} calls</span>
                <div className="w-16 shrink-0">
                  <Bar value={operation.p95Ms} max={Math.max(1, service.p95Ms)} tone={operation.p95Ms > service.slaLatencyMs ? "bad" : "ok"} height={4} />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-[9px] text-slate-400">{formatMs(operation.p95Ms)}</span>
              </div>
            ))}
          </div>

          {(detail.data?.errorSignatures ?? []).length ? (
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">error signatures</p>
              {detail.data?.errorSignatures.slice(0, 5).map((signature) => (
                <div key={signature.message} className="rounded border border-rose-500/25 bg-rose-500/8 px-2 py-1">
                  <p className="truncate font-mono text-[10px] text-rose-200">{signature.message}</p>
                  <p className="font-mono text-[9px] text-slate-500">×{signature.count} · last {timeAgo(signature.lastSeen)}</p>
                </div>
              ))}
            </div>
          ) : null}

          {service.agents.length ? (
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">agents</p>
              {service.agents.map((agent) => (
                <div key={agent.agent} className="flex items-center gap-2 rounded border border-line/60 px-2 py-1">
                  <IconAgent />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{agent.agent}</span>
                  <span className="font-mono text-[9px] text-slate-500">{agent.spanCount} spans</span>
                </div>
              ))}
            </div>
          ) : null}

          {(detail.data?.slowest ?? []).length ? (
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">slowest spans</p>
              {detail.data?.slowest.slice(0, 5).map((span) => (
                <div key={span.spanId} className="flex items-center gap-2">
                  <Dot tone={span.status === "error" ? "bad" : "info"} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{span.operation}</span>
                  <span className="font-mono text-[9.5px] text-slate-400">{formatMs(span.durationMs)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded border border-line/60 px-2 py-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">requests trend</span>
            <Sparkline values={[service.avgMs, service.p95Ms, service.maxMs]} width={120} height={24} tone="info" />
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function IconAgent() {
  return <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-line text-[8px] text-slate-400">◈</span>;
}
