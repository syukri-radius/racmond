"use client";

import { memo } from "react";
import type { NodeStatus } from "@/lib/types";
import { metricTone, STATUS_TONE } from "@/lib/graph";
import { Icon, type IconName } from "@/components/ops/icons";

export const StatusDot = memo(function StatusDot({
  status,
  size = 8,
  pulse = true,
}: {
  status: NodeStatus;
  size?: number;
  pulse?: boolean;
}) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${tone.dot} ${status === "critical" && pulse ? "blink" : ""}`}
      style={{ width: size, height: size, boxShadow: `0 0 ${size + 4}px -1px currentColor` }}
      title={tone.label}
    />
  );
});

export const ArcGauge = memo(function ArcGauge({
  value,
  label,
  icon,
  size = 46,
  suffix = "%",
}: {
  value: number;
  label: string;
  icon?: IconName;
  size?: number;
  suffix?: string;
}) {
  const stroke = 4;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const sweep = 0.74;
  const arc = circumference * sweep;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const filled = (arc * clamped) / 100;
  const tone = metricTone(clamped);

  return (
    <div className="flex flex-col items-center gap-0.5" style={{ width: size + 8 }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-[133deg]">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#16222f"
            strokeWidth={stroke}
            strokeDasharray={`${arc} ${circumference}`}
            strokeLinecap="round"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone.stroke}
            strokeWidth={stroke}
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 700ms cubic-bezier(0.4,0,0.2,1), stroke 400ms linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`tabular font-mono text-[11px] font-semibold leading-none ${tone.text}`}>
            {clamped.toFixed(0)}
            <span className="text-[8px] opacity-70">{suffix}</span>
          </span>
          {icon ? <Icon name={icon} size={9} className="mt-0.5 text-slate-500" /> : null}
        </div>
      </div>
      <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
    </div>
  );
});

export const Sparkline = memo(function Sparkline({
  values,
  width = 120,
  height = 30,
  max = 100,
  color,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  max?: number;
  color?: string;
  fill?: boolean;
}) {
  const data = values.length > 1 ? values : [...values, ...values];
  if (data.length < 2) {
    return <div className="h-[30px] w-full rounded bg-ink-850/60" style={{ height }} />;
  }
  const stroke = color ?? metricTone(data[data.length - 1] ?? 0).stroke;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const y = height - (Math.max(0, Math.min(max, v)) / max) * (height - 3) - 1.5;
    return `${(i * step).toFixed(2)},${y.toFixed(2)}`;
  });
  const id = `spark-${stroke.replace("#", "")}-${height}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill ? <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={`url(#${id})`} /> : null}
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

export const MiniBar = memo(function MiniBar({
  label,
  value,
  width = 44,
}: {
  label: string;
  value: number;
  width?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone = metricTone(clamped);
  return (
    <div className="flex items-center gap-1" style={{ width }}>
      <span className="font-mono text-[8px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-ink-750">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
          style={{ width: `${clamped}%`, transition: "width 700ms cubic-bezier(0.4,0,0.2,1)" }}
        />
      </span>
    </div>
  );
});

export function Chip({
  children,
  tone = "slate",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "slate" | "mint" | "amber" | "rose" | "ice" | "violet";
  className?: string;
}) {
  const tones: Record<string, string> = {
    slate: "border-line bg-ink-800/80 text-slate-400",
    mint: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    rose: "border-rose-500/25 bg-rose-500/10 text-rose-300",
    ice: "border-sky-500/25 bg-sky-500/10 text-sky-300",
    violet: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.1em] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  icon,
  right,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: string;
  icon?: IconName;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-lg border border-line bg-ink-900/85 backdrop-blur-sm ${className}`}>
      {title ? (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line-soft px-2.5">
          <div className="flex items-center gap-1.5 text-slate-400">
            {icon ? <Icon name={icon} size={12} /> : null}
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em]">{title}</h2>
          </div>
          {right}
        </header>
      ) : null}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  unit,
  tone = "text-slate-100",
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-[74px] flex-col justify-center rounded-md border border-line-soft bg-ink-850/70 px-2 py-1">
      <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className={`tabular font-mono text-[15px] font-semibold leading-tight ${tone}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[9px] font-normal text-slate-500">{unit}</span> : null}
      </span>
      {hint ? <span className="truncate font-mono text-[8.5px] text-slate-600">{hint}</span> : null}
    </div>
  );
}
