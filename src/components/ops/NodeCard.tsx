"use client";

import { memo } from "react";
import type { MetricSnapshot, NodeStatus, NodeType, TopologyNode } from "@/lib/types";
import { GAUGE_STRIP_TYPES, NODE_LABEL } from "@/lib/types";
import { formatCompact, metricTone, NODE_TYPE_ABBREV, STATUS_TONE } from "@/lib/graph";
import type { LayoutBox } from "@/lib/elk-layout";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ops/icons";
import { ArcGauge, MiniBar, Sparkline, StatusDot } from "@/components/ops/primitives";

interface TypeMeta {
  icon: IconName;
  accent: string;
  badge: string;
  tint: string;
}

const TYPE_META: Record<NodeType, TypeMeta> = {
  organization: { icon: "org", accent: "#a78bfa", badge: "text-violet-300", tint: "rgba(167,139,250,0.07)" },
  sub_org: { icon: "division", accent: "#8b9cf7", badge: "text-indigo-300", tint: "rgba(139,156,247,0.06)" },
  project: { icon: "project", accent: "#7dd3fc", badge: "text-sky-300", tint: "rgba(125,211,252,0.06)" },
  sub_project: { icon: "tree", accent: "#67c8f0", badge: "text-sky-300", tint: "rgba(103,200,240,0.05)" },
  datacenter: { icon: "datacenter", accent: "#5eead4", badge: "text-teal-300", tint: "rgba(94,234,212,0.05)" },
  namespace: { icon: "namespace", accent: "#c4b5fd", badge: "text-violet-300", tint: "rgba(196,181,253,0.05)" },
  server: { icon: "server", accent: "#93c5fd", badge: "text-blue-300", tint: "rgba(147,197,253,0.05)" },
  container: { icon: "container", accent: "#7dd3fc", badge: "text-cyan-300", tint: "rgba(125,211,252,0.05)" },
  pod: { icon: "pod", accent: "#a5b4fc", badge: "text-indigo-300", tint: "rgba(165,180,252,0.05)" },
  service_group: { icon: "group", accent: "#6ee7b7", badge: "text-emerald-300", tint: "rgba(110,231,183,0.05)" },
  service_sub_group: { icon: "group", accent: "#5fd6a8", badge: "text-emerald-300", tint: "rgba(95,214,168,0.045)" },
  service: { icon: "service", accent: "#34d399", badge: "text-emerald-300", tint: "rgba(52,211,153,0.07)" },
  endpoint: { icon: "endpoint", accent: "#fbbf24", badge: "text-amber-300", tint: "rgba(251,191,36,0.07)" },
  resource: { icon: "cpu", accent: "#38bdf8", badge: "text-sky-300", tint: "rgba(56,189,248,0.08)" },
};

function borderFor(status: NodeStatus, selected: boolean, matched: boolean) {
  if (selected) return "border-ice/70 shadow-[0_0_0_1px_rgba(125,211,252,0.35),0_18px_40px_-24px_rgba(56,189,248,0.8)]";
  if (matched) return "border-violet-400/60";
  switch (status) {
    case "critical":
      return "border-rose-500/60 shadow-[0_0_22px_-10px_rgba(244,63,94,0.9)]";
    case "degraded":
      return "border-amber-400/45";
    case "offline":
      return "border-slate-600/50";
    case "maintenance":
      return "border-sky-400/45";
    default:
      return "border-line";
  }
}

const METHOD_TONE: Record<string, string> = {
  GET: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  POST: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  RPC: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  SUB: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  CMD: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  PUT: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  DELETE: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export interface NodeCardProps {
  node: TopologyNode;
  metric?: MetricSnapshot;
  series?: { cpu: number[]; memory: number[]; disk: number[] };
  box: LayoutBox;
  collapsed: boolean;
  childCount: number;
  descendantCount: number;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  dragging: boolean;
}

export const NodeCard = memo(function NodeCard({
  node,
  metric,
  series,
  box,
  collapsed,
  childCount,
  descendantCount,
  selected,
  matched,
  dimmed,
  dragging,
}: NodeCardProps) {
  const meta = TYPE_META[node.type];
  const tone = STATUS_TONE[node.status];
  const isGroup = box.isGroup;
  const hasGaugeStrip = GAUGE_STRIP_TYPES.has(node.type);
  const cpu = metric?.cpu ?? 0;
  const mem = metric?.memory ?? 0;
  const disk = metric?.disk ?? 0;

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden rounded-lg border backdrop-blur-[1px] transition-[border-color,box-shadow,opacity] duration-200",
        borderFor(node.status, selected, matched),
        dimmed && "opacity-25 saturate-50",
        dragging && "cursor-grabbing",
        node.status === "critical" && !dimmed && "pulse-critical",
      )}
      style={{
        background: isGroup
          ? `linear-gradient(180deg, ${meta.tint} 0%, rgba(7,11,19,0.55) ${Math.min(60, box.header + 8)}%, rgba(7,11,19,0.28) 100%)`
          : `linear-gradient(160deg, ${meta.tint} 0%, rgba(8,12,20,0.92) 100%)`,
      }}
      title={`${NODE_LABEL[node.type]} · ${node.name}`}
    >
      <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: meta.accent, opacity: 0.75 }} />

      {node.type === "resource" ? (
        <ResourceBody node={node} metric={metric} series={series} />
      ) : (
        <header
          className="relative flex flex-col justify-between overflow-hidden px-2 pt-1.5"
          style={{ height: isGroup ? box.header : undefined }}
        >
          <div className="flex items-start gap-1.5">
            <span className="mt-[1px] shrink-0" style={{ color: meta.accent }}>
              <Icon name={meta.icon} size={node.type === "organization" ? 15 : 13} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={cn("truncate font-mono text-[8.5px] uppercase tracking-[0.16em]", meta.badge)}>
                  {NODE_TYPE_ABBREV[node.type]}
                </span>
                <StatusDot status={node.status} size={6} />
                {childCount > 0 ? (
                  <span className="ml-auto shrink-0 font-mono text-[8.5px] text-slate-500">
                    {collapsed ? `+${descendantCount}` : `${childCount}`}
                  </span>
                ) : null}
              </div>
              <div className="truncate text-[11.5px] font-medium leading-tight text-slate-100">{node.name}</div>
            </div>
          </div>

          {hasGaugeStrip ? (
            <div className="flex items-end justify-between gap-1 pb-1">
              <ArcGauge value={cpu} label="cpu" icon="cpu" size={38} />
              <ArcGauge value={mem} label="mem" icon="memory" size={38} />
              <ArcGauge value={disk} label="disk" icon="disk" size={38} />
              <div className="mb-1 flex flex-col items-end gap-[2px] pr-0.5">
                <span className="font-mono text-[8px] uppercase tracking-wider text-slate-500">{node.kind}</span>
                <span className={cn("tabular font-mono text-[9.5px]", tone.text)}>{STATUS_TONE[node.status].label}</span>
                {metric ? (
                  <span className="tabular font-mono text-[8px] text-slate-500">
                    {formatCompact(metric.requestsPerSec)} rps
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {!hasGaugeStrip && metric && isGroup ? (
            <div className="flex items-center gap-2 pb-1.5 pl-[1px]">
              <MiniBar label="c" value={cpu} width={40} />
              <MiniBar label="m" value={mem} width={40} />
              <MiniBar label="d" value={disk} width={40} />
              <span className="ml-auto font-mono text-[8px] text-slate-600">{formatCompact(metric.requestsPerSec)} rps</span>
            </div>
          ) : null}

          {!hasGaugeStrip && metric && !isGroup && node.type === "service" ? (
            <ServiceBody node={node} metric={metric} series={series} />
          ) : null}

          {!hasGaugeStrip && metric && !isGroup && node.type === "endpoint" ? <EndpointBody node={node} metric={metric} /> : null}

          {collapsed && childCount > 0 ? (
            <div className="flex items-center gap-1 pb-1.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">
              <Icon name="chevron" size={9} />
              <span>collapsed · {descendantCount} nodes hidden</span>
            </div>
          ) : null}
        </header>
      )}
    </div>
  );
});

function ServiceBody({
  node,
  metric,
  series,
}: {
  node: TopologyNode;
  metric: MetricSnapshot;
  series?: { cpu: number[]; memory: number[]; disk: number[] };
}) {
  const protocol = String(node.meta.protocol ?? "HTTP/2");
  return (
    <div className="flex items-end gap-2 pb-1.5">
      <div className="flex flex-col gap-[3px]">
        <MiniBar label="cpu" value={metric.cpu} width={62} />
        <MiniBar label="mem" value={metric.memory} width={62} />
      </div>
      <div className="flex flex-col items-end gap-[1px]">
        <span className="tabular font-mono text-[9.5px] text-slate-300">{formatCompact(metric.requestsPerSec)} rps</span>
        <span className="tabular font-mono text-[9px] text-slate-500">{metric.latencyMs.toFixed(0)} ms p99</span>
        <span
          className={cn(
            "tabular font-mono text-[9px]",
            metric.errorRate > 1.5 ? "text-rose-300" : metric.errorRate > 0.4 ? "text-amber-300" : "text-emerald-300",
          )}
        >
          {metric.errorRate.toFixed(2)}% err
        </span>
      </div>
      <div className="ml-auto w-[62px] shrink-0">
        <Sparkline values={series?.cpu ?? []} height={26} color={metricTone(metric.cpu).stroke} />
        <span className="mt-[1px] block text-right font-mono text-[7.5px] uppercase tracking-wider text-slate-600">
          {protocol}
        </span>
      </div>
    </div>
  );
}

function EndpointBody({ node, metric }: { node: TopologyNode; metric: MetricSnapshot }) {
  const method = String(node.meta.method ?? "GET");
  const sla = Number(node.meta.slaMs ?? 0);
  const withinSla = metric.latencyMs <= sla * 1.5;
  return (
    <div className="flex items-center gap-1.5 pb-1.5">
      <span
        className={cn(
          "shrink-0 rounded border px-1 py-[1px] font-mono text-[8.5px] font-semibold",
          METHOD_TONE[method] ?? METHOD_TONE.GET,
        )}
      >
        {method}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <span className="tabular font-mono text-[9.5px] text-slate-300">{metric.latencyMs.toFixed(0)}ms</span>
        <span className={cn("tabular font-mono text-[8.5px]", withinSla ? "text-emerald-400/80" : "text-rose-300")}>
          sla {sla}ms
        </span>
        <span className="tabular font-mono text-[8.5px] text-slate-500">{formatCompact(metric.requestsPerSec)}/s</span>
      </div>
    </div>
  );
}

function ResourceBody({
  node,
  metric,
  series,
}: {
  node: TopologyNode;
  metric?: MetricSnapshot;
  series?: { cpu: number[]; memory: number[]; disk: number[] };
}) {
  const metricKey = String(node.meta.metric ?? "cpu") as "cpu" | "memory" | "disk";
  const value = metric?.[metricKey] ?? 0;
  const icon: IconName = metricKey === "cpu" ? "cpu" : metricKey === "memory" ? "memory" : "disk";
  const history = series?.[metricKey] ?? [];
  const delta = history.length > 1 ? value - history[Math.max(0, history.length - 6)] : 0;
  const tone = metricTone(value);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-1">
      <ArcGauge value={value} label={metricKey} icon={icon} size={48} />
      <div className="flex items-center gap-1">
        <span className={cn("tabular font-mono text-[9px]", tone.text)}>{value.toFixed(1)}%</span>
        <span className={cn("tabular font-mono text-[8px]", delta >= 0 ? "text-rose-400/70" : "text-emerald-400/70")}>
          {delta >= 0 ? "▲" : "▼"}
          {Math.abs(delta).toFixed(1)}
        </span>
      </div>
      <div className="w-full px-1">
        <Sparkline values={history} height={12} color={tone.stroke} fill={false} />
      </div>
    </div>
  );
}
