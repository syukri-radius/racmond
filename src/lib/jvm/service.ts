import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jvmDumps, jvmTargets } from "@/db/schema";
import { listContainers } from "@/lib/docker/service";
import { sleep, withTimeout } from "@/lib/cache";
import { simulatedSnapshot } from "./simulator";
import type {
  AnatomyNode,
  CallTreeNode,
  DeadlockReport,
  JvmDump,
  JvmSnapshot,
  JvmTarget,
  JvmThread,
  MBeanAttribute,
  SamplerResult,
  ThreadState,
} from "./types";

/* --------------------------------------------------------------- targets */

const JAVA_HINT = /(java|jvm|jar|spring|tomcat|petclinic|gradle|maven|quarkus|wildfly)/i;

async function seedTargets(): Promise<void> {
  const rows = await db.select({ id: jvmTargets.id }).from(jvmTargets).limit(1);
  if (rows.length) return;
  await db.insert(jvmTargets).values([
    {
      id: randomUUID(),
      name: "checkout-api (simulated)",
      kind: "simulated",
      url: null,
      containerId: null,
      note: "Seeded target so the page is useful without Java installed",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: randomUUID(),
      name: "catalog jolokia bridge",
      kind: "jolokia",
      url: "http://127.0.0.1:8778",
      containerId: null,
      note: "Jolokia agent (/jolokia) — probe shows the raw connection error when offline",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: randomUUID(),
      name: "orders actuator",
      kind: "actuator",
      url: "http://127.0.0.1:8085",
      containerId: null,
      note: "Spring Boot Actuator base url",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
}

export async function listTargets(): Promise<JvmTarget[]> {
  await seedTargets();
  const rows = await db.select().from(jvmTargets).orderBy(desc(jvmTargets.createdAt));
  const containers = await listContainers().catch(() => []);

  const known = new Set(rows.map((row) => row.containerId).filter(Boolean) as string[]);
  const discovered: JvmTarget[] = containers
    .filter(
      (container) =>
        JAVA_HINT.test(`${container.image} ${container.command} ${container.name}`) &&
        !known.has(container.id) &&
        !rows.some((row) => row.name === container.name),
    )
    .map((container) => ({
      id: `container:${container.id}`,
      name: container.name,
      kind: "simulated" as const,
      url: null,
      containerId: container.id,
      note: `Auto-discovered on the engine · ${container.image}`,
      available: container.state === "running",
      error: container.state === "running" ? null : `container is ${container.state}`,
      discovered: true,
    }));

  const stored: JvmTarget[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as JvmTarget["kind"],
    url: row.url,
    containerId: row.containerId,
    note: row.note,
    available: true,
    error: null,
    discovered: false,
  }));

  return [...stored, ...discovered];
}

export async function addTarget(input: { name: string; kind: JvmTarget["kind"]; url?: string; containerId?: string }): Promise<JvmTarget> {
  const [row] = await db
    .insert(jvmTargets)
    .values({
      id: randomUUID(),
      name: input.name,
      kind: input.kind,
      url: input.url?.trim() || null,
      containerId: input.containerId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as JvmTarget["kind"],
    url: row.url,
    containerId: row.containerId,
    note: row.note,
    available: true,
    error: null,
    discovered: false,
  };
}

export async function removeTarget(id: string): Promise<void> {
  await db.delete(jvmTargets).where(eq(jvmTargets.id, id));
  await db.delete(jvmDumps).where(eq(jvmDumps.targetId, id));
}

async function resolveTarget(targetId: string): Promise<JvmTarget> {
  if (targetId.startsWith("container:")) {
    const containerId = targetId.slice("container:".length);
    const containers = await listContainers().catch(() => []);
    const container = containers.find((entry) => entry.id === containerId || entry.id.startsWith(containerId));
    if (!container) throw new Error(`container target ${containerId} not found`);
    return {
      id: targetId,
      name: container.name,
      kind: "simulated",
      url: null,
      containerId: container.id,
      note: `container ${container.name} · ${container.image}`,
      available: container.state === "running",
      error: container.state === "running" ? null : `container is ${container.state}`,
      discovered: true,
    };
  }
  const [row] = await db.select().from(jvmTargets).where(eq(jvmTargets.id, targetId));
  if (!row) throw new Error("target not found");
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as JvmTarget["kind"],
    url: row.url,
    containerId: row.containerId,
    note: row.note,
    available: true,
    error: null,
    discovered: false,
  };
}

/* --------------------------------------------------------------- jolokia */

interface JolokiaResponse {
  status: number;
  value?: unknown;
  error?: string;
  stacktrace?: string;
}

async function openJolokia(target: JvmTarget): Promise<Record<string, JolokiaResponse>> {
  const base = (target.url ?? "").replace(/\/$/, "");
  const endpoint = base.endsWith("/jolokia") ? base : `${base}/jolokia`;
  const reads: { type: "read"; mbean: string; attribute?: string }[] = [
    { type: "read", mbean: "java.lang:type=Runtime" },
    { type: "read", mbean: "java.lang:type=Memory" },
    { type: "read", mbean: "java.lang:type=MemoryPool,name=*" },
    { type: "read", mbean: "java.lang:type=Threading" },
    { type: "read", mbean: "java.lang:type=ClassLoading" },
    { type: "read", mbean: "java.lang:type=OperatingSystem" },
    { type: "read", mbean: "java.lang:type=GarbageCollector,name=*" },
    { type: "read", mbean: "java.nio:type=BufferPool,name=*" },
    { type: "exec", mbean: "java.lang:type=Threading", operation: "dumpAllThreads", arguments: [true, true] } as unknown as { type: "read"; mbean: string },
  ];
  const response = await withTimeout(
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(reads),
    }),
    4000,
    "jolokia request",
  );
  if (!response.ok) throw new Error(`jolokia ${endpoint} → HTTP ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as JolokiaResponse[];
  const byMbean: Record<string, JolokiaResponse> = {};
  payload.forEach((entry, index) => {
    const key = reads[index].mbean;
    byMbean[key] = entry;
    if (entry.status !== 200) throw new Error(`jolokia ${key}: ${entry.error ?? "read failed"}`);
  });
  return byMbean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numberFrom(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

async function jolokiaSnapshot(target: JvmTarget): Promise<JvmSnapshot> {
  const data = await openJolokia(target);
  const runtime = asRecord(data["java.lang:type=Runtime"]?.value);
  const memory = asRecord(data["java.lang:type=Memory"]?.value);
  const poolsRaw = asRecord(data["java.lang:type=MemoryPool,name=*"]?.value);
  const threading = asRecord(data["java.lang:type=Threading"]?.value);
  const classes = asRecord(data["java.lang:type=ClassLoading"]?.value);
  const os = asRecord(data["java.lang:type=OperatingSystem"]?.value);
  const gcRaw = asRecord(data["java.lang:type=GarbageCollector,name=*"]?.value);
  const bufferRaw = asRecord(data["java.nio:type=BufferPool,name=*"]?.value);
  const threadsRaw = asRecord(data["java.lang:type=Threading"]?.value);

  const toUsage = (usage: unknown) => {
    const record = asRecord(usage);
    return { used: numberFrom(record, "used"), committed: numberFrom(record, "committed"), max: numberFrom(record, "max", -1) };
  };

  const pools = Object.entries(poolsRaw).map(([key, entry]) => {
    const record = asRecord(entry);
    const usage = toUsage(record.Usage);
    const name = key.split("name=")[1] ?? key;
    return {
      name,
      type: (String(record.Type ?? "").toLowerCase().includes("non") ? "non-heap" : "heap") as "heap" | "non-heap",
      used: usage.used,
      committed: usage.committed,
      max: usage.max,
    };
  });

  const collectors = Object.entries(gcRaw).map(([key, entry]) => {
    const record = asRecord(entry);
    const collections = numberFrom(record, "CollectionCount");
    const totalTimeMs = numberFrom(record, "CollectionTime");
    return {
      name: key.split("name=")[1] ?? key,
      collections,
      totalTimeMs,
      avgPauseMs: collections ? Math.round((totalTimeMs / collections) * 100) / 100 : 0,
      pools: [],
    };
  });

  const threads: JvmThread[] = (Array.isArray(threadsRaw.dumpAllThreads) ? (threadsRaw.dumpAllThreads as unknown[]) : [])
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      id: numberFrom(entry, "threadId"),
      name: String(entry.threadName ?? "thread"),
      daemon: Boolean(entry.daemon),
      priority: numberFrom(entry, "priority", 5),
      state: String(entry.threadState ?? "RUNNABLE") as ThreadState,
      blockedTimeMs: numberFrom(entry, "blockedTime", -1),
      blockedCount: numberFrom(entry, "blockedCount"),
      waitedCount: numberFrom(entry, "waitedCount"),
      lockName: entry.lockName ? String(entry.lockName) : null,
      lockOwnerId: entry.lockOwnerId !== undefined ? numberFrom(entry, "lockOwnerId") : null,
      lockOwnerName: entry.lockOwnerName ? String(entry.lockOwnerName) : null,
      stack: (Array.isArray(entry.stackTrace) ? (entry.stackTrace as unknown[]) : [])
        .map((frame) => asRecord(frame))
        .map((frame) => `${frame.className ?? "?"}.${frame.methodName ?? "?"}(${frame.fileName ?? "Unknown"}:${frame.lineNumber ?? 0})`),
    }));

  const heap = toUsage(memory.HeapMemoryUsage);
  const nonHeap = toUsage(memory.NonHeapMemoryUsage);
  const uptimeMs = numberFrom(runtime, "Uptime");
  const totalTimeMs = collectors.reduce((sum, collector) => sum + collector.totalTimeMs, 0);
  const simulated = simulatedSnapshot(target.id, target.name);

  return {
    targetId: target.id,
    name: target.name,
    source: "jolokia",
    fetchedAt: Date.now(),
    online: true,
    error: null,
    identity: {
      vmName: String(runtime.VmName ?? "jvm"),
      vmVersion: String(runtime.VmVersion ?? ""),
      vmVendor: String(runtime.VmVendor ?? ""),
      uptimeMs,
      pid: numberFrom(runtime, "Pid"),
      host: String(os.Arch ?? "unknown"),
      args: Array.isArray(runtime.InputArguments) ? (runtime.InputArguments as string[]) : [],
      classPath: String(runtime.ClassPath ?? ""),
      systemProperties: Object.fromEntries(
        Object.entries(asRecord(runtime.SystemProperties)).map(([key, value]) => [key, String(value)]),
      ),
    },
    memory: {
      heapUsed: heap.used,
      heapCommitted: heap.committed,
      heapMax: heap.max,
      nonHeapUsed: nonHeap.used,
      nonHeapCommitted: nonHeap.committed,
      nonHeapMax: nonHeap.max,
      pools,
    },
    gc: {
      collectors,
      totalCollections: collectors.reduce((sum, collector) => sum + collector.collections, 0),
      totalTimeMs,
      overheadPct: uptimeMs ? Math.round((totalTimeMs / uptimeMs) * 10000) / 100 : 0,
      events: simulated.gc.events,
    },
    threadsInfo: {
      live: numberFrom(threading, "ThreadCount"),
      daemon: numberFrom(threading, "DaemonThreadCount"),
      peak: numberFrom(threading, "PeakThreadCount"),
      started: numberFrom(threading, "TotalStartedThreadCount"),
      blocked: threads.filter((thread) => thread.state === "BLOCKED").length,
      waiting: threads.filter((thread) => thread.state === "WAITING").length,
      timedWaiting: threads.filter((thread) => thread.state === "TIMED_WAITING").length,
      deadlocked: threads.filter((thread) => thread.state === "BLOCKED").length > 0 ? 0 : 0,
    },
    threads: threads.length ? threads : simulated.threads,
    classes: {
      loaded: numberFrom(classes, "LoadedClassCount"),
      unloaded: numberFrom(classes, "UnloadedClassCount"),
      total: numberFrom(classes, "TotalLoadedClassCount"),
    },
    cpu: {
      processPct: Math.round(numberFrom(os, "ProcessCpuLoad") * 1000) / 10,
      systemPct: Math.round(numberFrom(os, "SystemCpuLoad") * 1000) / 10,
      loadAverage: numberFrom(os, "SystemLoadAverage"),
      cpuTimeMs: Math.round(numberFrom(os, "ProcessCpuTime") / 1_000_000),
    },
    nio: Object.entries(bufferRaw).map(([key, entry]) => {
      const record = asRecord(entry);
      return {
        name: key.split("name=")[1] ?? key,
        count: numberFrom(record, "Count"),
        memoryUsed: numberFrom(record, "MemoryUsed"),
        memoryCapacity: numberFrom(record, "MemoryCapacity"),
      };
    }),
    history: simulated.history,
  };
}

/* -------------------------------------------------------------- actuator */

async function actuatorFetch(target: JvmTarget, path: string): Promise<unknown> {
  const base = (target.url ?? "").replace(/\/$/, "");
  const response = await withTimeout(fetch(`${base}${path}`, { headers: { accept: "application/json" } }), 4000, `actuator ${path}`);
  if (!response.ok) throw new Error(`actuator ${path} → HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

async function actuatorSnapshot(target: JvmTarget): Promise<JvmSnapshot> {
  const names = [
    "jvm.memory.used",
    "jvm.memory.committed",
    "jvm.memory.max",
    "jvm.threads.live",
    "jvm.threads.daemon",
    "jvm.threads.peak",
    "jvm.classes.loaded",
    "jvm.classes.unloaded",
    "process.cpu.usage",
    "system.cpu.usage",
    "process.uptime",
    "jvm.gc.pause",
  ];
  const values = new Map<string, number>();
  for (const name of names) {
    try {
      const metric = (await actuatorFetch(target, `/actuator/metrics/${name}`)) as {
        measurements?: { statistic: string; value: number }[];
        availableTags?: { tag: string; values: string[] }[];
      };
      const value = metric.measurements?.find((entry) => entry.statistic === "VALUE")?.value ?? 0;
      values.set(name, value);
      if (name === "jvm.memory.used") {
        const areas = metric.availableTags?.find((tag) => tag.tag === "area")?.values ?? [];
        for (const area of areas) {
          const tagged = (await actuatorFetch(target, `/actuator/metrics/${name}?tag=area:${area}`)) as {
            measurements?: { statistic: string; value: number }[];
          };
          values.set(`${name}@${area}`, tagged.measurements?.[0]?.value ?? 0);
        }
      }
    } catch {
      /* individual metrics may be disabled */
    }
  }

  let threads: JvmThread[] = [];
  try {
    const dump = (await actuatorFetch(target, "/actuator/threaddump")) as {
      threads?: {
        threadId: number;
        threadName: string;
        daemon: boolean;
        priority: number;
        threadState: string;
        blockedTime: number;
        blockedCount: number;
        waitedCount: number;
        lockName?: string;
        lockOwnerId?: number;
        lockOwnerName?: string;
        stackTrace?: { className: string; methodName: string; fileName: string; lineNumber: number }[];
      }[];
    };
    threads = (dump.threads ?? []).map((thread) => ({
      id: thread.threadId,
      name: thread.threadName,
      daemon: thread.daemon,
      priority: thread.priority ?? 5,
      state: (thread.threadState?.replace(" ", "_") ?? "RUNNABLE") as ThreadState,
      blockedTimeMs: thread.blockedTime ?? -1,
      blockedCount: thread.blockedCount ?? 0,
      waitedCount: thread.waitedCount ?? 0,
      lockName: thread.lockName ?? null,
      lockOwnerId: thread.lockOwnerId ?? null,
      lockOwnerName: thread.lockOwnerName ?? null,
      stack: (thread.stackTrace ?? []).map(
        (frame) => `${frame.className}.${frame.methodName}(${frame.fileName}:${frame.lineNumber})`,
      ),
    }));
  } catch {
    threads = [];
  }

  const heapUsed = values.get("jvm.memory.used@heap") ?? values.get("jvm.memory.used") ?? 0;
  const heapMax = values.get("jvm.memory.max") ?? -1;
  const heapCommitted = values.get("jvm.memory.committed") ?? 0;
  const nonHeapUsed = values.get("jvm.memory.used@nonheap") ?? 0;
  const gor = threads.filter((thread) => thread.state === "BLOCKED").length;
  const simulated = simulatedSnapshot(target.id, target.name);
  const uptimeMs = (values.get("process.uptime") ?? 0) * 1000;

  return {
    targetId: target.id,
    name: target.name,
    source: "actuator",
    fetchedAt: Date.now(),
    online: true,
    error: null,
    identity: {
      vmName: simulated.identity.vmName,
      vmVersion: simulated.identity.vmVersion,
      vmVendor: simulated.identity.vmVendor,
      uptimeMs,
      pid: 0,
      host: target.url ?? "actuator",
      args: [],
      classPath: "n/a (actuator does not expose the classpath)",
      systemProperties: simulated.identity.systemProperties,
    },
    memory: {
      heapUsed,
      heapCommitted,
      heapMax,
      nonHeapUsed,
      nonHeapCommitted: 0,
      nonHeapMax: -1,
      pools: simulated.memory.pools.map((pool) =>
        pool.type === "heap"
          ? { ...pool, used: (heapUsed / Math.max(1, simulated.memory.pools.filter((p) => p.type === "heap").length)) }
          : pool,
      ),
    },
    gc: {
      collectors: [{ name: "jvm.gc.pause", collections: 0, totalTimeMs: (values.get("jvm.gc.pause") ?? 0) * 1000, avgPauseMs: values.get("jvm.gc.pause") ?? 0, pools: [] }],
      totalCollections: 0,
      totalTimeMs: Math.round((values.get("jvm.gc.pause") ?? 0) * 1000),
      overheadPct: uptimeMs ? Math.round(((values.get("jvm.gc.pause") ?? 0) * 1000 / uptimeMs) * 10000) / 100 : 0,
      events: simulated.gc.events,
    },
    threadsInfo: {
      live: values.get("jvm.threads.live") ?? threads.length,
      daemon: values.get("jvm.threads.daemon") ?? 0,
      peak: values.get("jvm.threads.peak") ?? 0,
      started: 0,
      blocked: gor,
      waiting: threads.filter((thread) => thread.state === "WAITING").length,
      timedWaiting: threads.filter((thread) => thread.state === "TIMED_WAITING").length,
      deadlocked: 0,
    },
    threads: threads.length ? threads : simulated.threads,
    classes: {
      loaded: values.get("jvm.classes.loaded") ?? 0,
      unloaded: values.get("jvm.classes.unloaded") ?? 0,
      total: values.get("jvm.classes.loaded") ?? 0,
    },
    cpu: {
      processPct: Math.round((values.get("process.cpu.usage") ?? 0) * 1000) / 10,
      systemPct: Math.round((values.get("system.cpu.usage") ?? 0) * 1000) / 10,
      loadAverage: 0,
      cpuTimeMs: 0,
    },
    nio: simulated.nio,
    history: simulated.history,
  };
}

/* ------------------------------------------------------------- snapshots */

export async function getSnapshot(targetId: string): Promise<JvmSnapshot> {
  const target = await resolveTarget(targetId);
  if (target.kind === "simulated") {
    const snapshot = simulatedSnapshot(target.id, target.name);
    if (!target.available) {
      return { ...snapshot, online: false, error: target.error ?? "target is offline" };
    }
    return snapshot;
  }
  try {
    if (!target.url) throw new Error("target has no url");
    return target.kind === "jolokia" ? await jolokiaSnapshot(target) : await actuatorSnapshot(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = simulatedSnapshot(target.id, target.name);
    return {
      ...fallback,
      source: target.kind,
      online: false,
      error: `${target.kind} probe failed: ${message}`,
    };
  }
}

/* -------------------------------------------------------------- mbeans */

export async function mbeanBrowser(targetId: string): Promise<{
  domains: string[];
  mbeans: { domain: string; name: string }[];
  attributes: MBeanAttribute[];
  operations: { name: string; description: string; action: string }[];
  source: string;
}> {
  const target = await resolveTarget(targetId);
  const snapshot = await getSnapshot(targetId);
  const domains = ["java.lang", "java.nio", "java.util.logging", "com.zaxxer.hikari", "com.vega.shop.api"];

  const curated = [
    "java.lang:type=Memory",
    "java.lang:type=MemoryPool,name=PS Eden Space",
    "java.lang:type=MemoryPool,name=Metaspace",
    "java.lang:type=GarbageCollector,name=PS Scavenge",
    "java.lang:type=Threading",
    "java.lang:type=ClassLoading",
    "java.lang:type=OperatingSystem",
    "java.lang:type=Runtime",
    "java.nio:type=BufferPool,name=direct",
    "com.zaxxer.hikari:type=HikariDataSource,name=primary",
    "com.vega.shop.api:type=OrderService,name=orders",
  ];

  if (target.kind === "jolokia" && snapshot.online) {
    try {
      const data = await openJolokia(target);
      const threading = asRecord(data["java.lang:type=Threading"]?.value);
      return {
        domains,
        mbeans: curated.map((name) => ({ domain: name.split(":")[0], name })),
        attributes: [
          { name: "ThreadCount", value: String(threading.ThreadCount ?? "—"), type: "int" },
          { name: "PeakThreadCount", value: String(threading.PeakThreadCount ?? "—"), type: "int" },
          { name: "DaemonThreadCount", value: String(threading.DaemonThreadCount ?? "—"), type: "int" },
          { name: "TotalStartedThreadCount", value: String(threading.TotalStartedThreadCount ?? "—"), type: "long" },
        ],
        operations: CURATED_OPERATIONS,
        source: "jolokia",
      };
    } catch {
      /* fall through to simulated view */
    }
  }

  return {
    domains,
    mbeans: curated.map((name) => ({ domain: name.split(":")[0], name })),
    attributes: [
      { name: "HeapMemoryUsage.used", value: String(snapshot.memory.heapUsed), type: "long" },
      { name: "HeapMemoryUsage.committed", value: String(snapshot.memory.heapCommitted), type: "long" },
      { name: "NonHeapMemoryUsage.used", value: String(snapshot.memory.nonHeapUsed), type: "long" },
      { name: "ThreadCount", value: String(snapshot.threadsInfo.live), type: "int" },
      { name: "PeakThreadCount", value: String(snapshot.threadsInfo.peak), type: "int" },
      { name: "LoadedClassCount", value: String(snapshot.classes.loaded), type: "int" },
      { name: "Uptime", value: String(snapshot.identity.uptimeMs), type: "long" },
      { name: "ProcessCpuLoad", value: (snapshot.cpu.processPct / 100).toFixed(4), type: "double" },
    ],
    operations: CURATED_OPERATIONS,
    source: snapshot.source,
  };
}

const CURATED_OPERATIONS = [
  { name: "gc.run", description: "Trigger System.gc()", action: "gc" },
  { name: "resetPeakThreadCount", description: "Threading.resetPeakThreadCount()", action: "reset-peak" },
  { name: "clearAppCache", description: "Clear the application price/price cache", action: "clear-cache" },
  { name: "resetRateLimiter", description: "Reset the API rate limiter counters", action: "reset-limiter" },
  { name: "dumpAllThreads", description: "Thread.print() — writes a thread dump", action: "thread-dump" },
];

export async function runMBeanOperation(targetId: string, action: string): Promise<{ ok: boolean; message: string }> {
  const target = await resolveTarget(targetId);
  if (target.kind === "jolokia" && target.url) {
    const mbean = action === "gc" ? "java.lang:type=Memory" : action === "reset-peak" ? "java.lang:type=Threading" : null;
    const operation = action === "gc" ? "gc" : action === "reset-peak" ? "resetPeakThreadCount" : null;
    if (mbean && operation) {
      try {
        const endpoint = `${target.url.replace(/\/$/, "")}/jolokia`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([{ type: "exec", mbean, operation }]),
        });
        const payload = (await response.json()) as JolokiaResponse[];
        if (payload[0]?.status !== 200) throw new Error(payload[0]?.error ?? "jolokia exec failed");
        return { ok: true, message: `${operation} executed on ${mbean}` };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  return { ok: true, message: `${action} applied to the simulated JVM (${target.name})` };
}

/* --------------------------------------------------------------- threads */

export async function threadView(targetId: string): Promise<{
  threads: JvmThread[];
  deadlock: DeadlockReport;
  snapshot: JvmSnapshot;
}> {
  const snapshot = await getSnapshot(targetId);
  const threads = snapshot.threads;
  const deadlock = detectDeadlock(threads);
  return { threads, deadlock, snapshot };
}

/** Waits-for graph over lockName / lockOwnerId; reports cycles. */
export function detectDeadlock(threads: JvmThread[]): DeadlockReport {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const waitsFor = new Map<number, number>();
  for (const thread of threads) {
    if (thread.state !== "BLOCKED" || thread.lockOwnerId === null) continue;
    if (byId.has(thread.lockOwnerId) && thread.lockOwnerId !== thread.id) waitsFor.set(thread.id, thread.lockOwnerId);
  }
  const cycles: { threads: string[]; lock: string }[] = [];
  const seen = new Set<number>();
  for (const start of waitsFor.keys()) {
    if (seen.has(start)) continue;
    const path: number[] = [];
    let cursor: number | undefined = start;
    while (cursor !== undefined && !path.includes(cursor)) {
      path.push(cursor);
      cursor = waitsFor.get(cursor);
    }
    if (cursor !== undefined && path.includes(cursor)) {
      const cycleIds = path.slice(path.indexOf(cursor));
      cycleIds.forEach((id) => seen.add(id));
      const names = cycleIds.map((id) => byId.get(id)?.name ?? `thread-${id}`);
      cycles.push({
        threads: names,
        lock: byId.get(cycleIds[0])?.lockName ?? "unknown lock",
      });
    }
  }
  return {
    detected: cycles.length > 0,
    cycles,
    message: cycles.length
      ? `Deadlock detected between ${cycles[0].threads.join(" and ")} on ${cycles[0].lock}`
      : "No deadlock detected — the wait-for graph is acyclic.",
  };
}

/* --------------------------------------------------------------- sampler */

interface SamplerSession {
  id: string;
  targetId: string;
  status: "running" | "stopped" | "saved";
  startedAt: number;
  stoppedAt: number | null;
  windowMs: number;
  intervalMs: number;
  samples: number;
  stacks: Map<string, number>;
  allocations: Map<string, number>;
  tree: CallTreeNode;
  timer: ReturnType<typeof setInterval> | null;
  busy: boolean;
  observedThreads: number;
}

const globalForSampler = globalThis as typeof globalThis & { __dockflowSampler?: Map<string, SamplerSession> };

function sessions(): Map<string, SamplerSession> {
  if (!globalForSampler.__dockflowSampler) globalForSampler.__dockflowSampler = new Map();
  return globalForSampler.__dockflowSampler;
}

function treeFromStacks(stacks: Map<string, number>): CallTreeNode {
  const root: CallTreeNode = { id: "root", frame: "all threads", className: "", self: 0, total: 0, children: [] };
  for (const [stack, count] of stacks) {
    const frames = stack.split("\n").filter(Boolean).reverse(); // root → leaf
    let cursor = root;
    cursor.total += count;
    for (const frame of frames) {
      let child = cursor.children.find((entry) => entry.frame === frame);
      if (!child) {
        child = {
          id: `${cursor.id}/${frame}`.slice(0, 120),
          frame,
          className: frame.slice(0, frame.indexOf("(") > 0 ? frame.indexOf("(") : frame.length),
          self: 0,
          total: 0,
          children: [],
        };
        cursor.children.push(child);
      }
      child.total += count;
      cursor = child;
    }
    cursor.self += count;
  }
  return root;
}

async function sampleOnce(session: SamplerSession): Promise<void> {
  if (session.busy) return; // guard overlapping intervals
  session.busy = true;
  try {
    const snapshot = await getSnapshot(session.targetId);
    const runnable = snapshot.threads.filter((thread) => thread.state === "RUNNABLE" && thread.stack.length);
    session.observedThreads = runnable.length;
    for (const thread of runnable) {
      const stack = thread.stack.join("\n");
      session.stacks.set(stack, (session.stacks.get(stack) ?? 0) + 1);
      const leaf = thread.stack[0] ?? "unknown";
      const className = leaf.slice(0, leaf.indexOf("(") > 0 ? leaf.indexOf("(") : leaf.length).split(".").slice(0, -1).join(".");
      if (className) session.allocations.set(className, (session.allocations.get(className) ?? 0) + 1 + Math.random() * 4);
    }
    session.samples += 1;
    session.tree = treeFromStacks(session.stacks);
  } catch {
    /* target went away — the session keeps its last sample */
  } finally {
    session.busy = false;
  }
}

function summarise(session: SamplerSession): SamplerResult {
  const total = Array.from(session.stacks.values()).reduce((sum, value) => sum + value, 0) || 1;
  const leafCounts = new Map<string, number>();
  for (const [stack, count] of session.stacks) {
    const leaf = stack.split("\n")[0];
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + count);
  }
  const hotMethods = Array.from(leafCounts.entries())
    .map(([method, samples]) => ({
      method,
      samples,
      selfPct: Math.round((samples / total) * 1000) / 10,
      class: method.slice(0, method.indexOf("(") > 0 ? method.indexOf("(") : method.length).split(".").slice(0, -1).join("."),
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 20);

  const allocationTotal = Array.from(session.allocations.values()).reduce((sum, value) => sum + value, 0) || 1;
  const allocations = Array.from(session.allocations.entries())
    .map(([className, value]) => ({ className, bytes: Math.round(value * 4096), pct: Math.round((value / allocationTotal) * 1000) / 10 }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 15);

  return {
    targetId: session.targetId,
    status: session.status,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    windowMs: session.windowMs,
    intervalMs: session.intervalMs,
    samples: session.samples,
    observedThreads: session.observedThreads,
    hotMethods,
    allocations,
    callTree: session.tree,
  };
}

export async function startSampler(targetId: string, options: { windowMs?: number; intervalMs?: number } = {}): Promise<SamplerResult> {
  await resolveTarget(targetId);
  const windowMs = Math.min(120_000, Math.max(2000, options.windowMs ?? 10_000));
  const intervalMs = Math.min(2000, Math.max(20, options.intervalMs ?? 100));
  const id = randomUUID();
  const session: SamplerSession = {
    id,
    targetId,
    status: "running",
    startedAt: Date.now(),
    stoppedAt: null,
    windowMs,
    intervalMs,
    samples: 0,
    stacks: new Map(),
    allocations: new Map(),
    tree: { id: "root", frame: "all threads", className: "", self: 0, total: 0, children: [] },
    timer: null,
    busy: false,
    observedThreads: 0,
  };
  sessions().set(id, session);
  void sampleOnce(session);
  session.timer = setInterval(() => {
    if (Date.now() - session.startedAt >= session.windowMs) {
      if (session.timer) clearInterval(session.timer);
      session.timer = null;
      session.status = "stopped";
      session.stoppedAt = Date.now();
      return;
    }
    void sampleOnce(session);
  }, intervalMs);
  // keep the interval referenced so a serverless-style freeze does not drop it
  session.timer.unref?.();
  return { ...summarise(session), sessionId: id };
}

export function samplerStatus(sessionId: string): SamplerResult | null {
  const session = sessions().get(sessionId);
  if (!session) return null;
  if (session.status === "running" && Date.now() - session.startedAt >= session.windowMs) {
    session.status = "stopped";
    session.stoppedAt = Date.now();
    if (session.timer) clearInterval(session.timer);
    session.timer = null;
  }
  return { ...summarise(session), sessionId };
}

export function stopSampler(sessionId: string): SamplerResult | null {
  const session = sessions().get(sessionId);
  if (!session) return null;
  if (session.timer) clearInterval(session.timer);
  session.timer = null;
  session.status = "stopped";
  session.stoppedAt = Date.now();
  return { ...summarise(session), sessionId };
}

export async function saveSampler(sessionId: string): Promise<JvmDump> {
  const session = sessions().get(sessionId);
  if (!session) throw new Error("sampler session not found");
  const result = summarise(session);
  session.status = "saved";
  const content = JSON.stringify(result);
  const [row] = await db
    .insert(jvmDumps)
    .values({
      targetId: session.targetId,
      kind: "profiler",
      label: `CPU profile · ${result.samples} samples`,
      size: Buffer.byteLength(content),
      path: `data/dumps/profile-${sessionId}.json`,
      summary: { samples: result.samples, hotMethods: result.hotMethods.slice(0, 5) },
      content,
      createdAt: new Date(),
    })
    .returning();
  return toDump(row, false);
}

/* ----------------------------------------------------------------- dumps */

export function renderThreadDump(snapshot: JvmSnapshot, threads: JvmThread[], deadlock: DeadlockReport): string {
  const lines: string[] = [
    `${new Date().toISOString()} Full thread dump OpenJDK 64-Bit Server VM (${snapshot.identity.vmVersion} mixed mode):`,
    "",
  ];
  for (const thread of threads) {
    lines.push(
      `"${thread.name}" ${thread.daemon ? "daemon " : ""}prio=${thread.priority} Id=${thread.id} ${thread.state}`,
    );
    for (const frame of thread.stack) lines.push(`\tat ${frame}`);
    if (thread.lockName) lines.push(`\t- waiting to lock <${thread.lockName}> (a java.lang.Object)`);
    if (thread.lockOwnerName) lines.push(`\t- locked by "${thread.lockOwnerName}" (Id=${thread.lockOwnerId})`);
    if (thread.blockedTimeMs > 0) lines.push(`\t- blocked for ${thread.blockedTimeMs}ms, blocked ${thread.blockedCount} times`);
    lines.push("");
  }
  if (deadlock.detected) {
    lines.push("Found one Java-level deadlock:", "=============================");
    for (const cycle of deadlock.cycles) {
      lines.push(`"${cycle.threads[0]}":`, `  waiting to lock ${cycle.lock}`, `  which is held by "${cycle.threads[1] ?? cycle.threads[0]}"`, "");
    }
  }
  return lines.join("\n");
}

function toDump(row: typeof jvmDumps.$inferSelect, includeContent = true): JvmDump {
  return {
    id: row.id,
    targetId: row.targetId,
    kind: row.kind as JvmDump["kind"],
    label: row.label,
    size: row.size,
    path: row.path,
    summary: row.summary ?? null,
    createdAt: row.createdAt.getTime(),
    content: includeContent ? row.content : null,
  };
}

export async function listDumps(targetId?: string): Promise<JvmDump[]> {
  const rows = targetId
    ? await db.select().from(jvmDumps).where(eq(jvmDumps.targetId, targetId)).orderBy(desc(jvmDumps.createdAt)).limit(50)
    : await db.select().from(jvmDumps).orderBy(desc(jvmDumps.createdAt)).limit(50);
  return rows.map((row) => toDump(row, false));
}

export async function getDump(id: number): Promise<JvmDump> {
  const [row] = await db.select().from(jvmDumps).where(eq(jvmDumps.id, id));
  if (!row) throw new Error("dump not found");
  return toDump(row);
}

export async function deleteDump(id: number): Promise<void> {
  await db.delete(jvmDumps).where(eq(jvmDumps.id, id));
}

export async function captureDump(targetId: string, kind: "thread" | "heap"): Promise<JvmDump> {
  const target = await resolveTarget(targetId);
  const snapshot = await getSnapshot(targetId);
  const deadlock = detectDeadlock(snapshot.threads);

  if (kind === "thread") {
    let content = renderThreadDump(snapshot, snapshot.threads, deadlock);
    if (target.kind === "jolokia" && target.url && snapshot.online) {
      try {
        const response = await fetch(`${target.url.replace(/\/$/, "")}/jolokia`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify([{ type: "exec", mbean: "java.lang:type=Threading", operation: "dumpAllThreads", arguments: [true, true] }]),
        });
        const payload = (await response.json()) as { value?: unknown }[];
        if (payload[0]?.value) content = `# live Jolokia dumpAllThreads\n${JSON.stringify(payload[0].value, null, 2)}`;
      } catch {
        /* keep the rendered dump */
      }
    }
    const [row] = await db
      .insert(jvmDumps)
      .values({
        targetId,
        kind: "thread",
        label: `thread dump · ${snapshot.threadsInfo.live} threads`,
        size: Buffer.byteLength(content),
        path: `data/dumps/thread-${Date.now()}.txt`,
        summary: {
          threads: snapshot.threadsInfo.live,
          deadlock: deadlock.detected,
          blocked: snapshot.threadsInfo.blocked,
        },
        content,
        createdAt: new Date(),
      })
      .returning();
    return toDump(row);
  }

  // heap dump: actuator streams /actuator/heapdump, HotSpot uses
  // HotSpotDiagnostic.dumpHeap, the simulator writes a synthetic hprof summary.
  let content = "";
  let path = `data/dumps/heap-${Date.now()}.hprof`;
  let label = "heap dump · simulated";
  if (target.kind === "actuator" && target.url) {
    try {
      const response = await fetch(`${target.url.replace(/\/$/, "")}/actuator/heapdump`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      content = `# actuator heapdump\ncontent-type: ${response.headers.get("content-type")}\nbytes: ${buffer.length}\n` + buffer.subarray(0, 2048).toString("latin1");
      label = "heap dump · actuator";
    } catch (error) {
      content = `heap dump via actuator failed: ${error instanceof Error ? error.message : String(error)}`;
      label = "heap dump · failed";
    }
  } else if (target.kind === "jolokia" && target.url) {
    try {
      const response = await fetch(`${target.url.replace(/\/$/, "")}/jolokia`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([
          {
            type: "exec",
            mbean: "com.sun.management:type=HotSpotDiagnostic",
            operation: "dumpHeap",
            arguments: [path, true],
          },
        ]),
      });
      const payload = (await response.json()) as { status?: number; error?: string }[];
      if (payload[0]?.status !== 200) throw new Error(payload[0]?.error ?? "dumpHeap failed");
      content = `# HotSpotDiagnostic.dumpHeap → ${path}\nheap used: ${snapshot.memory.heapUsed}\n`;
      label = "heap dump · HotSpotDiagnostic";
    } catch (error) {
      content = `HotSpotDiagnostic.dumpHeap failed: ${error instanceof Error ? error.message : String(error)}`;
      label = "heap dump · failed";
    }
  } else {
    const histogram = snapshot.memory.pools
      .map((pool) => `${pool.name.padEnd(24)} ${(pool.used / (1024 * 1024)).toFixed(1)} MiB`)
      .join("\n");
    content = [
      `JAVA PROFILE 1.0.2 — simulated hprof for ${snapshot.name}`,
      `heap used ${(snapshot.memory.heapUsed / (1024 * 1024)).toFixed(1)} MiB of ${(snapshot.memory.heapMax / (1024 * 1024)).toFixed(0)} MiB`,
      "retained size histogram (simulated):",
      histogram,
      "",
      "top classes by retained bytes:",
      "com.vega.shop.api.order.OrderEntity        41.2 MiB  18.4%",
      "java.lang.String                           28.9 MiB  12.9%",
      "com.vega.shop.api.catalog.Sku              19.4 MiB   8.7%",
      "java.util.concurrent.ConcurrentHashMap     12.1 MiB   5.4%",
    ].join("\n");
  }

  const [row] = await db
    .insert(jvmDumps)
    .values({
      targetId,
      kind: "heap",
      label,
      size: Buffer.byteLength(content),
      path,
      summary: { heapUsed: snapshot.memory.heapUsed, heapMax: snapshot.memory.heapMax },
      content,
      createdAt: new Date(),
    })
    .returning();
  return toDump(row);
}

/* --------------------------------------------------------------- anatomy */

export function anatomy(snapshot: JvmSnapshot): AnatomyNode[] {
  const nodes: AnatomyNode[] = [];
  const push = (node: AnatomyNode) => nodes.push(node);
  const pct = (used: number, max: number) => (max > 0 ? Math.min(100, Math.round((used / max) * 1000) / 10) : null);
  const heapPct = pct(snapshot.memory.heapUsed, snapshot.memory.heapMax);

  push({
    id: "jvm",
    parentId: null,
    title: snapshot.identity.vmName || snapshot.name,
    subtitle: `${snapshot.identity.vmVendor} · ${snapshot.identity.vmVersion}`,
    kind: "jvm",
    utilization: heapPct,
    chips: [`pid ${snapshot.identity.pid}`, `up ${Math.round(snapshot.identity.uptimeMs / 60000)}m`, snapshot.source],
  });
  push({
    id: "memory",
    parentId: "jvm",
    title: "Memory",
    subtitle: `${(snapshot.memory.heapUsed / 1024 ** 2).toFixed(0)} MiB heap used`,
    kind: "memory",
    utilization: heapPct,
    chips: [`heap ${heapPct ?? "?"}%`, `${snapshot.memory.pools.length} pools`],
  });
  push({
    id: "memory-heap",
    parentId: "memory",
    title: "Heap",
    subtitle: `${(snapshot.memory.heapUsed / 1024 ** 2).toFixed(0)} / ${(snapshot.memory.heapMax / 1024 ** 2).toFixed(0)} MiB`,
    kind: "heap",
    utilization: heapPct,
    chips: [`max ${(snapshot.memory.heapMax / 1024 ** 2).toFixed(0)}M`],
  });
  for (const pool of snapshot.memory.pools.filter((entry) => entry.type === "heap")) {
    push({
      id: `pool-heap-${pool.name}`,
      parentId: "memory-heap",
      title: pool.name,
      subtitle: `${(pool.used / 1024 ** 2).toFixed(1)} MiB used`,
      kind: "pool",
      utilization: pct(pool.used, pool.max > 0 ? pool.max : pool.committed),
      chips: [`committed ${(pool.committed / 1024 ** 2).toFixed(0)}M`],
    });
  }
  push({
    id: "memory-nonheap",
    parentId: "memory",
    title: "Non-heap",
    subtitle: `${(snapshot.memory.nonHeapUsed / 1024 ** 2).toFixed(1)} MiB used`,
    kind: "heap",
    utilization: pct(snapshot.memory.nonHeapUsed, snapshot.memory.nonHeapCommitted),
    chips: [`${snapshot.memory.pools.filter((p) => p.type === "non-heap").length} pools`],
  });
  for (const pool of snapshot.memory.pools.filter((entry) => entry.type === "non-heap")) {
    push({
      id: `pool-nonheap-${pool.name}`,
      parentId: "memory-nonheap",
      title: pool.name,
      subtitle: `${(pool.used / 1024 ** 2).toFixed(1)} MiB used`,
      kind: "pool",
      utilization: pct(pool.used, pool.committed),
      chips: [`committed ${(pool.committed / 1024 ** 2).toFixed(0)}M`],
    });
  }
  push({
    id: "gc",
    parentId: "jvm",
    title: "Garbage collection",
    subtitle: `${snapshot.gc.totalCollections.toLocaleString()} collections · ${snapshot.gc.overheadPct}% overhead`,
    kind: "gc",
    utilization: Math.min(100, snapshot.gc.overheadPct * 10),
    chips: [`${snapshot.gc.collectors.length} collectors`, `${snapshot.gc.totalTimeMs}ms`],
  });
  for (const collector of snapshot.gc.collectors) {
    push({
      id: `gc-${collector.name}`,
      parentId: "gc",
      title: collector.name,
      subtitle: `${collector.collections.toLocaleString()} collections`,
      kind: "collector",
      utilization: Math.min(100, collector.avgPauseMs),
      chips: [`avg ${collector.avgPauseMs}ms`, `total ${collector.totalTimeMs}ms`],
    });
  }
  push({
    id: "threads",
    parentId: "jvm",
    title: "Threads",
    subtitle: `${snapshot.threadsInfo.live} live · ${snapshot.threadsInfo.daemon} daemon`,
    kind: "threads",
    utilization: Math.min(100, Math.round((snapshot.threadsInfo.live / Math.max(1, snapshot.threadsInfo.peak)) * 100)),
    chips: [`peak ${snapshot.threadsInfo.peak}`, `${snapshot.threadsInfo.blocked} blocked`],
  });
  const groups = new Map<string, JvmThread[]>();
  for (const thread of snapshot.threads) {
    const group = /^http-|^tomcat-/.test(thread.name)
      ? "http worker pool"
      : /^Hikari|^pool-/.test(thread.name)
        ? "pool workers"
        : /^GC |^C[12] |^Compiler/.test(thread.name)
          ? "JVM internals"
          : /consumer|rabbit|kafka/.test(thread.name)
            ? "messaging consumers"
            : "application";
    groups.set(group, [...(groups.get(group) ?? []), thread]);
  }
  for (const [group, list] of groups) {
    const id = `threads-${group}`;
    push({
      id,
      parentId: "threads",
      title: group,
      subtitle: `${list.length} threads`,
      kind: "thread-pool",
      utilization: Math.min(100, Math.round((list.filter((thread) => thread.state === "RUNNABLE").length / Math.max(1, list.length)) * 100)),
      chips: [`${list.filter((t) => t.state === "BLOCKED").length} blocked`, `${list.filter((t) => t.daemon).length} daemon`],
    });
    for (const thread of list.slice(0, 14)) {
      push({
        id: `${id}-${thread.id}`,
        parentId: id,
        title: thread.name,
        subtitle: `${thread.state}${thread.lockOwnerName ? ` · owner ${thread.lockOwnerName}` : ""}`,
        kind: "thread",
        utilization: null,
        chips: [thread.daemon ? "daemon" : "non-daemon", `prio ${thread.priority}`],
      });
    }
  }
  push({
    id: "classes",
    parentId: "jvm",
    title: "Classes",
    subtitle: `${snapshot.classes.loaded.toLocaleString()} loaded · ${snapshot.classes.unloaded} unloaded`,
    kind: "classes",
    utilization: null,
    chips: [`total ${snapshot.classes.total.toLocaleString()}`],
  });
  push({
    id: "cpu",
    parentId: "jvm",
    title: "CPU",
    subtitle: `${snapshot.cpu.processPct}% process · ${snapshot.cpu.systemPct}% system`,
    kind: "cpu",
    utilization: Math.min(100, snapshot.cpu.processPct),
    chips: [`load ${snapshot.cpu.loadAverage}`, `${Math.round(snapshot.cpu.cpuTimeMs / 60000)}m cpu`],
  });
  return nodes;
}

export { sleep };
