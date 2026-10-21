"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useOps } from "@/store/ops";
import { tally, timeAgo } from "@/lib/graph";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ops/icons";
import { StatTile } from "@/components/ops/primitives";

const DEPTH_LEVELS = [
  { depth: 1, label: "ORG" },
  { depth: 3, label: "PROJ" },
  { depth: 5, label: "DC" },
  { depth: 6, label: "INFRA" },
  { depth: 8, label: "GROUP" },
  { depth: 10, label: "SVC" },
  { depth: 12, label: "ALL" },
];

export const TopBar = memo(function TopBar() {
  const list = useOps((s) => s.list);
  const metrics = useOps((s) => s.metrics);
  const phase = useOps((s) => s.phase);
  const live = useOps((s) => s.live);
  const streamState = useOps((s) => s.streamState);
  const lastTickAt = useOps((s) => s.lastTickAt);
  const ticks = useOps((s) => s.ticks);
  const query = useOps((s) => s.query);
  const setQuery = useOps((s) => s.setQuery);
  const setLive = useOps((s) => s.setLive);
  const expandToDepth = useOps((s) => s.expandToDepth);
  const expandDepth = useOps((s) => s.expandDepth);
  const showResourceNodes = useOps((s) => s.showResourceNodes);
  const setShowResourceNodes = useOps((s) => s.setShowResourceNodes);
  const direction = useOps((s) => s.direction);
  const setDirection = useOps((s) => s.setDirection);
  const spacing = useOps((s) => s.spacing);
  const layerSpacing = useOps((s) => s.layerSpacing);
  const setSpacing = useOps((s) => s.setSpacing);
  const resetLayout = useOps((s) => s.resetLayout);
  const reseed = useOps((s) => s.reseed);
  const generatedAt = useOps((s) => s.generatedAt);

  const stats = useMemo(() => tally(list, metrics), [list, metrics]);
  const [clock, setClock] = useState(0);

  // keeps the relative timestamps ("3s ago") honest without touching metrics
  useEffect(() => {
    const id = setInterval(() => setClock((value) => value + 1), 15000);
    return () => clearInterval(id);
  }, []);
  void clock;

  return (
    <header className="z-20 shrink-0 border-b border-line bg-ink-900/85 backdrop-blur">
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-md border border-ice/30 bg-ink-850">
            <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" stroke="#7dd3fc" strokeWidth="1.5">
              <path d="M16 3l11 6v14l-11 6-11-6V9l11-6z" strokeLinejoin="round" />
              <path d="M16 11l5.5 3v6L16 23l-5.5-3v-6L16 11z" strokeLinejoin="round" stroke="#34d399" />
              <path d="M16 3v8M27 9l-5.5 5M5 9l5.5 5M16 23v6M27 23l-5.5 0M5 23h5.5" stroke="#a78bfa" strokeOpacity="0.6" />
            </svg>
          </span>
          <div className="leading-tight">
            <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.22em] text-slate-100">
              Helios<span className="text-ice">·</span>Ops
            </h1>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">
              hierarchical control &amp; monitoring
            </p>
          </div>
        </div>

        <div className="mx-1 h-9 w-px bg-line" />

        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto scroll-thin">
          <StatTile label="nodes" value={String(stats.total)} hint={`${stats.groups} containers`} />
          <StatTile
            label="critical"
            value={String(stats.critical)}
            tone={stats.critical > 0 ? "text-rose-300" : "text-slate-300"}
            hint={`${stats.offline} offline`}
          />
          <StatTile
            label="degraded"
            value={String(stats.degraded)}
            tone={stats.degraded > 0 ? "text-amber-300" : "text-slate-300"}
            hint={`${stats.maintenance} maint.`}
          />
          <StatTile label="healthy" value={String(stats.healthy)} tone="text-emerald-300" hint={`${stats.endpoints} endpoints`} />
          <StatTile label="avg cpu" value={stats.cpu.toFixed(1)} unit="%" tone="text-sky-200" />
          <StatTile label="avg mem" value={stats.memory.toFixed(1)} unit="%" />
          <StatTile label="throughput" value={stats.rps >= 1000 ? (stats.rps / 1000).toFixed(1) : stats.rps.toFixed(0)} unit={stats.rps >= 1000 ? "k rps" : "rps"} />
          <StatTile label="p99" value={stats.latency.toFixed(0)} unit="ms" />
          <StatTile
            label="err rate"
            value={stats.errorRate.toFixed(2)}
            unit="%"
            tone={stats.errorRate > 1.5 ? "text-rose-300" : "text-emerald-300"}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="relative flex items-center">
            <Icon name="search" size={12} className="pointer-events-none absolute left-2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search nodes, regions, owners…"
              className="h-8 w-56 rounded-md border border-line bg-ink-850 pl-7 pr-2 font-mono text-[10.5px] text-slate-200 placeholder:text-slate-600 focus:border-ice/50 focus:outline-none"
            />
          </label>

          <button
            type="button"
            onClick={() => setLive(!live)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-md border px-2 font-mono text-[9.5px] uppercase tracking-[0.14em] transition",
              live
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-line bg-ink-850 text-slate-400 hover:text-slate-200",
            )}
            title="Toggle the live monitoring stream"
          >
            <Icon name={live ? "pause" : "play"} size={11} />
            {live ? "live" : "paused"}
            <span
              className={cn(
                "ml-0.5 h-1.5 w-1.5 rounded-full",
                streamState === "open" ? "bg-emerald-400 blink" : streamState === "connecting" ? "bg-amber-400" : "bg-slate-600",
              )}
            />
          </button>

          <button
            type="button"
            onClick={() => void reseed()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-ink-850 px-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400 transition hover:border-ice/40 hover:text-ice"
            title="Rebuild the reference dataset"
          >
            <Icon name="refresh" size={11} />
            reseed
          </button>

          <a
            href="/guide"
            className="flex h-8 items-center gap-1.5 rounded-md border border-ice/30 bg-ice/[0.07] px-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ice transition hover:bg-ice/[0.14]"
            title="Open the user guide: architecture, administration, integration patterns and samples"
          >
            <Icon name="shield" size={11} />
            guide
          </a>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line-soft px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Icon name="tree" size={11} className="text-slate-500" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">expand to</span>
          <div className="flex overflow-hidden rounded border border-line">
            {DEPTH_LEVELS.map((level) => (
              <button
                key={level.label}
                type="button"
                onClick={() => expandToDepth(level.depth)}
                className={cn(
                  "px-1.5 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.1em] transition",
                  expandDepth === level.depth ? "bg-ice/15 text-ice" : "text-slate-500 hover:bg-ink-800 hover:text-slate-300",
                )}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">
          <input
            type="checkbox"
            checked={showResourceNodes}
            onChange={(event) => setShowResourceNodes(event.target.checked)}
            className="h-3 w-3 accent-sky-400"
          />
          resource gauge nodes
        </label>

        <div className="flex items-center gap-1.5">
          <Icon name="sliders" size={11} className="text-slate-500" />
          <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">elk.direction</span>
          <div className="flex overflow-hidden rounded border border-line">
            {(["DOWN", "RIGHT"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDirection(value)}
                className={cn(
                  "px-1.5 py-[3px] font-mono text-[8.5px] tracking-[0.1em] transition",
                  direction === value ? "bg-violet-400/15 text-violet-200" : "text-slate-500 hover:bg-ink-800 hover:text-slate-300",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">
          spacing
          <input
            type="range"
            min={10}
            max={64}
            value={spacing}
            onChange={(event) => setSpacing(Number(event.target.value), Math.round(Number(event.target.value) * 1.4))}
            className="h-1 w-24 accent-emerald-400"
          />
          <span className="tabular w-14 text-slate-400">
            {spacing}/{layerSpacing}
          </span>
        </label>

        <button
          type="button"
          onClick={resetLayout}
          className="flex items-center gap-1 rounded border border-line px-1.5 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500 transition hover:border-ice/40 hover:text-ice"
          title="Discard manual drag offsets and re-run the ELK layout"
        >
          <Icon name="fit" size={10} />
          auto-layout
        </button>

        <div className="ml-auto flex items-center gap-3 font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-600">
          <span>
            stream {streamState} · tick {ticks}
            {lastTickAt ? ` · ${timeAgo(lastTickAt)}` : ""}
          </span>
          <span className={cn("flex items-center gap-1", phase === "ready" ? "text-emerald-400/80" : "text-amber-300/80")}>
            <Icon name="radio" size={10} />
            {phase}
          </span>
          <span>seed {generatedAt ? timeAgo(generatedAt) : "—"}</span>
        </div>
      </div>
    </header>
  );
});
