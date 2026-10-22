import { eq, sql } from "drizzle-orm";
import { db } from "@/db/ops";
import { commandRuns, events as eventsTable, metricSamples, metrics, nodes } from "@/db/ops-schema";
import { ensureSeeded } from "@/lib/seed";
import type { Runbook } from "@/lib/telemetry-types";
import type { CommandRun, EventItem, MetricSnapshot, MetricSource, NodeStatus, NodeType } from "@/lib/types";
import { GROUP_TYPES, MONITORED_TYPES, worstStatus } from "@/lib/types";

export interface MetricUpdate extends MetricSnapshot {
  nodeId: string;
  status?: NodeStatus;
}

export type StreamMessage =
  | { type: "hello"; at: string; tick: number; nodeCount: number }
  | { type: "metrics"; at: string; updates: MetricUpdate[] }
  | { type: "event"; event: EventItem }
  | { type: "cli"; run: CommandRun; line?: string };

/** Operating point each node mean-reverts towards (keeps the simulation bounded). */
interface Target {
  cpu: number;
  memory: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  requestsPerSec: number;
  latencyMs: number;
  errorRate: number;
}

const CEILINGS = {
  cpu: 100,
  memory: 100,
  disk: 100,
  networkIn: 4000,
  networkOut: 5000,
  requestsPerSec: 20000,
  latencyMs: 4000,
  errorRate: 40,
  uptimePct: 99.999,
};

interface EngineState {
  ready: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
  tick: number;
  live: Map<string, MetricSnapshot>;
  target: Map<string, Target>;
  status: Map<string, NodeStatus>;
  type: Map<string, NodeType>;
  parent: Map<string, string | null>;
  children: Map<string, string[]>;
  name: Map<string, string>;
  order: string[];
  monitored: string[];
  groups: string[];
  listeners: Set<(msg: StreamMessage) => void>;
}

const g = globalThis as typeof globalThis & { __opsEngine?: EngineState };

function createState(): EngineState {
  return {
    ready: null,
    timer: null,
    tick: 0,
    live: new Map(),
    target: new Map(),
    status: new Map(),
    type: new Map(),
    parent: new Map(),
    children: new Map(),
    name: new Map(),
    order: [],
    monitored: [],
    groups: [],
    listeners: new Set(),
  };
}

export const engine: EngineState = g.__opsEngine ?? createState();
g.__opsEngine = engine;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const noise = (amp: number) => (Math.random() - 0.5) * 2 * amp;

export function broadcast(msg: StreamMessage) {
  for (const listener of engine.listeners) {
    try {
      listener(msg);
    } catch {
      engine.listeners.delete(listener);
    }
  }
}

export function subscribe(listener: (msg: StreamMessage) => void) {
  engine.listeners.add(listener);
  return () => {
    engine.listeners.delete(listener);
  };
}

async function hydrate() {
  await ensureSeeded();
  const rows = await db
    .select({
      id: nodes.id,
      parentId: nodes.parentId,
      name: nodes.name,
      type: nodes.type,
      status: nodes.status,
    })
    .from(nodes)
    .orderBy(nodes.sortOrder);

  engine.order = [];
  engine.monitored = [];
  engine.groups = [];
  engine.children = new Map();
  for (const row of rows) {
    const type = row.type as NodeType;
    engine.type.set(row.id, type);
    engine.status.set(row.id, row.status as NodeStatus);
    engine.name.set(row.id, row.name);
    engine.parent.set(row.id, row.parentId);
    engine.order.push(row.id);
    const siblings = engine.children.get(row.parentId ?? "__root__") ?? [];
    siblings.push(row.id);
    engine.children.set(row.parentId ?? "__root__", siblings);
    if (type === "resource") continue;
    if (MONITORED_TYPES.has(type)) engine.monitored.push(row.id);
    if (GROUP_TYPES.has(type)) engine.groups.push(row.id);
  }

  const metricRows = await db.select().from(metrics);
  for (const row of metricRows) {
    // sanitise anything absurd that might have been persisted by an older build
    const snapshot: MetricSnapshot = {
      cpu: clamp(row.cpu, 0, CEILINGS.cpu),
      memory: clamp(row.memory, 0, CEILINGS.memory),
      disk: clamp(row.disk, 0, CEILINGS.disk),
      networkIn: clamp(row.networkIn, 0, CEILINGS.networkIn),
      networkOut: clamp(row.networkOut, 0, CEILINGS.networkOut),
      requestsPerSec: clamp(row.requestsPerSec, 0, CEILINGS.requestsPerSec),
      errorRate: clamp(row.errorRate, 0, 12),
      latencyMs: clamp(row.latencyMs, 1, CEILINGS.latencyMs),
      uptimePct: clamp(row.uptimePct, 80, CEILINGS.uptimePct),
      replicasReady: clamp(row.replicasReady, 0, 4096),
      replicasDesired: clamp(row.replicasDesired, 0, 4096),
      source: row.source as MetricSource,
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
    engine.live.set(row.nodeId, snapshot);
    engine.target.set(row.nodeId, {
      cpu: snapshot.cpu,
      memory: snapshot.memory,
      disk: snapshot.disk,
      networkIn: snapshot.networkIn,
      networkOut: snapshot.networkOut,
      requestsPerSec: snapshot.requestsPerSec,
      latencyMs: snapshot.latencyMs,
      errorRate: snapshot.errorRate,
    });
  }
  // resource gauge nodes mirror their host
  for (const id of engine.order) {
    if (engine.type.get(id) === "resource" && !engine.live.has(id)) {
      const host = engine.parent.get(id) ?? null;
      const hostMetric = host ? engine.live.get(host) : undefined;
      if (hostMetric) engine.live.set(id, hostMetric);
    }
  }
}

/** Starts (once) the simulation loop that mimics Prometheus / Docker / K8s feeds. */
export function startEngine(): Promise<void> {
  if (!engine.ready) {
    engine.ready = hydrate()
      .then(() => {
        if (engine.timer) return;
        engine.timer = setInterval(() => {
          void tickEngine();
        }, 2000);
        engine.timer.unref?.();
      })
      .catch((error) => {
        console.error("[telemetry] engine failed to start", error);
        engine.ready = null;
      });
  }
  return engine.ready;
}

/** Tears the simulation down and re-hydrates it from a freshly seeded dataset. */
export async function resetEngine(): Promise<void> {
  if (engine.timer) {
    clearInterval(engine.timer);
    engine.timer = null;
  }
  engine.ready = null;
  engine.tick = 0;
  engine.live.clear();
  engine.target.clear();
  engine.status.clear();
  engine.type.clear();
  engine.parent.clear();
  engine.name.clear();
  engine.children.clear();
  engine.order = [];
  engine.monitored = [];
  engine.groups = [];
  await startEngine();
}

function leafStatus(id: string, snapshot: MetricSnapshot): NodeStatus {
  const current = engine.status.get(id) ?? "healthy";
  if (current === "offline" || current === "maintenance") return current;
  if (snapshot.cpu > 92 || snapshot.errorRate > 5 || snapshot.uptimePct < 98.5) return "critical";
  if (snapshot.cpu > 79 || snapshot.errorRate > 1.4 || snapshot.memory > 88) return "degraded";
  return "healthy";
}

async function tickEngine() {
  engine.tick += 1;
  const at = new Date();
  const atIso = at.toISOString();
  const statusChanges: { nodeId: string; status: NodeStatus }[] = [];

  // 1) evolve every monitored leaf/host node
  for (const id of engine.monitored) {
    const snapshot = engine.live.get(id);
    if (!snapshot) continue;
    const target: Target = engine.target.get(id) ?? {
      cpu: snapshot.cpu,
      memory: snapshot.memory,
      disk: snapshot.disk,
      networkIn: snapshot.networkIn,
      networkOut: snapshot.networkOut,
      requestsPerSec: snapshot.requestsPerSec,
      latencyMs: snapshot.latencyMs,
      errorRate: snapshot.errorRate,
    };
    const status = engine.status.get(id) ?? "healthy";

    if (status === "offline") {
      engine.live.set(id, { ...snapshot, cpu: 0, memory: 0, disk: snapshot.disk, requestsPerSec: 0, networkIn: 0, networkOut: 0, errorRate: 0, latencyMs: 0, updatedAt: atIso });
      continue;
    }

    // slow drift of the operating point + occasional spike
    const spike = Math.random() > 0.985 ? noise(20) : 0;
    const saturated = status === "critical" || status === "degraded";
    target.cpu = clamp(target.cpu + noise(2.4) + spike * 0.45, 3, saturated ? 99 : 92);
    target.memory = clamp(target.memory + noise(1.0), 8, 97);
    target.disk = clamp(target.disk + noise(0.2), 5, 98);
    target.requestsPerSec = clamp(target.requestsPerSec * (1 + noise(0.06)), 0.2, CEILINGS.requestsPerSec);
    target.networkIn = clamp(target.networkIn * (1 + noise(0.06)), 0.05, CEILINGS.networkIn);
    target.networkOut = clamp(target.networkOut * (1 + noise(0.06)), 0.05, CEILINGS.networkOut);
    target.latencyMs = clamp(target.latencyMs * (1 + noise(0.05)) + (target.cpu > 85 ? 5 : -1), 1, 2200);
    target.errorRate = clamp(
      target.errorRate + noise(0.07) + (target.cpu > 90 ? 0.22 : -0.06),
      0,
      status === "critical" ? 18 : 6,
    );
    engine.target.set(id, target);

    /** mean reversion towards the operating point + measurement jitter */
    const pull = (value: number, goal: number, factor: number, jitter: number, hi: number) =>
      round1(clamp(value + (goal - value) * factor + noise(jitter), 0, hi));

    const next: MetricSnapshot = {
      ...snapshot,
      cpu: pull(snapshot.cpu, target.cpu, 0.35, 1.5, 100),
      memory: pull(snapshot.memory, target.memory, 0.2, 0.7, 100),
      disk: pull(snapshot.disk, target.disk, 0.1, 0.15, 100),
      networkIn: pull(snapshot.networkIn, target.networkIn, 0.3, 1.4, CEILINGS.networkIn),
      networkOut: pull(snapshot.networkOut, target.networkOut, 0.3, 1.4, CEILINGS.networkOut),
      requestsPerSec: pull(snapshot.requestsPerSec, target.requestsPerSec, 0.3, 7, CEILINGS.requestsPerSec),
      latencyMs: Math.max(1, pull(snapshot.latencyMs, target.latencyMs * (1 + snapshot.cpu / 300), 0.25, 3, CEILINGS.latencyMs)),
      errorRate: pull(snapshot.errorRate, target.errorRate, 0.25, 0.05, CEILINGS.errorRate),
      uptimePct: round1(
        clamp(snapshot.uptimePct + noise(0.004) + (snapshot.errorRate > 3 ? -0.008 : 0.006), 80, CEILINGS.uptimePct),
      ),
      updatedAt: atIso,
    };
    if (next.replicasDesired > 0) {
      next.replicasReady = clamp(
        next.replicasDesired - (next.cpu > 90 || next.errorRate > 4 ? Math.ceil(Math.random() * 2) : 0),
        0,
        next.replicasDesired,
      );
    }
    engine.live.set(id, next);

    const nextStatus = leafStatus(id, next);
    if (nextStatus !== status) {
      engine.status.set(id, nextStatus);
      statusChanges.push({ nodeId: id, status: nextStatus });
    }
  }

  // 2) roll group nodes up from their children (parents before children in engine.order)
  const updates: MetricUpdate[] = [];
  for (const id of engine.order) {
    const type = engine.type.get(id);
    if (!type) continue;
    if (type === "resource") {
      const host = engine.parent.get(id) ?? null;
      const hostMetric = host ? engine.live.get(host) : undefined;
      if (hostMetric) engine.live.set(id, hostMetric);
      continue;
    }
    if (!GROUP_TYPES.has(type)) continue;

    // resource gauge nodes mirror their host, so they must not feed the rollup
    const kids = (engine.children.get(id) ?? []).filter((kid) => engine.type.get(kid) !== "resource");
    const measured = kids.map((kid) => engine.live.get(kid)).filter((m): m is MetricSnapshot => Boolean(m));
    if (measured.length === 0) continue;

    // averages (not sums) keep the rollup stable across deep hierarchies:
    // the same traffic is measured at host, workload, service and endpoint level,
    // so summing recursively would compound the same request several times.
    const avg = (fn: (m: MetricSnapshot) => number) => measured.reduce((acc, m) => acc + fn(m), 0) / measured.length;
    const aggregate: MetricSnapshot = {
      cpu: round1(avg((m) => m.cpu)),
      memory: round1(avg((m) => m.memory)),
      disk: round1(avg((m) => m.disk)),
      networkIn: round1(avg((m) => m.networkIn)),
      networkOut: round1(avg((m) => m.networkOut)),
      requestsPerSec: round1(avg((m) => m.requestsPerSec)),
      errorRate: round1(avg((m) => m.errorRate)),
      latencyMs: round1(avg((m) => m.latencyMs)),
      uptimePct: round1(Math.min(...measured.map((m) => m.uptimePct))),
      replicasReady: Math.round(avg((m) => m.replicasReady)),
      replicasDesired: Math.round(avg((m) => m.replicasDesired)),
      source: avg((m) => (m.source === "prometheus" ? 1 : 0)) > 0.5 ? "prometheus" : measured[0].source,
      updatedAt: atIso,
    };
    engine.live.set(id, aggregate);

    let rolled: NodeStatus = "healthy";
    for (const kid of kids) rolled = worstStatus(rolled, engine.status.get(kid) ?? "healthy");
    const previous = engine.status.get(id) ?? "healthy";
    if (previous !== rolled && previous !== "maintenance") {
      engine.status.set(id, rolled);
      statusChanges.push({ nodeId: id, status: rolled });
    }
  }

  // 3) emit one message per tick
  for (const id of engine.order) {
    const snapshot = engine.live.get(id);
    if (!snapshot || id === "__root__") continue;
    updates.push({ nodeId: id, ...snapshot, status: engine.status.get(id) });
  }
  broadcast({ type: "metrics", at: atIso, updates });
  if (statusChanges.length > 0) {
    for (const change of statusChanges) {
      await db.update(nodes).set({ status: change.status, updatedAt: at }).where(eq(nodes.id, change.nodeId));
    }
  }

  // 4) persistence cadence: snapshot every 10s, samples every 30s
  if (engine.tick % 5 === 0) await persistSnapshots(at);
  if (engine.tick % 15 === 0) await persistSamples(at);
  if (engine.tick % 7 === 0) await maybeEmitEvent(at);
}

async function persistSnapshots(at: Date) {
  const rows: (typeof metrics.$inferInsert)[] = [];
  for (const [nodeId, snapshot] of engine.live) {
    if (engine.type.get(nodeId) === "resource") continue;
    rows.push({
      nodeId,
      cpu: snapshot.cpu,
      memory: snapshot.memory,
      disk: snapshot.disk,
      networkIn: snapshot.networkIn,
      networkOut: snapshot.networkOut,
      requestsPerSec: snapshot.requestsPerSec,
      errorRate: snapshot.errorRate,
      latencyMs: snapshot.latencyMs,
      uptimePct: snapshot.uptimePct,
      replicasReady: snapshot.replicasReady,
      replicasDesired: snapshot.replicasDesired,
      source: snapshot.source,
      updatedAt: at,
    });
  }
  for (let i = 0; i < rows.length; i += 120) {
    const chunk = rows.slice(i, i + 120);
    await db
      .insert(metrics)
      .values(chunk)
      .onConflictDoUpdate({
        target: metrics.nodeId,
        set: {
          cpu: sql`excluded.cpu`,
          memory: sql`excluded.memory`,
          disk: sql`excluded.disk`,
          networkIn: sql`excluded.network_in`,
          networkOut: sql`excluded.network_out`,
          requestsPerSec: sql`excluded.requests_per_sec`,
          errorRate: sql`excluded.error_rate`,
          latencyMs: sql`excluded.latency_ms`,
          uptimePct: sql`excluded.uptime_pct`,
          replicasReady: sql`excluded.replicas_ready`,
          replicasDesired: sql`excluded.replicas_desired`,
          source: sql`excluded.source`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

async function persistSamples(at: Date) {
  const rows: (typeof metricSamples.$inferInsert)[] = [];
  for (const [nodeId, snapshot] of engine.live) {
    if (engine.type.get(nodeId) === "resource") continue;
    rows.push(
      { nodeId, metric: "cpu", value: snapshot.cpu, ts: at },
      { nodeId, metric: "memory", value: snapshot.memory, ts: at },
      { nodeId, metric: "disk", value: snapshot.disk, ts: at },
    );
  }
  for (let i = 0; i < rows.length; i += 900) {
    await db.insert(metricSamples).values(rows.slice(i, i + 900));
  }
  // keep the rolling window bounded
  await db.delete(metricSamples).where(sql`${metricSamples.ts} < now() - interval '50 minutes'`);
}

const EVENT_POOL = [
  { severity: "critical", source: "prometheus", title: "CPU saturation above 92% for 5m", detail: "rule: node_cpu_saturation / for: 5m" },
  { severity: "warning", source: "kubernetes", title: "Pod restarted unexpectedly", detail: "lastState.terminated.reason: OOMKilled" },
  { severity: "warning", source: "docker", title: "Container memory above 80% of limit", detail: "docker stats mem_usage / limit" },
  { severity: "critical", source: "prometheus", title: "Endpoint p99 latency over SLO", detail: "slo_burn_rate_1h > 14" },
  { severity: "info", source: "kubernetes", title: "HPA scaled deployment", detail: "replicas increased to meet targetCPUUtilization 70%" },
  { severity: "info", source: "agent", title: "Health probe recovered", detail: "readinessProbe: 3 consecutive successes" },
  { severity: "warning", source: "agent", title: "Disk usage above 75%", detail: "mount: /var/lib/docker" },
] as const;

async function maybeEmitEvent(at: Date) {
  if (Math.random() > 0.55) return;
  const candidatePool = engine.monitored.filter((id) => {
    const status = engine.status.get(id);
    return status === "critical" || status === "degraded";
  });
  const pool = candidatePool.length > 0 && Math.random() > 0.35 ? candidatePool : engine.monitored;
  const nodeId = pool[Math.floor(Math.random() * pool.length)];
  if (!nodeId) return;
  const snapshot = engine.live.get(nodeId);
  const template =
    snapshot && snapshot.cpu > 88
      ? EVENT_POOL[0]
      : EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)];

  const [inserted] = await db
    .insert(eventsTable)
    .values({
      nodeId,
      severity: template.severity,
      source: template.source,
      title: template.title,
      detail: template.detail,
      acknowledged: false,
      ts: at,
    })
    .returning({ id: eventsTable.id });

  broadcast({
    type: "event",
    event: {
      id: inserted.id,
      nodeId,
      nodeName: engine.name.get(nodeId) ?? null,
      severity: template.severity,
      source: template.source,
      title: template.title,
      detail: template.detail,
      acknowledged: false,
      ts: at.toISOString(),
    },
  });
}

/* ------------------------------------------------------------------ *
 * CLI executor (runbooks)                                             *
 * ------------------------------------------------------------------ */

export type { Runbook } from "@/lib/telemetry-types";

export const RUNBOOKS: Runbook[] = [
  {
    id: "snapshot",
    label: "Capture resource snapshot",
    template: "top -b -n1 | head -20 && df -h && free -m",
    description: "Read-only inspection of CPU, memory and disk pressure.",
    risky: false,
  },
  {
    id: "restart",
    label: "Restart workload",
    template: "systemctl restart {name} && sleep 3 && systemctl is-active {name}",
    description: "Bounces the workload and clears transient memory pressure.",
    risky: true,
  },
  {
    id: "scale",
    label: "Scale replicas +2",
    template: "kubectl -n {namespace} scale deploy/{name} --replicas={replicas}",
    description: "Adds capacity to absorb the current request rate.",
    risky: false,
  },
  {
    id: "drain",
    label: "Cordon + drain host",
    template: "kubectl cordon {name} && kubectl drain {name} --ignore-daemonsets --delete-emptydir-data",
    description: "Puts the host into maintenance and evicts workloads.",
    risky: true,
  },
  {
    id: "logs",
    label: "Tail last 200 log lines",
    template: "journalctl -u {name} -n 200 --no-pager",
    description: "Streams recent logs for triage.",
    risky: false,
  },
  {
    id: "failover",
    label: "Failover to standby region",
    template: "runbook failover --service {name} --target {region} --confirm",
    description: "Shifts traffic to the standby datacenter.",
    risky: true,
  },
];

function renderCommand(template: string, nodeId: string) {
  const type = engine.type.get(nodeId) ?? "service";
  const name = engine.name.get(nodeId) ?? nodeId;
  const parent = engine.parent.get(nodeId) ?? null;
  const region = parent ? (engine.name.get(parent) ?? "eu-west-1") : "eu-west-1";
  const snapshot = engine.live.get(nodeId);
  return template
    .replaceAll("{name}", name.replace(/^ns\//, "").split("::").pop() ?? name)
    .replaceAll("{namespace}", type === "namespace" ? name.replace(/^ns\//, "") : "prod")
    .replaceAll("{replicas}", String((snapshot?.replicasDesired ?? 3) + 2))
    .replaceAll("{region}", region.includes("·") ? region.split("·")[1].trim() : region);
}

export async function executeRunbook(nodeId: string, runbookId: string, operator = "operator@noc"): Promise<CommandRun> {
  await startEngine();
  const runbook = RUNBOOKS.find((r) => r.id === runbookId) ?? RUNBOOKS[0];
  const command = renderCommand(runbook.template, nodeId);

  const [run] = await db
    .insert(commandRuns)
    .values({ nodeId, command, operator, status: "running", output: "", startedAt: new Date() })
    .returning();

  const toRun = (row: typeof run): CommandRun => ({
    id: row.id,
    nodeId: row.nodeId,
    nodeName: row.nodeId ? engine.name.get(row.nodeId) ?? null : null,
    command: row.command,
    operator: row.operator,
    status: row.status as CommandRun["status"],
    exitCode: row.exitCode,
    output: row.output,
    startedAt: new Date(row.startedAt).toISOString(),
    finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
  });

  const current = toRun(run);
  broadcast({ type: "cli", run: current });

  const nodeName = engine.name.get(nodeId) ?? nodeId;
  const snapshot = engine.live.get(nodeId);
  const lines: string[] = [
    `$ ssh noc-agent@${nodeName.slice(0, 28)} "${command}"`,
    `[${new Date().toISOString()}] connecting to collector (${runbook.risky ? "privileged" : "read-only"}) ...`,
  ];

  if (runbookId === "snapshot" || runbookId === "logs") {
    lines.push(
      `cpu=${snapshot?.cpu ?? 0}%  mem=${snapshot?.memory ?? 0}%  disk=${snapshot?.disk ?? 0}%`,
      `net_in=${snapshot?.networkIn ?? 0}MB/s  net_out=${snapshot?.networkOut ?? 0}MB/s  rps=${snapshot?.requestsPerSec ?? 0}`,
      `latency_p99=${snapshot?.latencyMs ?? 0}ms  error_rate=${snapshot?.errorRate ?? 0}%  uptime=${snapshot?.uptimePct ?? 100}%`,
      "exit 0",
    );
  } else if (runbookId === "restart") {
    lines.push(`stopping ${nodeName} ...`, `SIGTERM sent, waiting for graceful shutdown (30s)`, `starting ${nodeName} ...`, `active (running) — memory pressure cleared`, "exit 0");
  } else if (runbookId === "scale") {
    lines.push(`deployment.apps/${nodeName} scaled`, `replicas: ${snapshot?.replicasReady ?? 1} -> ${(snapshot?.replicasDesired ?? 3) + 2}`, "exit 0");
  } else if (runbookId === "drain") {
    lines.push(`node/${nodeName} cordoned`, "evicting pods (ignore-daemonsets)", "drain complete", "exit 0");
  } else {
    lines.push(`resolving standby target ...`, `shifting DNS + BGP anycast weights`, `health checks green in target region`, "exit 0");
  }

  // stream the output progressively so the console feels live
  let output = "";
  for (let i = 0; i < lines.length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 220));
    output += (output ? "\n" : "") + lines[i];
    await db.update(commandRuns).set({ output }).where(eq(commandRuns.id, run.id));
    broadcast({ type: "cli", run: { ...current, output, status: "running" }, line: lines[i] });
  }

  const failed = runbook.risky && Math.random() > 0.82;
  const finalStatus: CommandRun["status"] = failed ? "failed" : "success";
  if (failed) {
    output += "\npermission denied while contacting privileged collector\nexit 1";
  }
  const finishedAt = new Date();
  await db
    .update(commandRuns)
    .set({ output, status: finalStatus, exitCode: failed ? 1 : 0, finishedAt })
    .where(eq(commandRuns.id, run.id));

  // side effects on the topology
  if (!failed) {
    if (runbookId === "restart" && snapshot) {
      engine.live.set(nodeId, {
        ...snapshot,
        cpu: round1(clamp(snapshot.cpu * 0.45, 4, 60)),
        memory: round1(clamp(snapshot.memory * 0.6, 10, 70)),
        errorRate: round1(clamp(snapshot.errorRate * 0.2, 0, 4)),
        latencyMs: round1(clamp(snapshot.latencyMs * 0.5, 4, 900)),
        updatedAt: finishedAt.toISOString(),
      });
      const target = engine.target.get(nodeId);
      if (target) engine.target.set(nodeId, { ...target, cpu: target.cpu * 0.5, memory: target.memory * 0.65 });
      engine.status.set(nodeId, "healthy");
      await db.update(nodes).set({ status: "healthy", updatedAt: finishedAt }).where(eq(nodes.id, nodeId));
      broadcast({ type: "metrics", at: finishedAt.toISOString(), updates: [{ nodeId, ...engine.live.get(nodeId)!, status: "healthy" }] });
    }
    if (runbookId === "scale" && snapshot) {
      const desired = snapshot.replicasDesired + 2;
      engine.live.set(nodeId, { ...snapshot, replicasDesired: desired, replicasReady: desired, updatedAt: finishedAt.toISOString() });
    }
    if (runbookId === "drain") {
      engine.status.set(nodeId, "maintenance");
      await db.update(nodes).set({ status: "maintenance", updatedAt: finishedAt }).where(eq(nodes.id, nodeId));
      broadcast({ type: "metrics", at: finishedAt.toISOString(), updates: [{ nodeId, ...engine.live.get(nodeId)!, status: "maintenance" }] });
    }
    if (runbookId === "failover") {
      engine.status.set(nodeId, "healthy");
      await db.update(nodes).set({ status: "healthy", updatedAt: finishedAt }).where(eq(nodes.id, nodeId));
    }
  }

  const [finalRow] = await db.select().from(commandRuns).where(eq(commandRuns.id, run.id));
  const finalRun = toRun(finalRow);
  broadcast({ type: "cli", run: finalRun });

  await db.insert(eventsTable).values({
    nodeId,
    severity: failed ? "warning" : "info",
    source: "cli-executor",
    title: `${failed ? "Failed" : "Executed"}: ${runbook.label}`,
    detail: command,
    acknowledged: false,
    ts: finishedAt,
  });

  return finalRun;
}

export async function listRuns(limit = 40): Promise<CommandRun[]> {
  const rows = await db
    .select({ run: commandRuns, nodeName: nodes.name })
    .from(commandRuns)
    .leftJoin(nodes, eq(nodes.id, commandRuns.nodeId))
    .orderBy(sql`${commandRuns.startedAt} desc`)
    .limit(limit);
  return rows.map(({ run, nodeName }) => ({
    id: run.id,
    nodeId: run.nodeId,
    nodeName: nodeName ?? null,
    command: run.command,
    operator: run.operator,
    status: run.status as CommandRun["status"],
    exitCode: run.exitCode,
    output: run.output,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
  }));
}
