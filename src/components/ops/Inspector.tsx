"use client";

import { memo, useMemo } from "react";
import type { NodeStatus, TopologyNode } from "@/lib/types";
import { GAUGE_STRIP_TYPES, NODE_LABEL } from "@/lib/types";
import { ancestorsOf, clockTime, descendantsOf, formatCompact, formatNumber, metricTone, NODE_TYPE_ABBREV, STATUS_TONE, timeAgo } from "@/lib/graph";
import { useOps, type InspectorTab } from "@/store/ops";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ops/icons";
import { ArcGauge, Chip, Sparkline, StatusDot } from "@/components/ops/primitives";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "overview", label: "overview" },
  { id: "metrics", label: "metrics" },
  { id: "children", label: "children" },
  { id: "console", label: "cli" },
];

export const Inspector = memo(function Inspector() {
  const selectedId = useOps((s) => s.selectedId);
  const node = useOps((s) => (selectedId ? s.nodesById[selectedId] : undefined));
  const tab = useOps((s) => s.inspectorTab);
  const setTab = useOps((s) => s.setInspectorTab);

  return (
    <aside className="flex w-[336px] shrink-0 flex-col border-l border-line bg-ink-900/80">
      <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-line-soft px-2.5">
        <Icon name="target" size={12} className="text-ice" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">node inspector</span>
        <span className="ml-auto font-mono text-[9px] text-slate-600">{selectedId ? selectedId.slice(0, 26) : "—"}</span>
      </header>

      {!node ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Icon name="network" size={26} className="text-slate-700" />
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-600">no node selected</p>
          <p className="text-[11px] leading-relaxed text-slate-600">
            Click any container, service or endpoint in the sub-flow canvas — or pick it from the hierarchy navigator.
          </p>
        </div>
      ) : (
        <>
          <InspectorHeader node={node} />
          <nav className="flex shrink-0 gap-px border-b border-line-soft bg-ink-950/40 px-1">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={cn(
                  "flex-1 border-b-2 px-1 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] transition",
                  tab === entry.id ? "border-ice text-ice" : "border-transparent text-slate-500 hover:text-slate-300",
                )}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
            {tab === "overview" ? <OverviewTab node={node} /> : null}
            {tab === "metrics" ? <MetricsTab node={node} /> : null}
            {tab === "children" ? <ChildrenTab node={node} /> : null}
            {tab === "console" ? <ConsoleTab node={node} /> : null}
          </div>
        </>
      )}
    </aside>
  );
});

function InspectorHeader({ node }: { node: TopologyNode }) {
  const nodesById = useOps((s) => s.nodesById);
  const requestFocus = useOps((s) => s.requestFocus);
  const expandBranch = useOps((s) => s.expandBranch);
  const collapseBranch = useOps((s) => s.collapseBranch);
  const setNodeStatus = useOps((s) => s.setNodeStatus);
  const chain = useMemo(() => ancestorsOf(node.id, nodesById), [node.id, nodesById]);
  const tone = STATUS_TONE[node.status];

  return (
    <div className="shrink-0 border-b border-line-soft bg-ink-850/50 px-2.5 py-2">
      <div className="flex items-center gap-1 overflow-x-auto scroll-thin pb-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-600">
        {chain.map((ancestor, index) => (
          <span key={ancestor.id} className="flex shrink-0 items-center gap-1">
            {index > 0 ? <Icon name="chevron" size={8} className="text-slate-700" /> : null}
            <button type="button" onClick={() => requestFocus(ancestor.id)} className="transition hover:text-ice">
              {ancestor.name.length > 18 ? `${ancestor.name.slice(0, 17)}…` : ancestor.name}
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold leading-tight text-slate-100" title={node.name}>
            {node.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Chip tone="ice">{NODE_TYPE_ABBREV[node.type]}</Chip>
            <span className={cn("flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em]", tone.text)}>
              <StatusDot status={node.status} size={6} />
              {tone.label}
            </span>
            {node.kind ? <Chip>{node.kind}</Chip> : null}
            {node.region ? <Chip tone="violet">{node.region}</Chip> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Action icon="target" label="focus" onClick={() => requestFocus(node.id)} />
        <Action icon="tree" label="expand" onClick={() => expandBranch(node.id)} />
        <Action icon="group" label="collapse" onClick={() => collapseBranch(node.id)} />
        <Action
          icon="shield"
          label={node.status === "maintenance" ? "resume" : "maintain"}
          onClick={() => setNodeStatus(node.id, node.status === "maintenance" ? "healthy" : "maintenance")}
        />
        {node.status !== "healthy" && node.status !== "maintenance" ? (
          <Action icon="check" label="mark healthy" onClick={() => setNodeStatus(node.id, "healthy")} />
        ) : null}
      </div>
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-line bg-ink-850 px-1.5 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-500 transition hover:border-ice/40 hover:text-ice"
    >
      <Icon name={icon} size={10} />
      {label}
    </button>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line-soft/60 py-[5px]">
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-600">{label}</span>
      <span className={cn("tabular truncate text-right font-mono text-[10.5px] text-slate-300", tone)}>{value}</span>
    </div>
  );
}

function OverviewTab({ node }: { node: TopologyNode }) {
  const metric = useOps((s) => s.metrics[node.id]);
  const series = useOps((s) => s.series[node.id]);
  const childrenOf = useOps((s) => s.childrenOf);
  const nodesById = useOps((s) => s.nodesById);
  const descendantCount = useOps((s) => s.descendantCount[node.id] ?? 0);

  const rollup = useMemo(() => {
    const ids = descendantsOf(node.id, childrenOf);
    const counts: Record<NodeStatus, number> = { healthy: 0, degraded: 0, critical: 0, offline: 0, maintenance: 0 };
    let endpoints = 0;
    let services = 0;
    for (const id of ids) {
      const child = nodesById[id];
      if (!child) continue;
      counts[child.status] += 1;
      if (child.type === "endpoint") endpoints += 1;
      if (child.type === "service") services += 1;
    }
    return { counts, endpoints, services, total: ids.length };
  }, [node.id, childrenOf, nodesById]);

  const metaEntries = Object.entries(node.meta).filter(([key]) => !["metric", "unit", "index", "tier"].includes(key));

  return (
    <div className="flex flex-col gap-2.5 p-2.5">
      <section className="rounded-md border border-line-soft bg-ink-850/60 p-2">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <ArcGauge value={metric?.cpu ?? 0} label="cpu" icon="cpu" size={54} />
            <ArcGauge value={metric?.memory ?? 0} label="memory" icon="memory" size={54} />
            <ArcGauge value={metric?.disk ?? 0} label="disk" icon="disk" size={54} />
          </div>
          <div className="flex flex-col items-end gap-1">
            <Chip tone="mint">{metric?.source ?? "agent"}</Chip>
            <span className="font-mono text-[8.5px] text-slate-600">
              {metric ? `updated ${timeAgo(metric.updatedAt)}` : "no telemetry"}
            </span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {(["cpu", "memory", "disk"] as const).map((key) => (
            <div key={key} className="rounded border border-line-soft/70 bg-ink-900/60 px-1.5 py-1">
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-slate-600">{key}</span>
              <Sparkline values={series?.[key] ?? []} height={22} color={metricTone(metric?.[key] ?? 0).stroke} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <Row label="type" value={NODE_LABEL[node.type]} />
        <Row label="node id" value={node.id} />
        <Row label="owner" value={node.owner ?? "—"} />
        <Row label="region" value={node.region ?? "—"} />
        <Row label="subtree" value={`${descendantCount} descendants`} />
        <Row label="services" value={String(rollup.services)} />
        <Row label="endpoints" value={String(rollup.endpoints)} />
        <Row
          label="subtree health"
          value={`${rollup.counts.healthy}ok · ${rollup.counts.degraded}deg · ${rollup.counts.critical}crit · ${rollup.counts.offline}off`}
          tone={rollup.counts.critical > 0 ? "text-rose-300" : rollup.counts.degraded > 0 ? "text-amber-300" : "text-emerald-300"}
        />
        {metric ? (
          <>
            <Row label="throughput" value={`${formatNumber(metric.requestsPerSec)} rps`} />
            <Row label="latency p99" value={`${metric.latencyMs.toFixed(0)} ms`} />
            <Row
              label="error rate"
              value={`${metric.errorRate.toFixed(2)} %`}
              tone={metric.errorRate > 1.5 ? "text-rose-300" : metric.errorRate > 0.4 ? "text-amber-300" : "text-emerald-300"}
            />
            <Row label="uptime" value={`${metric.uptimePct.toFixed(3)} %`} />
            {metric.replicasDesired > 0 ? (
              <Row
                label="replicas"
                value={`${metric.replicasReady}/${metric.replicasDesired} ready`}
                tone={metric.replicasReady < metric.replicasDesired ? "text-amber-300" : undefined}
              />
            ) : null}
          </>
        ) : null}
        {metaEntries.map(([key, value]) => (
          <Row key={key} label={key} value={typeof value === "object" ? JSON.stringify(value) : String(value)} />
        ))}
      </section>
    </div>
  );
}

function MetricsTab({ node }: { node: TopologyNode }) {
  const metric = useOps((s) => s.metrics[node.id]);
  const series = useOps((s) => s.series[node.id]);
  const gauges = GAUGE_STRIP_TYPES.has(node.type);

  if (!metric) {
    return (
      <p className="p-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-slate-600">
        this node exposes no direct telemetry — it is aggregated from its children
      </p>
    );
  }

  const bars: { key: string; label: string; value: number; unit: string; max: number }[] = [
    { key: "cpu", label: "cpu utilisation", value: metric.cpu, unit: "%", max: 100 },
    { key: "memory", label: "memory utilisation", value: metric.memory, unit: "%", max: 100 },
    { key: "disk", label: "disk utilisation", value: metric.disk, unit: "%", max: 100 },
  ];

  return (
    <div className="flex flex-col gap-2 p-2.5">
      {gauges ? (
        <div className="flex items-center justify-around rounded-md border border-line-soft bg-ink-850/60 py-2">
          <ArcGauge value={metric.cpu} label="cpu" icon="cpu" size={62} />
          <ArcGauge value={metric.memory} label="memory" icon="memory" size={62} />
          <ArcGauge value={metric.disk} label="disk" icon="disk" size={62} />
        </div>
      ) : null}

      {bars.map((bar) => {
        const tone = metricTone(bar.value);
        return (
          <div key={bar.key} className="rounded-md border border-line-soft bg-ink-850/40 px-2 py-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">{bar.label}</span>
              <span className={cn("tabular font-mono text-[12px]", tone.text)}>
                {bar.value.toFixed(1)}
                <span className="text-[9px] text-slate-600">{bar.unit}</span>
              </span>
            </div>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-ink-750">
              <div
                className={cn("h-full rounded-full", tone.bar)}
                style={{ width: `${Math.min(100, (bar.value / bar.max) * 100)}%`, transition: "width 700ms cubic-bezier(0.4,0,0.2,1)" }}
              />
            </div>
            <div className="mt-1">
              <Sparkline values={series?.[bar.key as "cpu"] ?? []} height={26} color={tone.stroke} />
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-1.5">
        <MetricTile label="net in" value={formatCompact(metric.networkIn)} unit="MB/s" icon="arrowRight" />
        <MetricTile label="net out" value={formatCompact(metric.networkOut)} unit="MB/s" icon="arrowRight" />
        <MetricTile label="requests" value={formatCompact(metric.requestsPerSec)} unit="rps" icon="activity" />
        <MetricTile label="p99" value={metric.latencyMs.toFixed(0)} unit="ms" icon="clock" />
        <MetricTile label="errors" value={metric.errorRate.toFixed(2)} unit="%" icon="alert" tone={metric.errorRate > 1 ? "text-rose-300" : undefined} />
        <MetricTile label="uptime" value={metric.uptimePct.toFixed(2)} unit="%" icon="shield" />
      </div>

      <div className="rounded-md border border-line-soft bg-ink-950/50 p-2 font-mono text-[9px] leading-relaxed text-slate-500">
        <p className="text-slate-400">collector · {metric.source}</p>
        <p>scrape_interval 2s · last scrape {clockTime(metric.updatedAt)}</p>
        <p>
          query: {metric.source === "kubernetes" ? "kube_pod_container_resource_usage" : metric.source === "docker" ? "container_cpu_usage_seconds_total" : "node_cpu_seconds_total"}
          {"{"}id=&quot;{node.id}&quot;{"}"}
        </p>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  unit,
  icon,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  icon: Parameters<typeof Icon>[0]["name"];
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-line-soft bg-ink-850/40 px-2 py-1.5">
      <Icon name={icon} size={12} className="text-slate-600" />
      <div className="min-w-0">
        <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-slate-600">{label}</p>
        <p className={cn("tabular truncate font-mono text-[11.5px] text-slate-200", tone)}>
          {value}
          <span className="ml-0.5 text-[8.5px] text-slate-600">{unit}</span>
        </p>
      </div>
    </div>
  );
}

function ChildrenTab({ node }: { node: TopologyNode }) {
  const childrenOf = useOps((s) => s.childrenOf);
  const metrics = useOps((s) => s.metrics);
  const requestFocus = useOps((s) => s.requestFocus);
  const kids = childrenOf[node.id] ?? [];

  if (kids.length === 0) {
    return (
      <p className="p-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-slate-600">
        leaf node — no children in this sub-flow
      </p>
    );
  }

  return (
    <div className="flex flex-col p-1.5">
      {kids.map((kid) => (
        <ChildRow key={kid} id={kid} metric={metrics[kid]} onFocus={requestFocus} />
      ))}
    </div>
  );
}

const ChildRow = memo(function ChildRow({
  id,
  metric,
  onFocus,
}: {
  id: string;
  metric?: { cpu: number; memory: number; disk: number; requestsPerSec: number; latencyMs: number };
  onFocus: (id: string) => void;
}) {
  const child = useOps((s) => s.nodesById[id]);
  const descendantCount = useOps((s) => s.descendantCount[id] ?? 0);
  if (!child) return null;
  return (
    <button
      type="button"
      onClick={() => onFocus(id)}
      className="flex items-center gap-1.5 rounded border border-transparent px-1.5 py-1 text-left transition hover:border-line hover:bg-ink-850"
    >
      <StatusDot status={child.status} size={6} />
      <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-slate-600">{NODE_TYPE_ABBREV[child.type]}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{child.name}</span>
      {descendantCount > 0 ? <span className="font-mono text-[8.5px] text-slate-600">+{descendantCount}</span> : null}
      {metric ? (
        <span className="tabular w-24 shrink-0 text-right font-mono text-[8.5px] text-slate-500">
          {metric.cpu.toFixed(0)}% · {formatCompact(metric.requestsPerSec)}rps
        </span>
      ) : null}
    </button>
  );
});

function ConsoleTab({ node }: { node: TopologyNode }) {
  const runbooks = useOps((s) => s.runbooks);
  const runs = useOps((s) => s.runs);
  const executeRunbook = useOps((s) => s.executeRunbook);
  const nodeRuns = useMemo(() => runs.filter((run) => run.nodeId === node.id), [runs, node.id]);

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <section>
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">runbooks · cli executor</p>
        <div className="grid grid-cols-2 gap-1.5">
          {runbooks.map((runbook) => (
            <button
              key={runbook.id}
              type="button"
              onClick={() => void executeRunbook(node.id, runbook.id)}
              title={runbook.description}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded border px-1.5 py-1 text-left transition",
                runbook.risky
                  ? "border-amber-500/30 bg-amber-500/[0.06] hover:border-amber-400/60"
                  : "border-line bg-ink-850/70 hover:border-ice/50",
              )}
            >
              <span className="flex w-full items-center gap-1">
                <Icon name="terminal" size={10} className={runbook.risky ? "text-amber-300" : "text-ice"} />
                <span className="truncate text-[10px] text-slate-200">{runbook.label}</span>
              </span>
              <span className="truncate font-mono text-[7.5px] uppercase tracking-[0.08em] text-slate-600">
                {runbook.risky ? "privileged" : "read-only"}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="min-h-0 flex-1">
        <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
          execution log {nodeRuns.length > 0 ? `· ${nodeRuns.length}` : ""}
        </p>
        {nodeRuns.length === 0 ? (
          <div className="rounded border border-dashed border-line px-2 py-4 text-center font-mono text-[9.5px] text-slate-600">
            no runs against this node yet
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {nodeRuns.map((run) => (
              <div key={run.id} className="rounded border border-line bg-ink-950/70">
                <div className="flex items-center gap-1.5 border-b border-line-soft px-2 py-1">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      run.status === "success" ? "bg-emerald-400" : run.status === "failed" ? "bg-rose-500" : "bg-amber-400 blink",
                    )}
                  />
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-slate-500">{run.status}</span>
                  <span className="ml-auto font-mono text-[8.5px] text-slate-600">{clockTime(run.startedAt)}</span>
                </div>
                <pre className="max-h-40 overflow-auto scroll-thin whitespace-pre-wrap px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-emerald-200/80">
                  {run.output || "…"}
                </pre>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
