"use client";

import { useEffect, useState } from "react";
import { formatBytes, formatMs, getJson, postJson, timeAgo, usePoll } from "@/lib/client";
import { cn } from "@/lib/cn";
import type { ContainerInfo, ExecResult } from "@/lib/docker/types";
import { Button, Chip, Dot, Drawer, KeyValue, Notice, Tabs, TONE_TEXT, Toggle, type Tone } from "@/components/ui/primitives";
import { Sparkline } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

type Tab = "overview" | "logs" | "stats" | "exec";

const stateTone = (container: ContainerInfo): Tone =>
  container.state === "running" ? (container.health === "unhealthy" ? "bad" : container.health === "starting" ? "warn" : "ok") : container.state === "restarting" ? "warn" : "muted";

export function ContainerDrawer({
  container,
  onClose,
  onAction,
  busy,
}: {
  container: ContainerInfo | null;
  onClose: () => void;
  onAction: (action: string, target: string) => void;
  busy: string | null;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [live, setLive] = useState<ContainerInfo | null>(container);

  useEffect(() => {
    setLive(container);
    if (container) setTab("overview");
  }, [container]);

  // `live` only refreshes the open drawer; closing (container=null) must win
  const current = container && live && live.id === container.id ? live : container;
  const id = current?.id ?? "";

  // keep the stats tab fresh while the drawer is open
  useEffect(() => {
    if (!current || tab !== "stats") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const payload = await getJson<{ containers: ContainerInfo[] }>("/api/engine/containers?force=1");
        const next = payload.containers.find((entry) => entry.id === id);
        if (!cancelled && next) setLive(next);
      } catch {
        /* keep the last sample on a hiccup */
      }
    }, 3200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [current, tab, id]);

  return (
    <Drawer
      open={Boolean(current)}
      onClose={onClose}
      width={520}
      title={current?.name ?? "container"}
      subtitle={current ? `${current.image} · ${current.id.slice(0, 12)}` : ""}
      footer={
        current ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {current.state !== "running" ? (
              <Button icon="play" onClick={() => onAction("start", current.id)} disabled={busy === current.id}>
                start
              </Button>
            ) : (
              <Button icon="stop" onClick={() => onAction("stop", current.id)} disabled={busy === current.id}>
                stop
              </Button>
            )}
            <Button icon="rotate" onClick={() => onAction("restart", current.id)} disabled={busy === current.id}>
              restart
            </Button>
            <Button variant="danger" icon="trash" onClick={() => onAction("remove", current.id)} disabled={busy === current.id || current.state === "running"}>
              remove
            </Button>
          </div>
        ) : null
      }
    >
      {current ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Dot tone={stateTone(current)} pulse={current.state === "running"} />
              <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", TONE_TEXT[stateTone(current)])}>{current.statusText}</span>
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              <Chip tone={stateTone(current)}>{current.health}</Chip>
              {current.composeProject ? <Chip tone="info">{current.composeProject}</Chip> : null}
              {current.exitCode !== null ? <Chip tone={current.exitCode === 0 ? "muted" : "bad"}>exit {current.exitCode}</Chip> : null}
            </div>
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "overview", icon: "file" },
              { value: "logs", label: "logs", icon: "terminal" },
              { value: "stats", label: "stats", icon: "activity" },
              { value: "exec", label: "exec", icon: "code" },
            ]}
          />

          {tab === "overview" ? <OverviewTab container={current} /> : null}
          {tab === "logs" ? <LogsTab containerId={current.id} live={current.state === "running"} /> : null}
          {tab === "stats" ? <StatsTab container={current} /> : null}
          {tab === "exec" ? <ExecTab containerId={current.id} /> : null}
        </div>
      ) : null}
    </Drawer>
  );
}

function OverviewTab({ container }: { container: ContainerInfo }) {
  return (
    <div className="flex flex-col gap-3">
      <KeyValue
        rows={[
          { label: "id", value: container.id.slice(0, 24) },
          { label: "image", value: container.image },
          { label: "command", value: container.command || "—" },
          { label: "platform", value: container.platform },
          { label: "created", value: `${timeAgo(container.createdAt)} (${new Date(container.createdAt).toLocaleDateString()})` },
          { label: "started", value: container.startedAt ? timeAgo(container.startedAt) : "—" },
          { label: "finished", value: container.finishedAt ? timeAgo(container.finishedAt) : "—" },
          { label: "restarts", value: String(container.restartCount) },
          { label: "pids", value: String(container.pids) },
        ]}
      />

      <section className="flex flex-col gap-1.5">
        <h4 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-500">ports</h4>
        {container.ports.length ? (
          <div className="flex flex-wrap gap-1">
            {container.ports.map((port) => (
              <Chip key={`${port.containerPort}-${port.hostPort}`} tone={port.hostPort ? "info" : "muted"}>
                {port.hostPort ? `${port.hostPort}→` : ""}
                {port.containerPort}/{port.protocol}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">no published ports</p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h4 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-500">networks</h4>
        {container.networks.length ? (
          <div className="flex flex-col gap-1">
            {container.networks.map((network) => (
              <div key={network.name} className="flex items-center justify-between gap-2 rounded border border-line/60 px-2 py-1">
                <span className="truncate font-mono text-[10.5px] text-slate-300">{network.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-500">{network.ipAddress || "—"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">bridge only</p>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h4 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-500">mounts</h4>
        {container.mounts.length ? (
          <div className="flex flex-col gap-1">
            {container.mounts.map((mount) => (
              <div key={mount.destination} className="rounded border border-line/60 px-2 py-1">
                <p className="truncate font-mono text-[10.5px] text-slate-300">{mount.destination}</p>
                <p className="truncate font-mono text-[9.5px] text-slate-500">
                  {mount.source} · {mount.type} · {mount.mode}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">no mounts</p>
        )}
      </section>

      {container.env.length ? (
        <section className="flex flex-col gap-1.5">
          <h4 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-slate-500">environment ({container.env.length})</h4>
          <pre className="scroll-thin max-h-40 overflow-auto rounded border border-line/60 bg-ink-900/50 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
            {container.env
              .map((line) => (/password|secret|token|key/i.test(line.split("=")[0]) ? `${line.split("=")[0]}=••••` : line))
              .join("\n")}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function LogsTab({ containerId, live }: { containerId: string; live: boolean }) {
  const [auto, setAuto] = useState(true);
  const [tail, setTail] = useState(250);
  const path = `/api/engine/containers/${encodeURIComponent(containerId)}/logs?tail=${tail}`;
  const logs = usePoll<{ logs: string; fetchedAt: string }>(path, auto && live ? 2500 : 0, [tail]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Toggle checked={auto} onChange={setAuto} label="auto-refresh" hint="250 lines every 2.5s" />
        <div className="flex items-center gap-1">
          {[100, 250, 500].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTail(value)}
              className={cn(
                "rounded border px-1.5 py-[2px] font-mono text-[9.5px]",
                tail === value ? "border-ice/50 text-ice" : "border-line text-slate-400 hover:text-slate-200",
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      {logs.error ? <Notice tone="bad">{logs.error}</Notice> : null}
      <pre className="scroll-thin h-[52vh] overflow-auto rounded-md border border-line bg-[#06030c] p-2.5 font-mono text-[10.5px] leading-[1.55] text-slate-300">
        {logs.data?.logs || "no log output yet"}
      </pre>
      <p className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
        <span>{logs.data?.logs ? `${logs.data.logs.split("\n").length} lines` : "0 lines"}</span>
        <span>{auto && live ? "streaming" : "paused"}</span>
      </p>
    </div>
  );
}

function StatsTab({ container }: { container: ContainerInfo }) {
  const history = container.history ?? { cpu: [], memory: [], net: [], block: [] };
  const cpuTone: Tone = container.cpuPct > 80 ? "bad" : container.cpuPct > 45 ? "warn" : "ok";
  const memTone: Tone = container.memoryPct > 85 ? "bad" : container.memoryPct > 60 ? "warn" : "ok";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-inset rounded-lg border p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">cpu</p>
          <p className={cn("tabular mt-1 text-[20px] font-semibold leading-none", TONE_TEXT[cpuTone])}>{container.cpuPct.toFixed(1)}%</p>
          <div className="mt-1.5">
            <Sparkline values={history.cpu.length ? history.cpu : [container.cpuPct]} width={190} height={38} tone={cpuTone} />
          </div>
        </div>
        <div className="glass-inset rounded-lg border p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">memory</p>
          <p className={cn("tabular mt-1 text-[20px] font-semibold leading-none", TONE_TEXT[memTone])}>{formatBytes(container.memoryBytes)}</p>
          <p className="mt-0.5 font-mono text-[9.5px] text-slate-500">
            {container.memoryPct.toFixed(1)}% of {formatBytes(container.memoryLimitBytes)}
          </p>
          <div className="mt-1.5">
            <Sparkline values={history.memory.length ? history.memory : [container.memoryBytes]} width={190} height={30} tone={memTone} />
          </div>
        </div>
      </div>

      <div className="glass-inset grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3">
        {[
          { label: "net rx", value: formatBytes(container.netRxBytes) },
          { label: "net tx", value: formatBytes(container.netTxBytes) },
          { label: "block read", value: formatBytes(container.blockReadBytes) },
          { label: "block write", value: formatBytes(container.blockWriteBytes) },
          { label: "pids", value: String(container.pids) },
          { label: "restarts", value: String(container.restartCount) },
        ].map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">{row.label}</span>
            <span className="tabular font-mono text-[11px] text-slate-200">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">network throughput (30 samples)</p>
        <Sparkline values={history.net.length ? history.net : [container.netRxBytes]} width={450} height={46} tone="info" />
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">block i/o (30 samples)</p>
        <Sparkline values={history.block.length ? history.block : [container.blockWriteBytes]} width={450} height={46} tone="warn" />
      </div>
    </div>
  );
}

function ExecTab({ containerId }: { containerId: string }) {
  const [command, setCommand] = useState("uname -a");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<{ command: string; exitCode: number | null; durationMs: number; output: string; at: number }[]>([]);

  const run = async () => {
    if (!command.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const payload = await postJson<ExecResult & { command: string }>(`/api/engine/containers/${encodeURIComponent(containerId)}/exec`, { command });
      setResult(payload);
      setHistory((current) => [{ command, exitCode: payload.exitCode, durationMs: payload.durationMs, output: payload.output, at: Date.now() }, ...current].slice(0, 8));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="muted" icon="terminal">
        Commands run as <span className="font-mono">/bin/sh -lc &quot;…&quot;</span> with a TTY disabled. Exit code and duration are reported.
      </Notice>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-slate-500">$</span>
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run();
          }}
          placeholder="cat /etc/os-release"
          className="h-7 flex-1 rounded-md border border-line bg-ink-900/60 px-2 font-mono text-[11px] text-slate-100 focus:border-ice/60 focus:outline-none"
        />
        <Button variant="primary" icon="play" onClick={run} disabled={running}>
          {running ? "running" : "exec"}
        </Button>
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {result ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Chip tone={result.exitCode === 0 ? "ok" : "bad"}>exit {result.exitCode ?? "signal"}</Chip>
            <Chip tone="muted">{formatMs(result.durationMs)}</Chip>
          </div>
          <pre className="scroll-thin max-h-[36vh] overflow-auto rounded-md border border-line bg-[#06030c] p-2.5 font-mono text-[10.5px] leading-relaxed text-slate-300">
            {result.output || "(no output)"}
          </pre>
        </div>
      ) : null}
      {history.length ? (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">history</p>
          {history.map((entry) => (
            <button
              key={`${entry.at}-${entry.command}`}
              type="button"
              onClick={() => {
                setCommand(entry.command);
                setResult({ exitCode: entry.exitCode, output: entry.output, durationMs: entry.durationMs });
              }}
              className="flex items-center gap-2 rounded border border-line/60 px-2 py-1 text-left hover:border-ice/40"
            >
              <Icon name="terminal" size={11} className="shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-300">{entry.command}</span>
              <span className="shrink-0 font-mono text-[9.5px] text-slate-500">{formatMs(entry.durationMs)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
