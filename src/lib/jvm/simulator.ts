import type { GcEvent, JvmSnapshot, JvmThread, MemoryPool, ThreadState } from "./types";

/**
 * Simulated JVM — used when no Jolokia bridge or Actuator endpoint answers and
 * for containers auto-discovered on the engine. State lives on globalThis so it
 * survives module re-evaluation; history is a 90-point ring.
 */

interface SimThread {
  id: number;
  name: string;
  daemon: boolean;
  priority: number;
  state: ThreadState;
  frames: string[];
  blockedTimeMs: number;
  blockedCount: number;
  waitedCount: number;
  lockName: string | null;
  lockOwnerId: number | null;
  lockOwnerName: string | null;
}

interface SimState {
  startedAt: number;
  pid: number;
  vmName: string;
  heapMax: number;
  pools: MemoryPool[];
  collectors: { name: string; collections: number; totalTimeMs: number; pools: string[] }[];
  events: GcEvent[];
  history: { at: number; heap: number; nonHeap: number; cpu: number; threads: number }[];
  threads: SimThread[];
  peakThreads: number;
  startedThreads: number;
  classesLoaded: number;
  classesUnloaded: number;
  cpuTimeMs: number;
  tick: number;
}

const MB = 1024 * 1024;
const globalForJvm = globalThis as typeof globalThis & { __dockflowJvm?: Map<string, SimState> };

const POOL_NAMES: { name: string; type: "heap" | "non-heap"; share: number; collector: string }[] = [
  { name: "PS Eden Space", type: "heap", share: 0.35, collector: "PS Scavenge" },
  { name: "PS Survivor Space", type: "heap", share: 0.06, collector: "PS Scavenge" },
  { name: "PS Old Gen", type: "heap", share: 0.55, collector: "PS MarkSweep" },
  { name: "Metaspace", type: "non-heap", share: 0.62, collector: "PS MarkSweep" },
  { name: "Compressed Class Space", type: "non-heap", share: 0.14, collector: "PS MarkSweep" },
  { name: "Code Cache", type: "non-heap", share: 0.24, collector: "none" },
];

const THREAD_TEMPLATES: { name: string; daemon: boolean; state: ThreadState; frames: string[] }[] = [
  { name: "main", daemon: false, state: "RUNNABLE", frames: ["com.vega.shop.api.ShopApplication.main(ShopApplication.java:24)"] },
  { name: "Reference Handler", daemon: true, state: "RUNNABLE", frames: ["java.lang.ref.Reference.waitForReferencePendingList(Reference.java:1979)", "java.lang.ref.Reference.processPendingReferences(Reference.java:241)"] },
  { name: "Finalizer", daemon: true, state: "WAITING", frames: ["java.lang.Object.wait(Object.java:339)", "java.lang.ref.ReferenceQueue.remove(ReferenceQueue.java:155)"] },
  { name: "Signal Dispatcher", daemon: true, state: "RUNNABLE", frames: ["jdk.internal.misc.Signal.dispatch(Signal.java:0)"] },
  { name: "Common-Cleaner", daemon: true, state: "TIMED_WAITING", frames: ["java.lang.Object.wait(Object.java:339)", "jdk.internal.ref.CleanerImpl.run(CleanerImpl.java:146)"] },
  { name: "http-nio-8080-exec-1", daemon: true, state: "RUNNABLE", frames: ["java.net.SocketDispatcher.read0(SocketDispatcher.java:43)", "org.apache.tomcat.util.net.NioEndpoint$NioSocketWrapper.read(NioEndpoint.java:1103)", "com.vega.shop.api.order.OrderService.reserve(OrderService.java:184)", "com.vega.shop.api.web.OrderController.create(OrderController.java:71)"] },
  { name: "http-nio-8080-exec-2", daemon: true, state: "BLOCKED", frames: ["com.vega.shop.api.inventory.InventoryRepository.lockRow(InventoryRepository.java:92)", "com.vega.shop.api.order.OrderService.reserve(OrderService.java:191)"] },
  { name: "http-nio-8080-exec-3", daemon: true, state: "TIMED_WAITING", frames: ["java.lang.Object.wait(Object.java:339)", "org.apache.tomcat.util.threads.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1101)"] },
  { name: "HikariPool-1 housekeeper", daemon: true, state: "TIMED_WAITING", frames: ["java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.awaitNanos(AbstractQueuedSynchronizer.java:1740)", "com.zaxxer.hikari.pool.HikariPool.houseKeeperTask(HikariPool.java:1495)"] },
  { name: "HikariPool-1 connection adder", daemon: true, state: "WAITING", frames: ["java.util.concurrent.locks.LockSupport.park(LockSupport.java:371)", "com.zaxxer.hikari.util.DriverDataSource.getConnection(DriverDataSource.java:128)"] },
  { name: "lettuce-nioEventLoop-4-1", daemon: true, state: "RUNNABLE", frames: ["io.netty.channel.nio.NioEventLoop.select(NioEventLoop.java:908)", "io.netty.channel.nio.NioEventLoop.run(NioEventLoop.java:568)"] },
  { name: "rabbitmq-consumer-orders", daemon: true, state: "WAITING", frames: ["java.util.concurrent.LinkedBlockingQueue.take(LinkedBlockingQueue.java:440)", "com.vega.shop.api.queue.OrderConsumer.run(OrderConsumer.java:63)"] },
  { name: "scheduling-1", daemon: true, state: "TIMED_WAITING", frames: ["java.lang.Thread.sleep(Native Method)", "org.springframework.scheduling.support.TaskUtils$LoggingErrorHandler.handleError(TaskUtils.java:95)"] },
  { name: "GC Thread#0", daemon: true, state: "RUNNABLE", frames: ["jdk.internal.misc.Unsafe.park(Unsafe.java:0)"] },
  { name: "C2 CompilerThread0", daemon: true, state: "RUNNABLE", frames: ["com.sun.tools.javac.comp.Compile.run(Compiler.java:0)"] },
  { name: "destroyJavaVM", daemon: false, state: "WAITING", frames: ["java.lang.Thread.join(Thread.java:1300)"] },
  { name: "pool-3-thread-1", daemon: true, state: "BLOCKED", frames: ["com.vega.shop.api.pricing.PriceCache.refresh(PriceCache.java:141)"] },
  { name: "otel-exporter-thread", daemon: true, state: "TIMED_WAITING", frames: ["java.lang.Object.wait(Object.java:339)", "io.opentelemetry.exporter.internal.grpc.GrpcExporter.run(GrpcExporter.java:167)"] },
];

function seed(name: string): SimState {
  const pools: MemoryPool[] = POOL_NAMES.map((pool) => {
    const max = pool.type === "heap" ? 512 * MB * pool.share : 256 * MB * pool.share;
    const used = max * (0.3 + Math.random() * 0.35);
    return { name: pool.name, type: pool.type, used, committed: max * 0.92, max: pool.type === "heap" ? 512 * MB * pool.share : -1 };
  });
  const threads: SimThread[] = THREAD_TEMPLATES.map((template, index) => ({
    id: 20 + index,
    name: template.name,
    daemon: template.daemon,
    priority: 5,
    state: template.state,
    frames: template.frames,
    blockedTimeMs: template.state === "BLOCKED" ? 120 + index * 33 : -1,
    blockedCount: template.state === "BLOCKED" ? 4 + index : 0,
    waitedCount: template.state === "WAITING" || template.state === "TIMED_WAITING" ? 12 + index * 7 : 0,
    lockName:
      template.state === "BLOCKED"
        ? "com.vega.shop.api.inventory.InventoryRepository@6f1c2a"
        : template.name === "main"
          ? "java.lang.Object@1b6d3586"
          : null,
    lockOwnerId: template.state === "BLOCKED" ? 26 : null,
    lockOwnerName: template.state === "BLOCKED" ? "http-nio-8080-exec-1" : null,
  }));

  return {
    startedAt: Date.now() - 1000 * 60 * 60 * 7 - Math.floor(Math.random() * 1000 * 60 * 60 * 20),
    pid: 1 + Math.floor(Math.random() * 4000),
    vmName: `vega-${name.replace(/[^a-z0-9]+/gi, "-")}`,
    heapMax: 512 * MB,
    pools,
    collectors: [
      { name: "PS Scavenge", collections: 21_842, totalTimeMs: 13_401, pools: ["PS Eden Space", "PS Survivor Space"] },
      { name: "PS MarkSweep", collections: 164, totalTimeMs: 2_980, pools: ["PS Old Gen", "Metaspace", "Compressed Class Space"] },
    ],
    events: [],
    history: [],
    threads,
    peakThreads: threads.length + 6,
    startedThreads: 12_884,
    classesLoaded: 18_441,
    classesUnloaded: 212,
    cpuTimeMs: 1000 * 60 * 42,
    tick: 0,
  };
}

function statesOf(state: SimState) {
  return state.threads.length;
}

function buildSnapshot(targetId: string, name: string): JvmSnapshot {
  if (!globalForJvm.__dockflowJvm) globalForJvm.__dockflowJvm = new Map();
  let state = globalForJvm.__dockflowJvm.get(targetId);
  if (!state) {
    state = seed(name);
    globalForJvm.__dockflowJvm.set(targetId, state);
  }
  state.tick += 1;

  const drift = (Math.random() - 0.42) * 0.012;
  state.pools = state.pools.map((pool) => {
    const ceiling = pool.max > 0 ? pool.max : pool.committed * 1.2;
    const used = Math.max(pool.committed * 0.08, Math.min(ceiling, pool.used * (1 + drift + (Math.random() - 0.5) * 0.03)));
    return { ...pool, used };
  });

  if (state.tick % 5 === 0) {
    const eden = state.pools.find((pool) => pool.name === "PS Eden Space");
    const collector = Math.random() < 0.85 ? "PS Scavenge" : "PS MarkSweep";
    const pause = collector === "PS Scavenge" ? 4 + Math.random() * 18 : 42 + Math.random() * 120;
    const reclaimed = (eden?.used ?? 0) * (0.5 + Math.random() * 0.4);
    state.events.unshift({
      at: Date.now(),
      collector,
      cause: collector === "PS Scavenge" ? "Allocation Failure" : "Ergonomics",
      pauseMs: Math.round(pause * 10) / 10,
      reclaimedBytes: Math.round(reclaimed),
    });
    state.events = state.events.slice(0, 40);
    const target = state.collectors.find((entry) => entry.name === collector);
    if (target) {
      target.collections += 1;
      target.totalTimeMs += pause;
    }
    if (eden) eden.used *= 0.25;
  }

  const heapPools = state.pools.filter((pool) => pool.type === "heap");
  const nonHeapPools = state.pools.filter((pool) => pool.type === "non-heap");
  const heapUsed = heapPools.reduce((sum, pool) => sum + pool.used, 0);
  const nonHeapUsed = nonHeapPools.reduce((sum, pool) => sum + pool.used, 0);
  const heapCommitted = heapPools.reduce((sum, pool) => sum + Math.min(pool.committed, pool.max > 0 ? pool.max : pool.committed), 0);
  const nonHeapCommitted = nonHeapPools.reduce((sum, pool) => sum + pool.committed, 0);

  const totalTimeMs = state.collectors.reduce((sum, collector) => sum + collector.totalTimeMs, 0);
  const uptimeMs = Date.now() - state.startedAt;
  const cpuPct = 12 + Math.sin(state.tick / 7) * 6 + Math.random() * 8;

  const history = [
    ...state.history,
    {
      at: Date.now(),
      heap: Math.round((heapUsed / state.heapMax) * 1000) / 10,
      nonHeap: Math.round((nonHeapUsed / (256 * MB)) * 1000) / 10,
      cpu: Math.round(cpuPct * 10) / 10,
      threads: statesOf(state),
    },
  ].slice(-90);
  state.history = history;

  const threads: JvmThread[] = state.threads.map((thread) => ({
    id: thread.id,
    name: thread.name,
    daemon: thread.daemon,
    priority: thread.priority,
    state: thread.state,
    blockedTimeMs: thread.blockedTimeMs,
    blockedCount: thread.blockedCount,
    waitedCount: thread.waitedCount,
    lockName: thread.lockName,
    lockOwnerId: thread.lockOwnerId,
    lockOwnerName: thread.lockOwnerName,
    stack: thread.frames,
  }));

  const blocked = threads.filter((thread) => thread.state === "BLOCKED").length;
  const waiting = threads.filter((thread) => thread.state === "WAITING").length;
  const timedWaiting = threads.filter((thread) => thread.state === "TIMED_WAITING").length;

  return {
    targetId,
    name,
    source: "simulated",
    fetchedAt: Date.now(),
    online: true,
    error: null,
    identity: {
      vmName: state.vmName,
      vmVersion: "21.0.4+7-LTS",
      vmVendor: "Eclipse Adoptium",
      uptimeMs,
      pid: state.pid,
      host: "sandbox-jvm",
      args: [
        "-XX:MaxRAMPercentage=70",
        "-XX:+UseParallelGC",
        "-Dspring.profiles.active=prod",
        "-javaagent:/opt/otel/opentelemetry-javaagent.jar",
        "-jar",
        "/app/application.jar",
      ],
      classPath: "/app/application.jar:/opt/otel/opentelemetry-javaagent.jar",
      systemProperties: {
        "java.version": "21.0.4",
        "java.vendor": "Eclipse Adoptium",
        "java.vm.name": "OpenJDK 64-Bit Server VM",
        "os.name": "Linux",
        "os.arch": "amd64",
        "os.version": "6.8.0-generic",
        "user.dir": "/app",
        "file.encoding": "UTF-8",
        "sun.java.command": "/app/application.jar",
        "spring.profiles.active": "prod",
      },
    },
    memory: {
      heapUsed: Math.round(heapUsed),
      heapCommitted: Math.round(heapCommitted),
      heapMax: state.heapMax,
      nonHeapUsed: Math.round(nonHeapUsed),
      nonHeapCommitted: Math.round(nonHeapCommitted),
      nonHeapMax: -1,
      pools: state.pools.map((pool) => ({
        ...pool,
        used: Math.round(pool.used),
        committed: Math.round(pool.committed),
        max: pool.max > 0 ? Math.round(pool.max) : -1,
      })),
    },
    gc: {
      collectors: state.collectors.map((collector) => ({
        ...collector,
        avgPauseMs: collector.collections ? Math.round((collector.totalTimeMs / collector.collections) * 100) / 100 : 0,
      })),
      totalCollections: state.collectors.reduce((sum, collector) => sum + collector.collections, 0),
      totalTimeMs: Math.round(totalTimeMs),
      overheadPct: uptimeMs ? Math.round((totalTimeMs / uptimeMs) * 10000) / 100 : 0,
      events: state.events.slice(0, 24),
    },
    threadsInfo: {
      live: threads.length,
      daemon: threads.filter((thread) => thread.daemon).length,
      peak: state.peakThreads,
      started: state.startedThreads,
      blocked,
      waiting,
      timedWaiting,
      deadlocked: 0,
    },
    threads,
    classes: {
      loaded: state.classesLoaded + state.tick % 12,
      unloaded: state.classesUnloaded,
      total: state.classesLoaded + state.tick % 12 - state.classesUnloaded,
    },
    cpu: {
      processPct: Math.round(cpuPct * 10) / 10,
      systemPct: Math.round((cpuPct * 0.62) * 10) / 10,
      loadAverage: Math.round((cpuPct / 22) * 100) / 100,
      cpuTimeMs: Math.round(state.cpuTimeMs + uptimeMs * 0.05),
    },
    nio: [
      { name: "direct", count: 42, memoryUsed: 8 * MB + (state.tick % 5) * MB, memoryCapacity: 64 * MB },
      { name: "mapped", count: 6, memoryUsed: 2 * MB, memoryCapacity: 2 * MB },
    ],
    history,
  };
}

export function simulatedSnapshot(targetId: string, name: string): JvmSnapshot {
  return buildSnapshot(targetId, name);
}

export function resetSimulatedTarget(targetId: string): void {
  globalForJvm.__dockflowJvm?.delete(targetId);
}
