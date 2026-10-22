import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Every level of the enterprise hierarchy (organization -> sub-org -> project
 * -> datacenter -> server/container/pod -> service group -> service -> endpoint)
 * lives in one self referencing table. `parentId` + `extent: 'parent'` semantics
 * are enforced by the renderer, parents are always emitted before children.
 */
export const nodes = pgTable(
  "ops_nodes",
  {
    id: text("id").primaryKey(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    kind: text("kind"),
    status: text("status").notNull().default("healthy"),
    region: text("region"),
    owner: text("owner"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    /** manual drag offset (relative to the parent container) */
    x: real("x"),
    y: real("y"),
    sortOrder: integer("sort_order").notNull().default(0),
    collapsed: boolean("collapsed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ops_nodes_parent_idx").on(table.parentId), index("ops_nodes_type_idx").on(table.type)],
);

/** Latest metric snapshot for a monitored node (server / container / pod / service). */
export const metrics = pgTable(
  "ops_metrics",
  {
    nodeId: text("node_id")
      .primaryKey()
      .references(() => nodes.id, { onDelete: "cascade" }),
    cpu: real("cpu").notNull().default(0),
    memory: real("memory").notNull().default(0),
    disk: real("disk").notNull().default(0),
    networkIn: real("network_in").notNull().default(0),
    networkOut: real("network_out").notNull().default(0),
    requestsPerSec: real("requests_per_sec").notNull().default(0),
    errorRate: real("error_rate").notNull().default(0),
    latencyMs: real("latency_ms").notNull().default(0),
    uptimePct: real("uptime_pct").notNull().default(100),
    replicasReady: integer("replicas_ready").notNull().default(0),
    replicasDesired: integer("replicas_desired").notNull().default(0),
    /** prometheus | docker | kubernetes | agent */
    source: text("source").notNull().default("prometheus"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ops_metrics_updated_idx").on(table.updatedAt)],
);

/** Rolling time series used for sparklines (kept small: last N samples per node). */
export const metricSamples = pgTable(
  "ops_metric_samples",
  {
    id: serial("id").primaryKey(),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ops_samples_node_metric_ts_idx").on(table.nodeId, table.metric, table.ts),
  ],
);

/** Alert / audit stream surfaced in the live event log. */
export const events = pgTable(
  "ops_events",
  {
    id: serial("id").primaryKey(),
    nodeId: text("node_id").references(() => nodes.id, { onDelete: "cascade" }),
    severity: text("severity").notNull().default("info"),
    source: text("source").notNull().default("telemetry"),
    title: text("title").notNull(),
    detail: text("detail"),
    acknowledged: boolean("acknowledged").notNull().default(false),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("ops_events_ts_idx").on(table.ts), index("ops_events_node_idx").on(table.nodeId)],
);

/** CLI executor run log (runbooks / remote commands against a node). */
export const commandRuns = pgTable(
  "ops_command_runs",
  {
    id: serial("id").primaryKey(),
    nodeId: text("node_id").references(() => nodes.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    operator: text("operator").notNull().default("operator@noc"),
    status: text("status").notNull().default("running"),
    exitCode: integer("exit_code"),
    output: text("output").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("ops_command_runs_started_idx").on(table.startedAt)],
);

export type NodeRow = typeof nodes.$inferSelect;
export type MetricRow = typeof metrics.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type CommandRunRow = typeof commandRuns.$inferSelect;
