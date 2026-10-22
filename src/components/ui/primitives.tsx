"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";

/* ------------------------------------------------------------------ inputs */

export type Tone = "ok" | "warn" | "bad" | "info" | "muted" | "accent";

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  info: "text-sky-300",
  muted: "text-slate-400",
  accent: "text-ice",
};

export const TONE_BG: Record<Tone, string> = {
  ok: "bg-emerald-500/12 border-emerald-500/35 text-emerald-300",
  warn: "bg-amber-500/12 border-amber-500/35 text-amber-300",
  bad: "bg-rose-500/12 border-rose-500/40 text-rose-300",
  info: "bg-sky-500/12 border-sky-500/35 text-sky-300",
  muted: "bg-slate-500/10 border-line text-slate-400",
  accent: "bg-ice/12 border-ice/40 text-ice",
};

/* ------------------------------------------------------------------ panels */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "",
  padded = true,
  icon,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
  icon?: IconName;
}) {
  return (
    <section className={cn("glass-panel flex min-h-0 flex-col rounded-xl border", className)}>
      {(title || actions) && (
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? <Icon name={icon} size={14} className="shrink-0 text-slate-400" /> : null}
            <div className="min-w-0">
              <h2 className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300">{title}</h2>
              {subtitle ? <p className="truncate text-[11px] text-slate-500">{subtitle}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", padded && "p-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="font-mono text-[9.5px] uppercase tracking-[0.34em] text-slate-500">{eyebrow}</p>
        <h1 className="mt-1 text-[20px] font-semibold leading-tight tracking-tight text-slate-100">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ atoms */

export function Chip({
  children,
  tone = "muted",
  className = "",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-[1px] font-mono text-[9.5px] uppercase leading-[1.5] tracking-[0.08em]",
        TONE_BG[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "muted", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  const color = tone === "ok" ? "var(--metric-ok)" : tone === "warn" ? "var(--metric-warn)" : tone === "bad" ? "var(--metric-danger)" : tone === "info" ? "var(--sky-400)" : tone === "accent" ? "var(--accent)" : "var(--fg-500)";
  return <span className={cn("inline-block h-[6px] w-[6px] shrink-0 rounded-full", pulse && "blink")} style={{ backgroundColor: color }} />;
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "sm",
  icon,
  disabled,
  type = "button",
  className = "",
  title,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "subtle";
  size?: "xs" | "sm";
  icon?: IconName;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const variants = {
    primary: "border-ice/55 bg-ice/15 text-ice hover:bg-ice/25 hover:border-ice/80",
    ghost: "border-line text-slate-300 hover:border-ice/45 hover:text-ice",
    danger: "border-rose-500/40 text-rose-300 hover:bg-rose-500/12",
    subtle: "border-transparent text-slate-400 hover:text-slate-100 hover:border-line",
  } as const;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md border transition-colors",
        size === "xs" ? "h-6 px-1.5 text-[10px]" : "h-7 px-2.5 text-[11px]",
        "font-mono uppercase tracking-[0.1em]",
        variants[variant],
        disabled && "cursor-not-allowed opacity-40 hover:border-line hover:bg-transparent hover:text-slate-400",
        className,
      )}
    >
      {icon ? <Icon name={icon} size={size === "xs" ? 11 : 12} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  label,
  tone = "muted",
  disabled,
  className = "",
}: {
  icon: IconName;
  onClick?: () => void;
  label: string;
  tone?: Tone;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded border border-line/70 transition-colors hover:border-ice/50 hover:text-ice",
        TONE_TEXT[tone],
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <Icon name={icon} size={12} />
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: { value: T; label: string; count?: number; icon?: IconName }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
              active
                ? "border-ice/55 bg-ice/12 text-ice shadow-[0_0_20px_-12px_var(--accent-strong)]"
                : "border-line/70 text-slate-400 hover:border-ice/35 hover:text-slate-200",
            )}
          >
            {tab.icon ? <Icon name={tab.icon} size={11} /> : null}
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className={cn("tabular rounded px-1 text-[9px]", active ? "bg-ice/25 text-ice" : "bg-slate-500/15 text-slate-400")}>{tab.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "muted",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: IconName;
}) {
  return (
    <div className="glass-inset flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        {icon ? <Icon name={icon} size={11} className="text-slate-500" /> : null}
        <span className="truncate font-mono text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</span>
      </div>
      <span className={cn("tabular truncate text-[17px] font-semibold leading-none", TONE_TEXT[tone])}>{value}</span>
      {hint ? <span className="truncate text-[10.5px] text-slate-500">{hint}</span> : null}
    </div>
  );
}

export function Bar({ value, max = 100, tone = "accent", height = 4 }: { value: number; max?: number; tone?: Tone; height?: number }) {
  const pct = Math.max(0, Math.min(100, max <= 0 ? 0 : (value / max) * 100));
  const color =
    tone === "ok" ? "var(--metric-ok)" : tone === "warn" ? "var(--metric-warn)" : tone === "bad" ? "var(--metric-danger)" : tone === "info" ? "var(--sky-400)" : "var(--accent)";
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height, background: "var(--gauge-track)" }}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

export function Sparkline({
  values,
  width = 120,
  height = 30,
  tone = "accent",
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  fill?: boolean;
}) {
  const points = values.length > 1 ? values : values.length === 1 ? [values[0], values[0]] : [0, 0];
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((value, index) => {
    const x = index * step;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const color =
    tone === "ok" ? "var(--metric-ok)" : tone === "warn" ? "var(--metric-warn)" : tone === "bad" ? "var(--metric-danger)" : tone === "info" ? "var(--sky-400)" : "var(--accent)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      {fill ? (
        <polygon
          points={`0,${height} ${coords.join(" ")} ${width},${height}`}
          style={{ fill: color, opacity: 0.14 }}
        />
      ) : null}
      <polyline points={coords.join(" ")} fill="none" style={{ stroke: color }} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Empty({ icon = "dot", title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon name={icon} size={22} className="text-slate-500" />
      <p className="text-[12px] text-slate-400">{title}</p>
      {hint ? <p className="max-w-sm text-[11px] leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-rose-500/35 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-300">
      <Icon name="alert" size={13} className="mt-[1px] shrink-0" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.12em] underline decoration-dotted">
          retry
        </button>
      ) : null}
    </div>
  );
}

export function Notice({ children, tone = "info", icon = "alert" }: { children: ReactNode; tone?: Tone; icon?: IconName }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11.5px] leading-relaxed", TONE_BG[tone])}>
      <Icon name={icon} size={13} className="mt-[1px] shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ drawer */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close drawer" onClick={onClose} className="absolute inset-0 bg-[rgba(4,2,10,0.55)] backdrop-blur-[2px]" />
      <aside
        className="glass-panel relative flex h-full flex-col border-l"
        style={{ width: `min(${width}px, 94vw)` }}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-slate-100">{title}</h3>
            {subtitle ? <p className="truncate font-mono text-[10px] text-slate-500">{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-line-soft px-4 py-2.5">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[rgba(4,2,10,0.6)] backdrop-blur-[2px]" />
      <div className="glass-panel relative flex max-h-[88vh] w-full flex-col rounded-xl border" style={{ maxWidth: width }}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-line-soft px-4 py-2.5">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-500">
        {label}
        {required ? <span className="text-rose-300"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[10px] leading-snug text-slate-500">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "h-7 w-full rounded-md border border-line bg-ink-900/60 px-2 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none";

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
  mono = true,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  mono?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && onEnter) onEnter();
      }}
      className={cn(inputClass, mono && "font-mono text-[11px]", className)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn("scroll-thin w-full rounded-md border border-line bg-ink-900/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none", className)}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(inputClass, "font-mono text-[11px] [&>option]:bg-ink-900 [&>option]:text-slate-100", className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-line/70 px-2.5 py-1.5 text-left hover:border-ice/40"
    >
      <span className="min-w-0">
        <span className="block truncate text-[11.5px] text-slate-200">{label}</span>
        {hint ? <span className="block truncate text-[10px] text-slate-500">{hint}</span> : null}
      </span>
      <span
        className={cn("relative h-4 w-8 shrink-0 rounded-full border transition-colors", checked ? "border-ice/60 bg-ice/30" : "border-line bg-slate-500/20")}
      >
        <span
          className={cn("absolute top-[1px] h-3 w-3 rounded-full transition-all", checked ? "left-[17px] bg-ice" : "left-[2px] bg-slate-400")}
          style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.45)" }}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ tables */

export function KeyValue({ rows }: { rows: { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(90px,38%)_1fr] gap-x-3 gap-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="truncate font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-500">{row.label}</dt>
          <dd className={cn("min-w-0 break-words text-[11.5px] text-slate-200", row.mono !== false && "font-mono text-[11px]")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap px-2.5 py-1.5 text-left font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-2.5 py-1.5 align-middle text-[11.5px] text-slate-300", className)}>{children}</td>;
}

export function Table({ head, children, className = "" }: { head: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("scroll-thin min-h-0 overflow-auto", className)}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-ink-900/85 backdrop-blur">{head}</thead>
        <tbody className="[&>tr:nth-child(odd)]:bg-white/[0.015] [&>tr:hover]:bg-ice/[0.06]">{children}</tbody>
      </table>
    </div>
  );
}

export function SeverityChip({ severity }: { severity: "error" | "warning" | "info" }) {
  const tone: Tone = severity === "error" ? "bad" : severity === "warning" ? "warn" : "info";
  return <Chip tone={tone}>{severity}</Chip>;
}

export function BarRow({ label, value, max, tone, right }: { label: string; value: number; max: number; tone: Tone; right?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate font-mono text-[10px] text-slate-400">{label}</span>
      <Bar value={value} max={max} tone={tone} height={5} />
      <span className="tabular w-12 shrink-0 text-right font-mono text-[10px] text-slate-400">{right ?? Math.round(value)}</span>
    </div>
  );
}

export function styleVars(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties;
}
