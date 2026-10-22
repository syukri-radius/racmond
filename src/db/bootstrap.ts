/**
 * Idempotent DDL for the dockflow database.
 *
 * Kept byte-for-byte in sync with `npx drizzle-kit push` output for
 * src/db/schema.ts. `client.executeMultiple()` runs this in one round-trip;
 * the runner falls back to splitting on ";" for clients that lack it.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS docker_hosts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'unix',
  is_default INTEGER NOT NULL DEFAULT false,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS docker_hosts_endpoint_idx ON docker_hosts (endpoint);

CREATE TABLE IF NOT EXISTS apm_services (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  team TEXT,
  kind TEXT NOT NULL DEFAULT 'service',
  runtime TEXT,
  sla_latency_ms REAL NOT NULL DEFAULT 300,
  sla_error_rate REAL NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS apm_services_key_idx ON apm_services (key);

CREATE TABLE IF NOT EXISTS apm_agents (
  id TEXT PRIMARY KEY NOT NULL,
  agent TEXT NOT NULL,
  service_key TEXT NOT NULL,
  host TEXT,
  runtime TEXT,
  last_seen_at INTEGER NOT NULL,
  span_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS apm_agents_agent_idx ON apm_agents (agent);

CREATE TABLE IF NOT EXISTS apm_spans (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  service_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'server',
  start_time INTEGER NOT NULL,
  duration_ms REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  error_message TEXT,
  tags TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS apm_spans_trace_idx ON apm_spans (trace_id);
CREATE INDEX IF NOT EXISTS apm_spans_start_idx ON apm_spans (start_time);
CREATE INDEX IF NOT EXISTS apm_spans_service_idx ON apm_spans (service_key, start_time);

CREATE TABLE IF NOT EXISTS apm_edges (
  id TEXT PRIMARY KEY NOT NULL,
  source_service TEXT NOT NULL,
  target_service TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  total_ms REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS apm_edges_pair_idx ON apm_edges (source_service, target_service);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  nodes TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT true,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  trigger TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT false,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON workflow_runs (workflow_id, started_at);

CREATE TABLE IF NOT EXISTS jvm_targets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'simulated',
  url TEXT,
  container_id TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jvm_dumps (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  path TEXT,
  summary TEXT,
  content TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jvm_dumps_target_idx ON jvm_dumps (target_id, created_at);

CREATE TABLE IF NOT EXISTS jvm_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'sampler',
  status TEXT NOT NULL DEFAULT 'idle',
  window_ms INTEGER NOT NULL DEFAULT 10000,
  interval_ms INTEGER NOT NULL DEFAULT 50,
  samples INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  started_at INTEGER NOT NULL,
  stopped_at INTEGER
);

CREATE TABLE IF NOT EXISTS cli_tools (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  binary TEXT NOT NULL,
  base_args TEXT NOT NULL DEFAULT '',
  cwd TEXT,
  env TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  favourite INTEGER NOT NULL DEFAULT false,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS config_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  content TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'loaded',
  last_error TEXT,
  last_loaded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** Splits a DDL script on statement boundaries, string-literal aware. */
export function splitStatements(script: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
