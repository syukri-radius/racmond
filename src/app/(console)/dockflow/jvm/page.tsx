"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { deleteJson, formatBytes, formatMs, getJson, patchJson, postJson, timeAgo, usePoll } from "@/lib/client";
import type { AnatomyNode, CallTreeNode, JvmDump, JvmSnapshot, JvmTarget, JvmThread, MBeanAttribute, SamplerResult } from "@/lib/jvm/types";
import { MapCanvas, type MapCard } from "@/components/map/MapCanvas";
import {
  Bar,
  Button,
  Chip,
  Dot,
  Drawer,
  ErrorNote,
  Field,
  KeyValue,
  Metric,
  Modal,
  Notice,
  PageHeader,
  Panel,
  Select,
  Sparkline,
  Table,
  Tabs,
  Td,
  TextInput,
  Th,
  TONE_TEXT,
  type Tone,
} from "@/components/ui/primitives";

type Tab = "monitor" | "gc" | "threads" | "sampler" | "mbeans" | "dumps" | "anatomy";

interface MBeanPayload {
  domains: string[];
  mbeans: { domain: string; name: string }[];
  attributes: MBeanAttribute[];
  operations: { name: string; description: string; action: string }[];
  source: string;
}

const THREAD_TONE: Record<string, Tone> = {
  RUNNABLE: "ok",
  BLOCKED: "bad",
  WAITING: "warn",
  TIMED_WAITING: "info",
  NEW: "muted",
  TERMINATED: "muted",
};

export default function JvmPage() {
  const targets = usePoll<{ targets: JvmTarget[] }>("/api/jvm/targets", 0);
  const [targetId, setTargetId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("monitor");
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);

  const list = targets.data?.targets ?? [];
  useEffect(() => {
    if (!targetId && list.length) setTargetId(list[0].id);
  }, [targetId, list]);

  const target = list.find((entry) => entry.id === targetId) ?? null;
  const snapshot = usePoll<{ snapshot: JvmSnapshot }>(targetId ? `/api/jvm/snapshot?target=${encodeURIComponent(targetId)}` : null, 5000, [targetId]);

  const addTarget = async (body: { name: string; kind: string; url?: string }) => {
    try {
      await postJson("/api/jvm/targets", body);
      targets.refresh();
      setNotice({ tone: "ok", message: "Target added." });
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const removeTarget = async () => {
    if (!target) return;
    try {
      await deleteJson(`/api/jvm/targets?id=${encodeURIComponent(target.id)}`);
      setTargetId("");
      targets.refresh();
      setNotice({ tone: "warn", message: "Target removed." });
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const snap = snapshot.data?.snapshot ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="jvm / diagnostics"
        title="JVM control room"
        description="Jolokia and Actuator endpoints plus a simulated JVM. Read heap, GC, threads, MBeans and anatomy; run a statistical sampler; capture and reopen dumps."
        actions={
          <>
            <Button icon="refresh" onClick={() => { targets.refresh(); snapshot.refresh(); }}>
              refresh
            </Button>
            <Button icon="plus" onClick={() => setAddOpen(true)}>
              add target
            </Button>
            <Button variant="danger" icon="trash" onClick={() => void removeTarget()} disabled={!target || target.discovered}>
              remove
            </Button>
          </>
        }
      />

      {targets.error ? <ErrorNote message={targets.error} onRetry={targets.refresh} /> : null}
      {snapshot.error ? <ErrorNote message={snapshot.error} onRetry={snapshot.refresh} /> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {list.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTargetId(entry.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em]",
              entry.id === targetId ? "border-ice/55 bg-ice/12 text-ice" : "border-line text-slate-400 hover:border-ice/35 hover:text-slate-200",
            )}
            title={entry.url ?? entry.note ?? entry.kind}
          >
            <Dot tone={entry.available ? (entry.kind === "simulated" ? "warn" : "ok") : "bad"} pulse={entry.available} />
            {entry.name}
            <span className="text-[8.5px] text-slate-500">{entry.kind}</span>
            {entry.discovered ? <span className="text-[8.5px] text-slate-500">· auto</span> : null}
          </button>
        ))}
        {!list.length ? <p className="font-mono text-[11px] text-slate-500">no targets — add one or let the engine scan discover Java containers</p> : null}
      </div>

      {snap ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="source" value={snap.source} hint={snap.online ? "online" : snap.error ?? "offline"} icon="cpu" tone={snap.online ? (snap.source === "simulated" ? "warn" : "ok") : "bad"} />
            <Metric label="heap used" value={formatBytes(snap.memory.heapUsed)} hint={`${((snap.memory.heapUsed / Math.max(1, snap.memory.heapMax)) * 100).toFixed(0)}% of ${formatBytes(snap.memory.heapMax)}`} icon="memory" tone={snap.memory.heapUsed / Math.max(1, snap.memory.heapMax) > 0.85 ? "bad" : "info"} />
            <Metric label="gc overhead" value={`${snap.gc.overheadPct.toFixed(1)}%`} hint={`${snap.gc.totalCollections} collections`} icon="rotate" tone={snap.gc.overheadPct > 10 ? "warn" : "ok"} />
            <Metric label="threads" value={snap.threadsInfo.live} hint={`${snap.threadsInfo.blocked} blocked · ${snap.threadsInfo.deadlocked} deadlocked`} icon="threads" tone={snap.threadsInfo.deadlocked ? "bad" : snap.threadsInfo.blocked > 4 ? "warn" : "ok"} />
            <Metric label="cpu" value={`${snap.cpu.processPct.toFixed(1)}%`} hint={`load ${snap.cpu.loadAverage.toFixed(2)}`} icon="activity" tone={snap.cpu.processPct > 80 ? "bad" : "ok"} />
            <Metric label="uptime" value={formatMs(snap.identity.uptimeMs)} hint={`pid ${snap.identity.pid} · ${snap.classes.loaded} classes`} icon="clock" />
          </div>

          {snap.source === "simulated" ? (
            <Notice tone="warn" icon="alert">
              Simulated JVM — no Jolokia or Actuator endpoint answered for this target. Every figure is synthetic but shaped like a real 17.x VM; the live error is preserved in the target note.
            </Notice>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "monitor", label: "monitor", icon: "gauge" },
                { value: "gc", label: "visual gc", icon: "rotate" },
                { value: "threads", label: "threads", count: snap.threadsInfo.live, icon: "threads" },
                { value: "sampler", label: "sampler", icon: "activity" },
                { value: "mbeans", label: "mbeans", icon: "stack" },
                { value: "dumps", label: "dumps", icon: "save" },
                { value: "anatomy", label: "anatomy", icon: "layers" },
              ]}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
              fetched {timeAgo(snap.fetchedAt)} · {snap.identity.vmName}
            </span>
          </div>

          <div className="min-h-0 flex-1">
            {tab === "monitor" ? <MonitorTab snapshot={snap} /> : null}
            {tab === "gc" ? <GcTab snapshot={snap} /> : null}
            {tab === "threads" ? <ThreadsTab targetId={targetId} /> : null}
            {tab === "sampler" ? <SamplerTab targetId={targetId} onSaved={() => setNotice({ tone: "ok", message: "Profiler dump saved — see the Dumps tab." })} /> : null}
            {tab === "mbeans" ? <MBeansTab targetId={targetId} /> : null}
            {tab === "dumps" ? <DumpsTab targetId={targetId} /> : null}
            {tab === "anatomy" ? <AnatomyTab targetId={targetId} /> : null}
          </div>
        </>
      ) : (
        <Panel className="min-h-[260px]">
          <p className="py-10 text-center text-[12px] text-slate-500">{targetId ? "loading snapshot…" : "select a JVM target"}</p>
        </Panel>
      )}

      <AddTargetModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={addTarget} />
    </div>
  );
}

function MonitorTab({ snapshot }: { snapshot: JvmSnapshot }) {
  const heapPct = (snapshot.memory.heapUsed / Math.max(1, snapshot.memory.heapMax)) * 100;
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      <Panel title="memory" subtitle={`${snapshot.memory.pools.length} pools`} icon="memory">
        <div className="flex flex-col gap-2">
          <div>
            <div className="flex items-end justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">heap</span>
              <span className="tabular font-mono text-[11px] text-slate-200">
                {formatBytes(snapshot.memory.heapUsed)} / {formatBytes(snapshot.memory.heapMax)}
              </span>
            </div>
            <div className="mt-1">
              <Bar value={heapPct} tone={heapPct > 85 ? "bad" : heapPct > 70 ? "warn" : "ok"} height={7} />
            </div>
          </div>
          <div>
            <div className="flex items-end justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">non-heap</span>
              <span className="tabular font-mono text-[11px] text-slate-200">{formatBytes(snapshot.memory.nonHeapUsed)}</span>
            </div>
            <div className="mt-1">
              <Bar value={(snapshot.memory.nonHeapUsed / Math.max(1, snapshot.memory.nonHeapCommitted)) * 100} tone="info" height={7} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {snapshot.memory.pools.map((pool) => (
              <div key={pool.name} className="flex items-center gap-2">
                <span className="w-[124px] shrink-0 truncate font-mono text-[9.5px] text-slate-400" title={pool.name}>
                  {pool.name}
                </span>
                <Bar value={pool.used} max={Math.max(pool.max, pool.committed, pool.used)} tone={pool.type === "heap" ? "accent" : "info"} height={4} />
                <span className="tabular w-14 shrink-0 text-right font-mono text-[9px] text-slate-500">{formatBytes(pool.used)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between rounded border border-line/60 px-2 py-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">heap trend</span>
            <Sparkline values={snapshot.history.map((point) => point.heap)} width={180} height={30} tone="accent" />
          </div>
        </div>
      </Panel>

      <Panel title="runtime" subtitle={snapshot.identity.vmVersion} icon="cpu">
        <div className="flex flex-col gap-2">
          <KeyValue
            rows={[
              { label: "vm", value: snapshot.identity.vmName },
              { label: "vendor", value: snapshot.identity.vmVendor },
              { label: "pid", value: String(snapshot.identity.pid) },
              { label: "host", value: snapshot.identity.host },
              { label: "uptime", value: formatMs(snapshot.identity.uptimeMs) },
              { label: "classes", value: `${snapshot.classes.loaded} loaded · ${snapshot.classes.unloaded} unloaded` },
              { label: "cpu time", value: formatMs(snapshot.cpu.cpuTimeMs) },
            ]}
          />
          <div className="flex items-center gap-2 rounded border border-line/60 px-2 py-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">process cpu</span>
            <div className="flex-1">
              <Bar value={snapshot.cpu.processPct} tone={snapshot.cpu.processPct > 80 ? "bad" : "ok"} height={5} />
            </div>
            <span className="tabular font-mono text-[9.5px] text-slate-300">{snapshot.cpu.processPct.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-2 rounded border border-line/60 px-2 py-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">threads trend</span>
            <Sparkline values={snapshot.history.map((point) => point.threads)} width={150} height={24} tone="info" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">system properties</p>
            <div className="scroll-thin max-h-28 overflow-auto rounded bg-ink-900/50 p-1.5 font-mono text-[9.5px] leading-relaxed text-slate-400">
              {Object.entries(snapshot.identity.systemProperties)
                .slice(0, 12)
                .map(([key, value]) => (
                  <p key={key} className="truncate" title={`${key}=${value}`}>
                    <span className="text-slate-500">{key}</span>=<span className="text-slate-300">{value}</span>
                  </p>
                ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {snapshot.identity.args.slice(0, 5).map((arg, index) => (
                <Chip key={`${arg}-${index}`} tone="muted">
                  {arg}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="buffers & summary" subtitle={`${snapshot.nio.length} buffer pools`} icon="database">
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="blocked" value={snapshot.threadsInfo.blocked} tone={snapshot.threadsInfo.blocked ? "warn" : "ok"} />
            <Metric label="waiting" value={snapshot.threadsInfo.waiting + snapshot.threadsInfo.timedWaiting} tone="muted" />
            <Metric label="peak threads" value={snapshot.threadsInfo.peak} tone="info" />
            <Metric label="deadlocked" value={snapshot.threadsInfo.deadlocked} tone={snapshot.threadsInfo.deadlocked ? "bad" : "ok"} />
          </div>
          <div className="flex flex-col gap-1">
            {snapshot.nio.map((buffer) => (
              <div key={buffer.name} className="flex items-center gap-2">
                <span className="w-[120px] shrink-0 truncate font-mono text-[9.5px] text-slate-400">{buffer.name}</span>
                <Bar value={buffer.memoryUsed} max={Math.max(1, buffer.memoryCapacity)} tone="info" height={4} />
                <span className="tabular w-16 shrink-0 text-right font-mono text-[9px] text-slate-500">
                  {formatBytes(buffer.memoryUsed)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {snapshot.gc.collectors.map((collector) => (
              <Chip key={collector.name} tone={collector.avgPauseMs > 40 ? "warn" : "ok"}>
                {collector.name} · {collector.collections} · {collector.avgPauseMs.toFixed(1)}ms
              </Chip>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function GcTab({ snapshot }: { snapshot: JvmSnapshot }) {
  const maxPause = Math.max(1, ...snapshot.gc.events.map((event) => event.pauseMs));
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel title="collectors" subtitle={`${snapshot.gc.totalCollections} collections · ${formatMs(snapshot.gc.totalTimeMs)} total`} icon="rotate">
        <Table
          head={
            <tr className="border-b border-line">
              <Th>collector</Th>
              <Th>collections</Th>
              <Th>total time</Th>
              <Th>avg pause</Th>
              <Th>pools</Th>
            </tr>
          }
        >
          {snapshot.gc.collectors.map((collector) => (
            <tr key={collector.name} className="border-b border-line-soft/60">
              <Td className="font-mono text-[10.5px] text-slate-100">{collector.name}</Td>
              <Td className="tabular font-mono text-[10.5px]">{collector.collections}</Td>
              <Td className="tabular font-mono text-[10.5px]">{formatMs(collector.totalTimeMs)}</Td>
              <Td>
                <span className={cn("tabular font-mono text-[10.5px]", collector.avgPauseMs > 40 ? "text-amber-300" : "text-slate-300")}>{collector.avgPauseMs.toFixed(2)}ms</span>
              </Td>
              <Td className="font-mono text-[9.5px] text-slate-500">{collector.pools.join(", ")}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-2 flex items-center justify-between rounded border border-line/60 px-2 py-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">gc overhead</span>
          <span className={cn("tabular font-mono text-[12px]", snapshot.gc.overheadPct > 10 ? "text-amber-300" : "text-emerald-300")}>{snapshot.gc.overheadPct.toFixed(2)}%</span>
        </div>
      </Panel>

      <Panel title="recent collections" subtitle="pause timeline" icon="activity">
        <div className="flex flex-col gap-1">
          {snapshot.gc.events.slice(-14).reverse().map((event, index) => (
            <div key={`${event.at}-${index}`} className="flex items-center gap-2">
              <span className="w-[92px] shrink-0 font-mono text-[9px] text-slate-500">{new Date(event.at * (event.at < 1e12 ? 1000 : 1)).toLocaleTimeString()}</span>
              <span className="w-[74px] shrink-0 truncate font-mono text-[9.5px] text-slate-400">{event.collector}</span>
              <div className="flex-1">
                <Bar value={event.pauseMs} max={maxPause} tone={event.pauseMs > 40 ? "bad" : event.pauseMs > 15 ? "warn" : "ok"} height={5} />
              </div>
              <span className="tabular w-14 shrink-0 text-right font-mono text-[9px] text-slate-400">{event.pauseMs.toFixed(2)}ms</span>
              <span className="tabular w-16 shrink-0 text-right font-mono text-[9px] text-slate-500">{formatBytes(event.reclaimedBytes)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">heap after gc events</p>
          <div className="flex flex-col gap-1">
            {snapshot.memory.pools
              .filter((pool) => pool.type === "heap")
              .map((pool) => (
                <div key={pool.name} className="flex items-center gap-2">
                  <span className="w-[120px] shrink-0 truncate font-mono text-[9.5px] text-slate-400">{pool.name}</span>
                  <Bar value={pool.used} max={Math.max(1, pool.max)} tone="accent" height={4} />
                  <span className="tabular w-16 shrink-0 text-right font-mono text-[9px] text-slate-500">{formatBytes(pool.committed)}</span>
                </div>
              ))}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ThreadsTab({ targetId }: { targetId: string }) {
  const view = usePoll<{ threads: JvmThread[]; deadlock: { detected: boolean; cycles: { threads: string[]; lock: string }[]; message: string } }>(
    targetId ? `/api/jvm/threads?target=${encodeURIComponent(targetId)}` : null,
    6000,
    [targetId],
  );
  const [stateFilter, setStateFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openThread, setOpenThread] = useState<JvmThread | null>(null);

  const threads = (view.data?.threads ?? []).filter((thread) => {
    if (stateFilter !== "all" && thread.state !== stateFilter) return false;
    if (!query) return true;
    return thread.name.toLowerCase().includes(query.toLowerCase()) || thread.stack.join(" ").toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="flex flex-col gap-2">
      {view.error ? <ErrorNote message={view.error} onRetry={view.refresh} /> : null}
      {view.data?.deadlock.detected ? (
        <Notice tone="bad" icon="alert">
          <strong>Deadlock detected.</strong> {view.data.deadlock.message}
          {view.data.deadlock.cycles.map((cycle, index) => (
            <span key={index} className="ml-1 font-mono text-[10.5px]">
              [{cycle.threads.join(" ↔ ")} on {cycle.lock}]
            </span>
          ))}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="filter thread / stack"
            className="h-7 w-[220px] rounded-md border border-line bg-ink-900/60 px-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none"
          />
          <Select
            value={stateFilter}
            onChange={setStateFilter}
            className="w-[132px]"
            options={[{ value: "all", label: "all states" }, ...["RUNNABLE", "BLOCKED", "WAITING", "TIMED_WAITING", "NEW", "TERMINATED"].map((state) => ({ value: state, label: state }))]}
          />
        </div>
        <Chip tone="muted">{threads.length} threads</Chip>
      </div>
      <Panel padded={false} className="max-h-[calc(100vh-330px)]">
        <div className="scroll-thin max-h-[calc(100vh-330px)] overflow-y-auto">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => setOpenThread(thread)}
              className="flex w-full items-center gap-2 border-b border-line-soft/60 px-3 py-1.5 text-left hover:bg-ice/[0.06]"
            >
              <Dot tone={THREAD_TONE[thread.state] ?? "muted"} pulse={thread.state === "RUNNABLE"} />
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-200">{thread.name}</span>
              {thread.daemon ? <Chip tone="muted">daemon</Chip> : null}
              <Chip tone={THREAD_TONE[thread.state] ?? "muted"}>{thread.state}</Chip>
              {thread.blockedTimeMs > 0 ? <span className="w-16 shrink-0 text-right font-mono text-[9px] text-amber-300">{(thread.blockedTimeMs / 1000).toFixed(1)}s blk</span> : null}
              <span className="w-[180px] shrink-0 truncate text-right font-mono text-[9px] text-slate-500">{thread.stack[1] ?? thread.stack[0] ?? ""}</span>
            </button>
          ))}
          {!threads.length ? <p className="py-6 text-center text-[11.5px] text-slate-500">no threads match</p> : null}
        </div>
      </Panel>

      <Drawer open={Boolean(openThread)} onClose={() => setOpenThread(null)} title={openThread?.name ?? ""} subtitle={openThread ? `tid ${openThread.id} · ${openThread.state}` : ""} width={520}>
        {openThread ? (
          <div className="flex flex-col gap-2">
            <KeyValue
              rows={[
                { label: "state", value: openThread.state },
                { label: "daemon", value: String(openThread.daemon) },
                { label: "priority", value: String(openThread.priority) },
                { label: "blocked", value: `${openThread.blockedCount} × ${formatMs(openThread.blockedTimeMs)}` },
                { label: "waited", value: `${openThread.waitedCount} ×` },
                { label: "lock", value: openThread.lockName ?? "—" },
                { label: "owner", value: openThread.lockOwnerName ? `${openThread.lockOwnerName} (#${openThread.lockOwnerId})` : "—" },
              ]}
            />
            <div className="flex flex-col gap-0.5 rounded border border-line/60 bg-ink-900/40 p-2">
              {openThread.stack.map((frame, index) => (
                <p key={`${frame}-${index}`} className="font-mono text-[10px] leading-relaxed text-slate-300">
                  {index ? <span className="text-slate-600">at </span> : null}
                  {frame}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function SamplerTab({ targetId, onSaved }: { targetId: string; onSaved: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<SamplerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowMs, setWindowMs] = useState(6000);

  useEffect(() => {
    setSessionId(null);
    setResult(null);
  }, [targetId]);

  useEffect(() => {
    if (!sessionId || result?.status !== "running") return;
    const timer = setInterval(async () => {
      try {
        const payload = await getJson<{ result: SamplerResult }>(`/api/jvm/sampler?session=${encodeURIComponent(sessionId)}`);
        setResult(payload.result);
      } catch {
        /* sampler finished */
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [sessionId, result?.status]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await postJson<{ result: SamplerResult }>("/api/jvm/sampler", { target: targetId, windowMs, intervalMs: 20 });
      setResult(payload.result);
      setSessionId(payload.result.sessionId ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const payload = await getJson<{ result: SamplerResult }>(`/api/jvm/sampler?session=${encodeURIComponent(sessionId)}`).catch(() => ({ result: null as unknown as SamplerResult }));
      if (payload.result) setResult(payload.result);
      const stopped = await deleteJson<{ result: SamplerResult }>(`/api/jvm/sampler?session=${encodeURIComponent(sessionId)}`);
      setResult(stopped.result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!sessionId) return;
    try {
      await patchJson(`/api/jvm/sampler?session=${encodeURIComponent(sessionId)}`, {});
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const cards = useMemo(() => (result ? callTreeCards(result.callTree) : []), [result]);

  return (
    <div className="flex flex-col gap-2">
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line/60 px-2.5 py-2">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-500">statistical sampler</span>
        <Select
          value={String(windowMs)}
          onChange={(value) => setWindowMs(Number(value))}
          className="w-[118px]"
          options={[
            { value: "3000", label: "3s window" },
            { value: "6000", label: "6s window" },
            { value: "12000", label: "12s window" },
          ]}
        />
        <Button variant="primary" icon="play" onClick={() => void start()} disabled={busy || result?.status === "running"}>
          start
        </Button>
        <Button icon="stop" onClick={() => void stop()} disabled={!sessionId || result?.status !== "running"}>
          stop
        </Button>
        <Button icon="save" onClick={() => void save()} disabled={!sessionId || result?.status === "running"}>
          save dump
        </Button>
        {result ? (
          <>
            <Chip tone={result.status === "running" ? "info" : "ok"}>{result.status}</Chip>
            <Chip tone="muted">{result.samples} samples</Chip>
            <Chip tone="muted">{result.observedThreads} threads</Chip>
            <Chip tone="muted">{formatMs(result.windowMs)}</Chip>
          </>
        ) : null}
      </div>

      {!result ? (
        <Panel className="min-h-[220px]">
          <p className="py-10 text-center text-[11.5px] text-slate-500">Start the sampler to build a call tree from stack samples.</p>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Panel padded={false} title="call tree" subtitle="sampled stack hierarchy" icon="layers" className="min-h-[360px] overflow-hidden">
            <MapCanvas cards={cards} edges={cards.slice(1).map((card) => ({ source: card.parentId ?? cards[0].id, target: card.id, tone: "accent" }))} layout="tree" initialLevels={2} />
          </Panel>
          <div className="flex flex-col gap-3">
            <Panel title="hot methods" subtitle="self time" icon="activity">
              <div className="flex flex-col gap-1.5">
                {result.hotMethods.slice(0, 8).map((method) => (
                  <div key={method.method} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300" title={`${method.class}.${method.method}`}>
                      {method.method}
                    </span>
                    <div className="w-16 shrink-0">
                      <Bar value={method.selfPct} tone={method.selfPct > 25 ? "bad" : method.selfPct > 10 ? "warn" : "ok"} height={4} />
                    </div>
                    <span className="tabular w-11 shrink-0 text-right font-mono text-[9.5px] text-slate-400">{method.selfPct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="allocations" subtitle="sampled bytes" icon="memory">
              <div className="flex flex-col gap-1.5">
                {result.allocations.slice(0, 8).map((allocation) => (
                  <div key={allocation.className} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{allocation.className}</span>
                    <div className="w-16 shrink-0">
                      <Bar value={allocation.pct} tone="accent" height={4} />
                    </div>
                    <span className="tabular w-14 shrink-0 text-right font-mono text-[9.5px] text-slate-400">{formatBytes(allocation.bytes)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function callTreeCards(root: CallTreeNode): MapCard[] {
  const cards: MapCard[] = [];
  const walk = (node: CallTreeNode, parentId: string | null, depth: number) => {
    if (depth > 6) return;
    cards.push({
      id: node.id,
      parentId,
      title: node.frame || node.className,
      subtitle: `${node.className} · self ${node.self} · total ${node.total}`,
      kind: "service",
      tone: depth === 0 ? "accent" : node.self > 30 ? "warn" : "info",
      chips: [node.className.split(".").pop() ?? node.className],
      stats: [{ label: "self", pct: Math.min(100, node.self), value: `${node.self}`, tone: node.self > 25 ? "warn" : "ok" }],
    });
    for (const child of node.children ?? []) walk(child, node.id, depth + 1);
  };
  walk(root, null, 0);
  return cards;
}

function MBeansTab({ targetId }: { targetId: string }) {
  const browser = usePoll<MBeanPayload>(targetId ? `/api/jvm/mbeans?target=${encodeURIComponent(targetId)}` : null, 0, [targetId]);
  const [domain, setDomain] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const mbeans = (browser.data?.mbeans ?? []).filter((mbean) => domain === "all" || mbean.domain === domain);

  const runOperation = async (action: string) => {
    setBusy(action);
    try {
      const payload = await postJson<{ ok: boolean; message: string }>("/api/jvm/mbeans", { target: targetId, action });
      setResult(`${payload.ok ? "ok" : "failed"} — ${payload.message}`);
      browser.refresh();
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {browser.error ? <ErrorNote message={browser.error} onRetry={browser.refresh} /> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={domain}
          onChange={(value) => { setDomain(value); setSelected(null); }}
          className="w-[220px]"
          options={[{ value: "all", label: "all domains" }, ...(browser.data?.domains ?? []).map((entry) => ({ value: entry, label: entry }))]}
        />
        <Chip tone="muted">{mbeans.length} mbeans</Chip>
        <Chip tone="info">source {browser.data?.source ?? "…"}</Chip>
        {result ? <Chip tone={result.startsWith("ok") ? "ok" : "bad"}>{result}</Chip> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Panel padded={false} title="mbeans" subtitle="curated set" icon="stack" className="max-h-[calc(100vh-330px)]">
          <div className="scroll-thin max-h-[calc(100vh-330px)] overflow-y-auto">
            {mbeans.map((mbean) => (
              <button
                key={mbean.name}
                type="button"
                onClick={() => setSelected(mbean.name)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-line-soft/60 px-2.5 py-1.5 text-left hover:bg-ice/[0.06]",
                  selected === mbean.name && "bg-ice/[0.09]",
                )}
              >
                <Dot tone="accent" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{mbean.name}</span>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="attributes & operations" subtitle={selected ?? "select an mbean"} icon="file">
          <div className="flex flex-col gap-2">
            <Table
              head={
                <tr className="border-b border-line">
                  <Th>attribute</Th>
                  <Th>value</Th>
                  <Th>type</Th>
                </tr>
              }
            >
              {(browser.data?.attributes ?? []).map((attribute) => (
                <tr key={attribute.name} className="border-b border-line-soft/60">
                  <Td className="font-mono text-[10px] text-slate-300">{attribute.name}</Td>
                  <Td className="tabular max-w-[220px] truncate font-mono text-[10px] text-slate-100" >{attribute.value}</Td>
                  <Td className="font-mono text-[9.5px] text-slate-500">{attribute.type}</Td>
                </tr>
              ))}
            </Table>
            <div className="flex flex-wrap gap-1.5">
              {(browser.data?.operations ?? []).map((operation) => (
                <Button key={operation.action} size="xs" icon="play" title={operation.description} onClick={() => void runOperation(operation.action)} disabled={busy === operation.action}>
                  {operation.name}
                </Button>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DumpsTab({ targetId }: { targetId: string }) {
  const dumps = usePoll<{ dumps: JvmDump[] }>(targetId ? `/api/jvm/dumps?target=${encodeURIComponent(targetId)}` : null, 8000, [targetId]);
  const [viewer, setViewer] = useState<JvmDump | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = async (kind: "thread" | "heap") => {
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/jvm/dumps", { target: targetId, kind });
      dumps.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const open = async (dump: JvmDump) => {
    try {
      const payload = await getJson<{ dump: JvmDump }>(`/api/jvm/dumps/${dump.id}`);
      setViewer(payload.dump);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const remove = async (dump: JvmDump) => {
    try {
      await deleteJson(`/api/jvm/dumps/${dump.id}`);
      dumps.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <div className="flex items-center gap-1.5">
        <Button icon="save" onClick={() => void capture("thread")} disabled={busy}>
          capture thread dump
        </Button>
        <Button icon="save" onClick={() => void capture("heap")} disabled={busy}>
          capture heap snapshot
        </Button>
        <Chip tone="muted">{dumps.data?.dumps.length ?? 0} stored</Chip>
      </div>
      <Panel padded={false} className="max-h-[calc(100vh-330px)]">
        <Table
          head={
            <tr className="border-b border-line">
              <Th>label</Th>
              <Th>kind</Th>
              <Th>size</Th>
              <Th>created</Th>
              <Th className="text-right">actions</Th>
            </tr>
          }
        >
          {(dumps.data?.dumps ?? []).map((dump) => (
            <tr key={dump.id} className="border-b border-line-soft/60">
              <Td>
                <button type="button" onClick={() => void open(dump)} className="max-w-[320px] truncate font-mono text-[10.5px] text-slate-100 hover:text-ice">
                  {dump.label}
                </button>
              </Td>
              <Td>
                <Chip tone={dump.kind === "thread" ? "info" : dump.kind === "heap" ? "warn" : "accent"}>{dump.kind}</Chip>
              </Td>
              <Td className="tabular font-mono text-[10px]">{formatBytes(dump.size)}</Td>
              <Td className="font-mono text-[9.5px] text-slate-500">{timeAgo(dump.createdAt)}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <Button size="xs" icon="eye" onClick={() => void open(dump)}>
                    view
                  </Button>
                  <Button size="xs" variant="danger" icon="trash" onClick={() => void remove(dump)}>
                    delete
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
          {!(dumps.data?.dumps ?? []).length ? (
            <tr>
              <Td className="py-8 text-center text-slate-500">no dumps stored for this target</Td>
            </tr>
          ) : null}
        </Table>
      </Panel>

      <Drawer open={Boolean(viewer)} onClose={() => setViewer(null)} title={viewer?.label ?? ""} subtitle={viewer ? `${viewer.kind} · ${formatBytes(viewer.size)} · ${timeAgo(viewer.createdAt)}` : ""} width={620}>
        {viewer ? (
          <pre className="scroll-thin h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-line bg-[#06030c] p-2.5 font-mono text-[10px] leading-relaxed text-slate-300">
            {viewer.content ?? "(dump body not stored)"}
          </pre>
        ) : null}
      </Drawer>
    </div>
  );
}

function AnatomyTab({ targetId }: { targetId: string }) {
  const anatomy = usePoll<{ nodes: AnatomyNode[]; snapshot: { online: boolean; source: string; name: string } }>(
    targetId ? `/api/jvm/anatomy?target=${encodeURIComponent(targetId)}` : null,
    8000,
    [targetId],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const nodes = anatomy.data?.nodes ?? [];
  const cards: MapCard[] = useMemo(
    () =>
      nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        subtitle: node.subtitle,
        kind: node.kind,
        chips: node.chips,
        tone: node.utilization === null ? "muted" : node.utilization > 85 ? "bad" : node.utilization > 65 ? "warn" : "ok",
        stats: node.utilization === null ? undefined : [{ label: "use", pct: node.utilization, value: `${node.utilization.toFixed(0)}%`, tone: node.utilization > 85 ? "bad" : "ok" }],
      })),
    [nodes],
  );
  const edges = nodes.filter((node) => node.parentId).map((node) => ({ source: node.parentId as string, target: node.id, tone: "accent" as const }));
  const detail = nodes.find((node) => node.id === selected) ?? null;

  return (
    <div className="flex h-[calc(100vh-330px)] min-h-[360px] flex-col gap-2">
      {anatomy.error ? <ErrorNote message={anatomy.error} onRetry={anatomy.refresh} /> : null}
      <Panel padded={false} className="min-h-0 flex-1 overflow-hidden">
        <MapCanvas
          cards={cards}
          edges={edges}
          layout="tree"
          initialLevels={2}
          selectedId={selected}
          onSelect={setSelected}
          legend={[
            { label: "under 65%", tone: "ok" },
            { label: "65–85%", tone: "warn" },
            { label: "over 85%", tone: "bad" },
          ]}
          emptyMessage="No anatomy data for this target."
        />
      </Panel>
      {detail ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line/60 px-2.5 py-1.5">
          <span className={cn("font-mono text-[10px] uppercase tracking-[0.12em]", TONE_TEXT[detail.utilization !== null && detail.utilization > 85 ? "bad" : "info"])}>{detail.title}</span>
          <span className="font-mono text-[10px] text-slate-500">{detail.subtitle}</span>
          {detail.chips.map((chip, index) => (
            <Chip key={`${chip}-${index}`} tone="muted">
              {chip}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddTargetModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (body: { name: string; kind: string; url?: string }) => void }) {
  const [name, setName] = useState("checkout staging");
  const [kind, setKind] = useState("jolokia");
  const [url, setUrl] = useState("http://127.0.0.1:8778");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="add JVM target"
      footer={
        <div className="flex justify-end gap-1.5">
          <Button onClick={onClose}>cancel</Button>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              onSubmit({ name, kind, url: kind === "simulated" ? undefined : url });
              onClose();
            }}
            disabled={!name.trim()}
          >
            add
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Field label="name" required>
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="kind">
          <Select
            value={kind}
            onChange={setKind}
            options={[
              { value: "jolokia", label: "jolokia" },
              { value: "actuator", label: "spring actuator" },
              { value: "simulated", label: "simulated" },
            ]}
          />
        </Field>
        {kind !== "simulated" ? (
          <Field label="url" hint="base url — /jolokia or /actuator is appended automatically">
            <TextInput value={url} onChange={setUrl} />
          </Field>
        ) : (
          <Notice tone="info" icon="cpu">
            A simulated target needs no endpoint: the console generates a consistent, realistic VM under <span className="font-mono">globalThis</span>.
          </Notice>
        )}
      </div>
    </Modal>
  );
}
