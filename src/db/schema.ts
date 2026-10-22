import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * dockflow schema — SQLite/libSQL, drizzle-orm v1.
 *
 * Conventions:
 *  - TEXT uuid4 primary keys (randomUUID from node:crypto)
 *  - INTEGER unix-seconds timestamps with { mode: "timestamp" }
 *  - TEXT { mode: "json" } for structured payloads
 *  - INTEGER { mode: "boolean" } for flags
 *  - AUTOINCREMENT INTEGER only for high volume append-only rows (spans, dumps)
 *  - table extra config returns an ARRAY (v1 removed the keyed-object form)
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/* ------------------------------------------------------------------ engine */

export const dockerHosts = sqliteTable(
  "docker_hosts",
  {
    id: id(),
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    kind: text("kind", { enum: ["unix", "tcp", "npipe"] }).notNull().default("unix"),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("docker_hosts_endpoint_idx").on(table.endpoint)],
);

/* --------------------------------------------------------------------- apm */

export const apmServices = sqliteTable(
  "apm_services",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    team: text("team"),
    kind: text("kind").notNull().default("service"),
    runtime: text("runtime"),
    slaLatencyMs: real("sla_latency_ms").notNull().default(300),
    slaErrorRate: real("sla_error_rate").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("apm_services_key_idx").on(table.key)],
);

export const apmAgents = sqliteTable(
  "apm_agents",
  {
    id: id(),
    agent: text("agent").notNull(),
    serviceKey: text("service_key").notNull(),
    host: text("host"),
    runtime: text("runtime"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    spanCount: integer("span_count").notNull().default(0),
  },
  (table) => [uniqueIndex("apm_agents_agent_idx").on(table.agent)],
);

export const apmSpans = sqliteTable(
  "apm_spans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    traceId: text("trace_id").notNull(),
    spanId: text("span_id").notNull(),
    parentSpanId: text("parent_span_id"),
    serviceKey: text("service_key").notNull(),
    operation: text("operation").notNull(),
    kind: text("kind", { enum: ["server", "client", "internal"] }).notNull().default("server"),
    startTime: integer("start_time").notNull(),
    durationMs: real("duration_ms").notNull().default(0),
    status: text("status", { enum: ["ok", "error"] }).notNull().default("ok"),
    errorMessage: text("error_message"),
    tags: text("tags", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    index("apm_spans_trace_idx").on(table.traceId),
    index("apm_spans_start_idx").on(table.startTime),
    index("apm_spans_service_idx").on(table.serviceKey, table.startTime),
  ],
);

export const apmEdges = sqliteTable(
  "apm_edges",
  {
    id: id(),
    sourceService: text("source_service").notNull(),
    targetService: text("target_service").notNull(),
    calls: integer("calls").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    totalMs: real("total_ms").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("apm_edges_pair_idx").on(table.sourceService, table.targetService)],
);

/* --------------------------------------------------------------- workflows */

export const workflows = sqliteTable("workflows", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  nodes: text("nodes", { mode: "json" }).$type<unknown[]>().notNull().default(sql`'[]'`),
  edges: text("edges", { mode: "json" }).$type<unknown[]>().notNull().default(sql`'[]'`),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workflowRuns = sqliteTable(
  "workflow_runs",
  {
    id: id(),
    workflowId: text("workflow_id").notNull(),
    workflowName: text("workflow_name"),
    status: text("status", { enum: ["pending", "running", "success", "failed", "cancelled"] })
      .notNull()
      .default("pending"),
    trigger: text("trigger", { mode: "json" }).$type<Record<string, unknown>>(),
    steps: text("steps", { mode: "json" }).$type<unknown[]>().notNull().default(sql`'[]'`),
    error: text("error"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (table) => [index("workflow_runs_workflow_idx").on(table.workflowId, table.startedAt)],
);

/* --------------------------------------------------------------------- jvm */

export const jvmTargets = sqliteTable("jvm_targets", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["jolokia", "actuator", "simulated"] }).notNull().default("simulated"),
  url: text("url"),
  containerId: text("container_id"),
  note: text("note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const jvmDumps = sqliteTable(
  "jvm_dumps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    targetId: text("target_id").notNull(),
    kind: text("kind", { enum: ["thread", "heap", "profiler"] }).notNull(),
    label: text("label").notNull(),
    size: integer("size").notNull().default(0),
    path: text("path"),
    summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>(),
    content: text("content"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [index("jvm_dumps_target_idx").on(table.targetId, table.createdAt)],
);

export const jvmSessions = sqliteTable("jvm_sessions", {
  id: id(),
  targetId: text("target_id").notNull(),
  kind: text("kind").notNull().default("sampler"),
  status: text("status", { enum: ["idle", "running", "stopped", "saved"] }).notNull().default("idle"),
  windowMs: integer("window_ms").notNull().default(10000),
  intervalMs: integer("interval_ms").notNull().default(50),
  samples: integer("samples").notNull().default(0),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),
});

/* --------------------------------------------------------------------- cli */

export const cliTools = sqliteTable("cli_tools", {
  id: id(),
  name: text("name").notNull(),
  binary: text("binary").notNull(),
  baseArgs: text("base_args").notNull().default(""),
  cwd: text("cwd"),
  env: text("env", { mode: "json" }).$type<Record<string, string>>(),
  category: text("category").notNull().default("general"),
  favourite: integer("favourite", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ config */

export const configSources = sqliteTable("config_sources", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["compose", "terraform", "github", "dockerfile", "workspace"] }).notNull(),
  target: text("target").notNull(),
  content: text("content"),
  summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>(),
  status: text("status").notNull().default("loaded"),
  lastError: text("last_error"),
  lastLoadedAt: integer("last_loaded_at", { mode: "timestamp" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
