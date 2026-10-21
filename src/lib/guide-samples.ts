export const SAMPLE_CURL = `BASE=https://your-ops-host

# 1 — register parents BEFORE children (critical rule)
curl -s -X POST $BASE/api/ingest/nodes -H 'content-type: application/json' -d '{
  "id": "org-acme",
  "name": "Acme Corp",
  "type": "organization",
  "owner": "platform-team"
}'

curl -s -X POST $BASE/api/ingest/nodes -H 'content-type: application/json' -d '{
  "id": "org-acme::svc-billing",
  "parentId": "org-acme",
  "name": "billing-api",
  "type": "service",
  "kind": "php8.3 / laravel11",
  "region": "eu-west-1",
  "owner": "billing-squad",
  "meta": { "runtime": "php8.3", "protocol": "HTTP/2", "version": "v2.4.0" }
}'

curl -s -X POST $BASE/api/ingest/nodes -H 'content-type: application/json' -d '{
  "id": "org-acme::svc-billing::ep-charge",
  "parentId": "org-acme::svc-billing",
  "name": "POST /v1/charges",
  "type": "endpoint",
  "meta": { "method": "POST", "path": "/v1/charges", "slaMs": 350, "auth": "oauth2" }
}'

# 2 — push a metric snapshot (every 15–60s from cron/scheduler)
curl -s -X POST $BASE/api/ingest/metrics -H 'content-type: application/json' -d '{
  "nodeId": "org-acme::svc-billing",
  "cpu": 34.2, "memory": 58.1, "disk": 41.7,
  "requestsPerSec": 412.5, "errorRate": 0.21, "latencyMs": 132,
  "uptimePct": 99.97, "source": "prometheus"
}'

# 3 — raise an event (deploy, exception, SLO burn)
curl -s -X POST $BASE/api/ingest/events -H 'content-type: application/json' -d '{
  "nodeId": "org-acme::svc-billing",
  "severity": "warning",
  "source": "deploy-pipeline",
  "title": "Deployed billing-api v2.4.0",
  "detail": "ship abc1234 · 3/3 replicas ready"
}'

# 4 — read back + follow the live stream
curl -s $BASE/api/topology | head -c 400
curl -N $BASE/api/stream`;

export const SAMPLE_SSE = `// Consume the live channel from any frontend / Node service.
// The stream emits: hello → metrics (every 2s) → event → cli
const source = new EventSource("https://your-ops-host/api/stream");

source.onmessage = (raw) => {
  if (!raw.data) return; // keep-alive comment
  const msg = JSON.parse(raw.data);
  if (msg.type === "metrics") {
    for (const u of msg.updates) {
      // u = { nodeId, cpu, memory, disk, requestsPerSec, errorRate, latencyMs, status?, ... }
      if (u.status === "critical") onCritical(u);
    }
  }
  if (msg.type === "event") prependToAlertFeed(msg.event);
  if (msg.type === "cli") appendToRunLog(msg.run);
};

source.onerror = () => {
  // EventSource auto-retries; the server also sends : keep-alive every 15s
  console.warn("stream interrupted, retrying…");
};

function onCritical(update) {
  console.error("[critical]", update.nodeId, "cpu=" + update.cpu + "%");
}`;

export const SAMPLE_LARAVEL = `// File 1 — config/ops.php
<?php
return [
  "base"    => env("OPS_BASE", "https://your-ops-host"),
  "service" => env("OPS_SERVICE_ID", "org-acme::svc-billing"),
  "source"  => "laravel-agent",
  "timeout" => 4,
];

// File 2 — app/Services/OpsReporter.php
<?php
namespace App\\Services;

use Illuminate\\Support\\Facades\\Http;

class OpsReporter
{
  public function register(string $id, ?string $parentId, string $name, string $type, array $extra = []): void
  {
    Http::timeout(config("ops.timeout"))
      ->post(config("ops.base") . "/api/ingest/nodes", array_merge([
        "id" => $id, "parentId" => $parentId,
        "name" => $name, "type" => $type,
      ], $extra));
  }

  public function metrics(array $snapshot): void
  {
    Http::timeout(config("ops.timeout"))
      ->post(config("ops.base") . "/api/ingest/metrics", array_merge([
        "nodeId" => config("ops.service"), "source" => config("ops.source"),
      ], $snapshot));
  }

  public function event(string $title, string $severity = "info", ?string $detail = null): void
  {
    Http::timeout(config("ops.timeout"))
      ->post(config("ops.base") . "/api/ingest/events", [
        "nodeId" => config("ops.service"), "severity" => $severity,
        "source" => "laravel", "title" => $title, "detail" => $detail,
      ]);
  }

  /** Snapshot the current PHP worker: load, memory, opcache. */
  public function snapshot(float $rps = 0): array
  {
    $load = sys_getloadavg()[0] ?? 0;
    $cores = (int) trim((string) shell_exec("nproc 2>/dev/null") ?: "2");
    return [
      "cpu" => round(min(99, $load / max(1, $cores) * 100), 1),
      "memory" => round(memory_get_usage(true) / 134217728 * 100, 1), // vs 128M budget
      "disk" => round(disk_total_space("/") > 0
        ? (1 - disk_free_space("/") / disk_total_space("/")) * 100 : 0, 1),
      "requestsPerSec" => $rps,
      "errorRate" => 0.1,
      "latencyMs" => 120,
      "uptimePct" => 99.95,
    ];
  }
}

// File 3 — app/Console/Commands/OpsHeartbeat.php (runs every minute)
<?php
namespace App\\Console\\Commands;

use App\\Services\\OpsReporter;
use Illuminate\\Console\\Command;

class OpsHeartbeat extends Command
{
  protected $signature = "ops:heartbeat";
  protected $description = "Push health snapshot to Helios Ops";

  public function handle(OpsReporter $ops): int
  {
    $svc = config("ops.service");
    $ops->register("org-acme", null, "Acme Corp", "organization");
    $ops->register($svc, "org-acme", "billing-api", "service",
      ["kind" => "php8.3 / laravel11", "region" => "eu-west-1"]);
    $ops->metrics($ops->snapshot());
    $this->info("heartbeat sent for " . $svc);
    return self::SUCCESS;
  }
}
// Kernel schedule: $schedule->command("ops:heartbeat")->everyMinute();

// File 4 — app/Exceptions/Handler hook (report exceptions as events)
public function register(): void
{
  $this->reportable(function (Throwable $e) {
    try {
      app(OpsReporter::class)->event(
        "Exception: " . class_basename($e),
        "warning",
        substr($e->getMessage(), 0, 500)
      );
    } catch (Throwable) { /* never break the request */ }
  });
}`;

export const SAMPLE_SPRING = `// File 1 — src/main/resources/application.yml
ops:
  base: https://your-ops-host
  service-id: org-acme::svc-ledger
  parent-id: org-acme
  source: spring-agent

// File 2 — OpsReporter.java (WebClient, non-blocking)
package com.acme.ops;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import java.util.Map;

@Component
public class OpsReporter {
  private final WebClient http;
  private final String serviceId;
  public OpsReporter(WebClient.Builder builder,
      @Value("\${ops.base}") String base,
      @Value("\${ops.service-id}") String serviceId) {
    this.http = builder.baseUrl(base).build();
    this.serviceId = serviceId;
  }
  public void register(String id, String parentId, String name, String type, Map<String, Object> extra) {
    var body = new java.util.HashMap<String, Object>(
      Map.of("id", id, "name", name, "type", type));
    if (parentId != null) body.put("parentId", parentId);
    body.putAll(extra);
    http.post().uri("/api/ingest/nodes").bodyValue(body).retrieve().toBodilessEntity().subscribe();
  }
  public void metrics(double cpu, double mem, double disk, double rps, double err, double lat) {
    http.post().uri("/api/ingest/metrics").bodyValue(Map.of(
      "nodeId", serviceId, "cpu", cpu, "memory", mem, "disk", disk,
      "requestsPerSec", rps, "errorRate", err, "latencyMs", lat,
      "uptimePct", 99.97, "source", "spring-agent"
    )).retrieve().toBodilessEntity().subscribe();
  }
  public void event(String title, String severity, String detail) {
    http.post().uri("/api/ingest/events").bodyValue(Map.of(
      "nodeId", serviceId, "severity", severity, "source", "spring",
      "title", title, "detail", detail == null ? "" : detail
    )).retrieve().toBodilessEntity().subscribe();
  }
}

// File 3 — OpsHeartbeat.java (@Scheduled every 30s, Micrometer gauges)
package com.acme.ops;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.lang.management.ManagementFactory;
import java.util.Map;

@Component
public class OpsHeartbeat {
  private final OpsReporter ops; private final MeterRegistry registry;
  public OpsHeartbeat(OpsReporter ops, MeterRegistry registry) {
    this.ops = ops; this.registry = registry;
  }
  @Scheduled(fixedRate = 30000, initialDelay = 5000)
  public void beat() {
    ops.register("org-acme", null, "Acme Corp", "organization", Map.of());
    ops.register("org-acme::svc-ledger", "org-acme", "ledger-writer", "service",
      Map.of("kind", "java21 / spring", "region", "eu-west-1"));
    double cpu = ManagementFactory.getOperatingSystemMXBean().getSystemLoadAverage();
    double rps = registry.counter("http.server.requests").count();
    ops.metrics(Math.min(99, Math.max(0, cpu * 12)), 54.2, 38.9, rps, 0.12, 96);
  }
}

// File 4 — GlobalExceptionHandler.java → Ops events
package com.acme.ops;
import org.springframework.web.bind.annotation.*;
@ControllerAdvice
public class GlobalExceptionHandler {
  private final OpsReporter ops;
  public GlobalExceptionHandler(OpsReporter ops) { this.ops = ops; }
  @ExceptionHandler(Exception.class)
  @ResponseBody public Map<String, String> handle(Exception e) {
    ops.event("Exception: " + e.getClass().getSimpleName(), "warning",
      e.getMessage() == null ? "" : e.getMessage().substring(0, Math.min(500, e.getMessage().length())));
    return Map.of("error", "internal");
  }
}`;

export const SAMPLE_NODE = `// File 1 — ops-agent.js (drop into any Node.js service)
import os from "node:os";

const BASE = process.env.OPS_BASE ?? "https://your-ops-host";
const SERVICE_ID = process.env.OPS_SERVICE_ID ?? "org-acme::svc-checkout";
const PARENT_ID = process.env.OPS_PARENT_ID ?? "org-acme";
const SOURCE = "node-agent";

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) console.warn("[ops]", path, res.status, await res.text().catch(() => ""));
}

export async function registerTopology() {
  await post("/api/ingest/nodes", { id: PARENT_ID, name: "Acme Corp", type: "organization" });
  await post("/api/ingest/nodes", {
    id: SERVICE_ID, parentId: PARENT_ID, name: "checkout-api",
    type: "service", kind: "node20 / fastify", region: "eu-west-1",
    meta: { protocol: "HTTP/2", version: "v2.4.1" },
  });
  await post("/api/ingest/nodes", {
    id: SERVICE_ID + "::ep-session", parentId: SERVICE_ID,
    name: "POST /v1/checkout/session", type: "endpoint",
    meta: { method: "POST", path: "/v1/checkout/session", slaMs: 250, auth: "oauth2" },
  });
}

// File 2 — snapshot from Node process stats + your own counters
let requests = 0, errors = 0, latSum = 0;
export function observeRequest(latMs, failed) {
  requests += 1; latSum += latMs; if (failed) errors += 1;
}
function snapshot() {
  const load = os.loadavg()[0] / Math.max(1, os.cpus().length);
  const mem = process.memoryUsage();
  return {
    nodeId: SERVICE_ID,
    cpu: +Math.min(99, load * 100).toFixed(1),
    memory: +(mem.heapUsed / mem.heapTotal * 100).toFixed(1),
    disk: 38.4, // replace with 'diskusage' package if needed
    requestsPerSec: requests, // per-interval delta; reset after send
    errorRate: requests ? +(errors / requests * 100).toFixed(2) : 0,
    latencyMs: requests ? Math.round(latSum / requests) : 40,
    uptimePct: 99.98, source: SOURCE,
  };
}

// File 3 — heartbeat + Express error middleware
export function startHeartbeat(ms = 20000) {
  registerTopology().catch(console.warn);
  setInterval(async () => {
    try { await post("/api/ingest/metrics", snapshot()); }
    catch (e) { console.warn("[ops] heartbeat failed", e.message); }
    requests = 0; errors = 0; latSum = 0;
  }, ms).unref?.();
}

// express usage:
// import express from "express";
// app.use((req, res, next) => {
//   const t = Date.now();
//   res.on("finish", () => observeRequest(Date.now() - t, res.statusCode >= 500));
//   next();
// });
// app.use((err, req, res, next) => {
//   post("/api/ingest/events", {
//     nodeId: SERVICE_ID, severity: "warning", source: "express",
//     title: "Unhandled: " + (err.message || "error").slice(0, 120),
//   }).catch(() => {});
//   next(err);
// });`;

export const SAMPLE_GO = `// File — internal/ops/reporter.go
package ops

import (
  "bytes"
  "encoding/json"
  "net/http"
  "os"
  "time"
)

var (
  Base      = env("OPS_BASE", "https://your-ops-host")
  ServiceID = env("OPS_SERVICE_ID", "org-acme::svc-cart")
  ParentID  = env("OPS_PARENT_ID", "org-acme")
  client    = &http.Client{Timeout: 4 * time.Second}
)

func env(k, d string) string { if v := os.Getenv(k); v != "" { return v }; return d }

func post(path string, body any) {
  b, _ := json.Marshal(body)
  req, _ := http.NewRequest("POST", Base+path, bytes.NewReader(b))
  req.Header.Set("content-type", "application/json")
  resp, err := client.Do(req)
  if err != nil || resp.StatusCode >= 300 {
    return // never fail the business request for telemetry
  }
  resp.Body.Close()
}

// Register parents BEFORE children — call once at boot.
func RegisterTopology() {
  post("/api/ingest/nodes", map[string]any{
    "id": ParentID, "name": "Acme Corp", "type": "organization",
  })
  post("/api/ingest/nodes", map[string]any{
    "id": ServiceID, "parentId": ParentID, "name": "cart-service",
    "type": "service", "kind": "go1.24 / chi", "region": "eu-west-1",
    "meta": map[string]any{"protocol": "gRPC", "version": "v1.9.2"},
  })
  post("/api/ingest/nodes", map[string]any{
    "id": ServiceID + "::ep-price", "parentId": ServiceID,
    "name": "RPC cart.v1.CartService/Price", "type": "endpoint",
    "meta": map[string]any{"method": "RPC", "path": "cart.v1.CartService/Price", "slaMs": 140},
  })
}

type Snapshot struct {
  CPU, Mem, Disk, RPS, Err, Lat float64
}

// Push from a ticker — collect CPU with gopsutil or runtime.MemStats.
func Heartbeat(every time.Duration, collect func() Snapshot) {
  RegisterTopology()
  t := time.NewTicker(every)
  defer t.Stop()
  for range t.C {
    s := collect()
    post("/api/ingest/metrics", map[string]any{
      "nodeId": ServiceID, "cpu": s.CPU, "memory": s.Mem, "disk": s.Disk,
      "requestsPerSec": s.RPS, "errorRate": s.Err, "latencyMs": s.Lat,
      "uptimePct": 99.99, "source": "go-agent",
    })
  }
}

func Event(title, severity, detail string) {
  post("/api/ingest/events", map[string]any{
    "nodeId": ServiceID, "severity": severity, "source": "go",
    "title": title, "detail": detail,
  })
}

// Chi middleware example:
// func Observe(next http.Handler) http.Handler {
//   return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
//     t := time.Now()
//     rec := &statusRecorder{ResponseWriter: w, code: 200}
//     next.ServeHTTP(rec, r)
//     atomic.AddInt64(&reqCount, 1)
//     if rec.code >= 500 {
//       Event("HTTP 5xx "+r.URL.Path, "warning", http.StatusText(rec.code))
//     }
//     _ = t
//   })
// }`;

export const SAMPLE_RUST = `// Cargo.toml
// [dependencies]
// tokio = { version = "1", features = ["full"] }
// axum = "0.7"
// reqwest = { version = "0.12", features = ["json", "rustls-tls"] }
// serde = { version = "1", features = ["derive"] }
// sysinfo = "0.30"

use reqwest::Client;
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
struct Node<'a> {
  id: &'a str,
  #[serde(skip_serializing_if = "Option::is_none")] parentId: Option<&'a str>,
  name: &'a str,
  #[serde(rename = "type")] kind: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Metrics {
  node_id: String,
  cpu: f32, memory: f32, disk: f32,
  requests_per_sec: f64, error_rate: f64, latency_ms: f64,
  uptime_pct: f64, source: String,
}

#[derive(Clone)]
pub struct OpsReporter { http: Client, base: String, service: String }

impl OpsReporter {
  pub fn new(base: &str, service: &str) -> Self {
    Self {
      http: Client::builder().timeout(Duration::from_secs(4)).build().unwrap(),
      base: base.into(), service: service.into(),
    }
  }
  pub async fn register_topology(&self) {
    let nodes = vec![
      Node { id: "org-acme", parentId: None, name: "Acme Corp", kind: "organization" },
      Node { id: &self.service, parentId: Some("org-acme"),
             name: "ledger-writer", kind: "service" },
    ];
    for n in nodes {
      let _ = self.http.post(format!("{}/api/ingest/nodes", self.base))
        .json(&n).send().await;
    }
  }
  pub async fn heartbeat(&self, sys: &mut sysinfo::System) {
    sys.refresh_cpu_all(); sys.refresh_memory();
    let cpu = sys.global_cpu_usage();
    let mem = sys.used_memory() as f32 / sys.total_memory() as f32 * 100.0;
    let body = Metrics {
      node_id: self.service.clone(),
      cpu, memory: mem, disk: 36.2,
      requests_per_sec: 880.0, error_rate: 0.05, latency_ms: 62.0,
      uptime_pct: 99.995, source: "rust-agent".into(),
    };
    let _ = self.http.post(format!("{}/api/ingest/metrics", self.base))
      .json(&body).send().await;
  }
  pub async fn event(&self, title: &str, severity: &str) {
    let _ = self.http.post(format!("{}/api/ingest/events", self.base))
      .json(&serde_json::json!({
        "nodeId": self.service, "severity": severity,
        "source": "rust", "title": title,
      })).send().await;
  }
}

// Axum wiring (main.rs):
// let ops = OpsReporter::new("https://your-ops-host", "org-acme::svc-ledger-writer");
// ops.register_topology().await;
// let tick_ops = ops.clone();
// tokio::spawn(async move {
//   let mut sys = sysinfo::System::new_all();
//   loop { tick_ops.heartbeat(&mut sys).await;
//         tokio::time::sleep(Duration::from_secs(20)).await; }
// });
// // error → event: ops.event("panic recovered in journal append", "critical").await;`;

export const SAMPLE_PYTHON = `"""ops_agent.py — import into FastAPI / Flask / Django / workers."""
import os, socket, time, traceback
import requests

BASE = os.getenv("OPS_BASE", "https://your-ops-host")
SERVICE_ID = os.getenv("OPS_SERVICE_ID", "org-acme::svc-fraud")
PARENT_ID = os.getenv("OPS_PARENT_ID", "org-acme")
SOURCE = "python-agent"
TIMEOUT = 4

_session = requests.Session()

def _post(path, payload):
    try:
        r = _session.post(BASE + path, json=payload, timeout=TIMEOUT)
        if r.status_code >= 300:
            print(f"[ops] {path} -> {r.status_code} {r.text[:200]}")
    except Exception as e:  # telemetry must never crash the app
        print(f"[ops] {path} failed: {e}")

def register_topology():
    _post("/api/ingest/nodes", {"id": PARENT_ID, "name": "Acme Corp", "type": "organization"})
    _post("/api/ingest/nodes", {
        "id": SERVICE_ID, "parentId": PARENT_ID, "name": "fraud-scorer",
        "type": "service", "kind": "python3.13 / triton",
        "region": "eu-west-1", "owner": "risk-squad",
        "meta": {"protocol": "gRPC", "version": "v3.1.0"},
    })
    _post("/api/ingest/nodes", {
        "id": SERVICE_ID + "::ep-score", "parentId": SERVICE_ID,
        "name": "RPC risk.v1.Scorer/Score", "type": "endpoint",
        "meta": {"method": "RPC", "path": "risk.v1.Scorer/Score", "slaMs": 70},
    })

def push_metrics(cpu, memory, disk=42.0, rps=0.0, error_rate=0.0, latency_ms=65.0):
    _post("/api/ingest/metrics", {
        "nodeId": SERVICE_ID, "cpu": cpu, "memory": memory, "disk": disk,
        "requestsPerSec": rps, "errorRate": error_rate, "latencyMs": latency_ms,
        "uptimePct": 99.96, "source": SOURCE,
    })

def raise_event(title, severity="info", detail=None):
    _post("/api/ingest/events", {
        "nodeId": SERVICE_ID, "severity": severity, "source": "python",
        "title": title, "detail": detail,
    })

# FastAPI middleware — measures every request, reports 5xx as events
# from fastapi import Request
# from starlette.middleware.base import BaseHTTPMiddleware
# import psutil
#
# class OpsMiddleware(BaseHTTPMiddleware):
#     async def dispatch(self, request: Request, call_next):
#         t0 = time.perf_counter()
#         try:
#             resp = await call_next(request)
#         except Exception:
#             raise_event("Unhandled: " + request.url.path, "critical", traceback.format_exc()[-800:])
#             raise
#         dt = (time.perf_counter() - t0) * 1000
#         if resp.status_code >= 500:
#             raise_event(f"HTTP 5xx {request.url.path}", "warning", f"status={resp.status_code} dt={dt:.0f}ms")
#         return resp
#
# # Worker heartbeat (every 30s):
# # register_topology()
# # while True:
# #     push_metrics(cpu=psutil.cpu_percent(), memory=psutil.virtual_memory().percent, rps=120.0)
# #     time.sleep(30)`;

export const SAMPLE_DATABASE = `-- Pattern A · Postgres watchdog via pg_cron + pg_net (push, no app changes)
-- 1) extensions (run once as superuser)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) every minute: report table bloat + long queries as metrics on a service node
SELECT cron.schedule(
  'ops-db-heartbeat', '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-ops-host/api/ingest/metrics',
    headers := '{"content-type":"application/json"}'::jsonb,
    body := jsonb_build_object(
      'nodeId', 'org-acme::svc-postgres-primary',
      'cpu', (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') * 4.5,
      'memory', 62.0, 'disk',
        (SELECT round((1 - sum(pg_stat_get_db_blocks_fetched(oid) - pg_stat_get_db_blocks_hit(oid))::float
          / nullif(sum(pg_stat_get_db_blocks_fetched(oid)),0)) * 100, 1) FROM pg_database),
      'requestsPerSec', (SELECT count(*) FROM pg_stat_activity),
      'errorRate', 0.05, 'latencyMs',
        (SELECT coalesce(round(avg(extract(epoch from (now() - query_start)) * 1000)), 40)
         FROM pg_stat_activity WHERE state = 'active'),
      'uptimePct', 99.99, 'source', 'postgres-agent'
    )
  );
  $$
);

-- Pattern B · trigger: every failed payment insert raises an Ops event
CREATE OR REPLACE FUNCTION ops_notify_payment_failure() RETURNS trigger AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'nodeId', 'org-acme::svc-payments',
    'severity', 'warning', 'source', 'postgres-trigger',
    'title', 'Payment insert failed: ' || NEW.id,
    'detail', 'amount=' || NEW.amount || ' currency=' || NEW.currency
  );
  PERFORM net.http_post(
    url := 'https://your-ops-host/api/ingest/events',
    headers := '{"content-type":"application/json"}'::jsonb,
    body := payload
  );
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- DROP TRIGGER IF EXISTS trg_payment_fail ON payments;
-- CREATE TRIGGER trg_payment_fail AFTER INSERT ON payments
-- FOR EACH ROW WHEN (NEW.status = 'failed')
-- EXECUTE FUNCTION ops_notify_payment_failure();

-- Pattern C · no pg_net? Use a 10-line cron sidecar instead:
-- * * * * * psql $DATABASE_URL -tAc "SELECT count(*) FROM pg_stat_activity WHERE state='active'" \\
--   | xargs -I{} curl -s -X POST https://your-ops-host/api/ingest/metrics \\
--   -H 'content-type: application/json' \\
--   -d '{"nodeId":"org-acme::svc-postgres-primary","cpu":{},"memory":60,"disk":44,"requestsPerSec":120,"errorRate":0.1,"latencyMs":55}'`;

export const SAMPLE_MINIO = `# MinIO → Helios Ops: bucket events become dock alerts + storage gauges.
# Architecture: MinIO --webhook--> tiny bridge (30 lines) --> /api/ingest/events|metrics

# 1 — point MinIO at the bridge (mc or env)
mc admin config set myminio notify_webhook:ops \\
  endpoint="http://ops-bridge:8080/minio-webhook" queue_limit="100" \\
  auth_token="replace-with-long-random"
mc admin service restart myminio
mc event add myminio/reports arn:minio:sqs::ops:webhook --event put,delete --prefix "reports/"

# 2 — ops-bridge.py (run next to MinIO; verifies + maps to Ops)
import hmac, hashlib, os
from flask import Flask, request
import requests

OPS = os.getenv("OPS_BASE", "https://your-ops-host")
TOKEN = os.getenv("MINIO_WEBHOOK_TOKEN", "replace-with-long-random")
STORAGE_NODE = "org-acme::srv-minio-01"
app = Flask(__name__)

def ops(path, payload):
    requests.post(OPS + path, json=payload, timeout=4)

@app.post("/minio-webhook")
def webhook():
    # optional shared-secret check (configure MinIO auth_token the same)
    if request.headers.get("x-minio-token", TOKEN) != TOKEN:
        return {"error": "unauthorized"}, 401
    evt = request.get_json(force=True, silent=True) or {}
    records = evt.get("Records", [evt])
    for r in records:
        key = (r.get("s3", {}).get("object", {}).get("key") or "unknown")
        name = r.get("eventName", "s3:ObjectCreated")
        size = r.get("s3", {}).get("object", {}).get("size", 0) or 0
        severity = "warning" if ("Delete" in name or "Failed" in name) else "info"
        ops("/api/ingest/events", {
            "nodeId": STORAGE_NODE, "severity": severity, "source": "minio",
            "title": f"{name} · {key}",
            "detail": f"bucket={r.get('s3', {}).get('bucket', {}).get('name')} size={size}b",
        })
    # also nudge the disk gauge — replace with real 'mc admin info' parsing
    ops("/api/ingest/metrics", {
        "nodeId": STORAGE_NODE, "cpu": 18.2, "memory": 44.7, "disk": 68.9,
        "requestsPerSec": len(records) * 2.0, "errorRate": 0.0,
        "latencyMs": 22.0, "uptimePct": 99.99, "source": "minio-agent",
    })
    return {"ok": True}

# 3 — register the storage node once (parents first!)
# curl -X POST $OPS/api/ingest/nodes -H 'content-type: application/json' -d '{
#   "id": "org-acme::srv-minio-01", "parentId": "org-acme",
#   "name": "minio-01", "type": "server", "kind": "bare-metal",
#   "region": "eu-west-1", "meta": {"role": "object-storage", "engine": "minio RELEASE.2026"}
# }'`;
