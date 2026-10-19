"use client";

import { memo, useMemo } from "react";
import type { EventItem } from "@/lib/types";
import { clockTime, timeAgo } from "@/lib/graph";
import { useOps, type DockTab } from "@/store/ops";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ops/icons";

const TABS: { id: DockTab; label: string }[] = [
  { id: "events", label: "live alert stream" },
  { id: "runs", label: "cli executor log" },
];

export const EventDock = memo(function EventDock() {
  const events = useOps((s) => s.events);
  const runs = useOps((s) => s.runs);
  const tab = useOps((s) => s.dockTab);
  const setTab = useOps((s) => s.setDockTab);
  const dockOpen = useOps((s) => s.dockOpen);
  const toggleDock = useOps((s) => s.toggleDock);
  const ackEvent = useOps((s) => s.ackEvent);
  const ackAllEvents = useOps((s) => s.ackAllEvents);
  const requestFocus = useOps((s) => s.requestFocus);

  const unacknowledged = useMemo(() => events.filter((event) => !event.acknowledged).length, [events]);

  return (
    <section className="z-10 flex shrink-0 flex-col border-t border-line bg-ink-900/90">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line-soft px-2.5">
        <Icon name="activity" size={12} className="text-ice" />
        <div className="flex gap-px">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                "px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.16em] transition",
                tab === entry.id ? "bg-ink-800 text-ice" : "text-slate-600 hover:text-slate-300",
              )}
            >
              {entry.label}
              <span className="ml-1 text-slate-600">{entry.id === "events" ? events.length : runs.length}</span>
            </button>
          ))}
        </div>
        {unacknowledged > 0 && tab === "events" ? (
          <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-[1px] font-mono text-[8.5px] uppercase tracking-[0.12em] text-rose-300">
            {unacknowledged} unacknowledged
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {tab === "events" ? (
            <button
              type="button"
              onClick={ackAllEvents}
              className="flex items-center gap-1 rounded border border-line px-1.5 py-[2px] font-mono text-[8.5px] uppercase tracking-[0.12em] text-slate-500 transition hover:border-emerald-400/40 hover:text-emerald-300"
            >
              <Icon name="check" size={9} />
              ack all
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleDock}
            className="flex h-5 w-5 items-center justify-center rounded border border-line text-slate-500 transition hover:text-ice"
            title={dockOpen ? "Collapse dock" : "Expand dock"}
          >
            <Icon name="chevron" size={10} className={cn("transition-transform", dockOpen ? "-rotate-90" : "rotate-90")} />
          </button>
        </div>
      </header>

      {dockOpen ? (
        <div className="h-[152px] min-h-0 overflow-y-auto scroll-thin">
          {tab === "events" ? (
            <table className="w-full border-collapse">
              <tbody>
                {events.map((event) => (
                  <EventRow key={event.id} event={event} onAck={ackEvent} onFocus={requestFocus} />
                ))}
                {events.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center font-mono text-[10px] text-slate-600">no alerts in the stream</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col gap-1 p-1.5">
              {runs.map((run) => (
                <div key={run.id} className="flex items-start gap-2 rounded border border-line-soft bg-ink-950/60 px-2 py-1">
                  <span
                    className={cn(
                      "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
                      run.status === "success" ? "bg-emerald-400" : run.status === "failed" ? "bg-rose-500" : "bg-amber-400 blink",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[9.5px] text-slate-300">{run.command}</span>
                      <span className="ml-auto shrink-0 font-mono text-[8.5px] text-slate-600">
                        {run.operator} · {clockTime(run.startedAt)} · exit {run.exitCode ?? "—"}
                      </span>
                    </div>
                    {run.nodeName ? (
                      <button
                        type="button"
                        onClick={() => run.nodeId && requestFocus(run.nodeId)}
                        className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-ice/70 transition hover:text-ice"
                      >
                        target: {run.nodeName}
                      </button>
                    ) : null}
                    <pre className="mt-0.5 max-h-16 overflow-auto scroll-thin whitespace-pre-wrap font-mono text-[9px] leading-snug text-emerald-200/70">
                      {run.output || "…"}
                    </pre>
                  </div>
                </div>
              ))}
              {runs.length === 0 ? (
                <p className="px-2 py-6 text-center font-mono text-[10px] text-slate-600">
                  no executions yet — select a node and run a runbook from the inspector
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
});

const SEVERITY_STYLE: Record<EventItem["severity"], { chip: string; dot: string }> = {
  critical: { chip: "border-rose-500/40 bg-rose-500/10 text-rose-300", dot: "bg-rose-500" },
  warning: { chip: "border-amber-500/40 bg-amber-500/10 text-amber-300", dot: "bg-amber-400" },
  info: { chip: "border-sky-500/30 bg-sky-500/10 text-sky-300", dot: "bg-sky-400" },
};

const EventRow = memo(function EventRow({
  event,
  onAck,
  onFocus,
}: {
  event: EventItem;
  onAck: (id: number) => void;
  onFocus: (id: string) => void;
}) {
  const style = SEVERITY_STYLE[event.severity];
  return (
    <tr className={cn("border-b border-line-soft/60 transition hover:bg-ink-850", event.acknowledged && "opacity-45")}>
      <td className="w-[86px] shrink-0 px-2 py-1 font-mono text-[9px] text-slate-600" title={event.ts}>
        {clockTime(event.ts)}
        <span className="ml-1 text-slate-700">{timeAgo(event.ts)}</span>
      </td>
      <td className="w-[74px] px-1 py-1">
        <span className={cn("inline-flex items-center gap-1 rounded border px-1 py-[1px] font-mono text-[8.5px] uppercase tracking-[0.1em]", style.chip)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
          {event.severity}
        </span>
      </td>
      <td className="w-[86px] px-1 py-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-500">{event.source}</td>
      <td className="px-1 py-1">
        <span className="text-[11px] text-slate-200">{event.title}</span>
        {event.detail ? <span className="ml-2 font-mono text-[9px] text-slate-600">{event.detail}</span> : null}
      </td>
      <td className="w-[190px] px-2 py-1 text-right">
        {event.nodeId ? (
          <button
            type="button"
            onClick={() => onFocus(event.nodeId!)}
            className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-ice/70 transition hover:text-ice"
            title={event.nodeName ?? event.nodeId}
          >
            {event.nodeName ?? event.nodeId}
          </button>
        ) : null}
      </td>
      <td className="w-[52px] px-2 py-1 text-right">
        {event.acknowledged ? (
          <span className="font-mono text-[8.5px] uppercase text-slate-700">acked</span>
        ) : (
          <button
            type="button"
            onClick={() => onAck(event.id)}
            className="rounded border border-line px-1.5 py-[1px] font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-500 transition hover:border-emerald-400/40 hover:text-emerald-300"
          >
            ack
          </button>
        )}
      </td>
    </tr>
  );
});
