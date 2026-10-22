import type {
  ContainerHealth,
  ContainerInfo,
  ContainerState,
  ContainerStats,
  EngineAdapter,
  EngineInfo,
  ExecResult,
  ImageInfo,
  LogOptions,
  NetworkAttachment,
  NetworkInfo,
  PortMapping,
  PruneResult,
  RunSpec,
  VolumeInfo,
} from "./types";
import { stateTone } from "./types";

/**
 * Demo engine — a first-class in-memory Docker Engine simulator.
 *
 * It is used whenever no real endpoint answers, so every page stays fully
 * functional inside a sandbox without a daemon. State lives on globalThis so
 * Next's dev/prod module re-evaluation does not re-seed it. Actions mutate the
 * state, logs keep growing and stats keep jittering.
 */

interface DemoContainer {
  id: string;
  name: string;
  image: string;
  imageId: string;
  command: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  state: ContainerState;
  health: ContainerHealth;
  exitCode: number | null;
  restartCount: number;
  composeProject: string | null;
  composeService: string | null;
  ports: PortMapping[];
  networks: NetworkAttachment[];
  mounts: { type: string; source: string; destination: string; mode: string }[];
  env: string[];
  baseCpu: number;
  baseMem: number;
  memoryLimitBytes: number;
  pids: number;
  history: { cpu: number[]; memory: number[]; net: number[]; block: number[] };
  logLines: string[];
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
  lastLogAt: number;
  oom?: boolean;
}

interface DemoState {
  containers: DemoContainer[];
  volumes: (VolumeInfo & { createdAtMs: number })[];
  networks: NetworkInfo[];
  prunedImages: Set<string>;
  tick: number;
  starter: number;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

function hex(seed: string, length = 64): string {
  let out = "";
  let h = 2166136261;
  for (let i = 0; out.length < length; i += 1) {
    h ^= seed.charCodeAt(i % seed.length) + i;
    h = Math.imul(h, 16777619);
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

function agoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function logStamp(offsetSeconds = 0): string {
  return new Date(Date.now() - offsetSeconds * 1000).toISOString();
}

function seedHistory(base: number, spread: number): number[] {
  const out: number[] = [];
  let value = base;
  for (let i = 0; i < 30; i += 1) {
    value = Math.max(1, Math.min(99, value + (Math.random() - 0.5) * spread));
    out.push(Number(value.toFixed(1)));
  }
  return out;
}

function ports(pairs: [number, number | null, string?][]): PortMapping[] {
  return pairs.map(([containerPort, hostPort, protocol]) => ({
    containerPort,
    hostPort,
    hostIp: hostPort ? "0.0.0.0" : null,
    protocol: protocol ?? "tcp",
  }));
}

function buildSeed(): DemoState {
  const project = "vega-shop";
  const obs = "observability";
  const mk = (
    name: string,
    image: string,
    options: Partial<DemoContainer> & { composeService?: string | null; composeProject?: string | null },
  ): DemoContainer => {
    const id = hex(`${name}:${image}`);
    const base: DemoContainer = {
      id,
      name,
      image,
      imageId: `sha256:${hex(`image:${image}`)}`,
      command: options.command ?? "/entrypoint.sh",
      createdAt: Date.now() - 9 * 86_400_000,
      startedAt: Date.now() - 3 * 3_600_000,
      finishedAt: null,
      state: "running",
      health: "healthy",
      exitCode: null,
      restartCount: 0,
      composeProject: project,
      composeService: options.composeService ?? null,
      ports: [],
      networks: [{ name: `${project}_default`, ipAddress: `172.19.0.${20 + Math.floor(Math.random() * 180)}` }],
      mounts: [],
      env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
      baseCpu: 4,
      baseMem: 120 * MB,
      memoryLimitBytes: 2 * GB,
      pids: 18,
      history: { cpu: [], memory: [], net: [], block: [] },
      logLines: [],
      netRx: 0,
      netTx: 0,
      blockRead: 0,
      blockWrite: 0,
      lastLogAt: Date.now(),
      ...options,
    };
    base.composeProject = options.composeProject === undefined ? project : options.composeProject;
    base.composeService = options.composeService === undefined ? name : options.composeService;
    base.history = {
      cpu: seedHistory(base.baseCpu, 6),
      memory: seedHistory((base.baseMem / base.memoryLimitBytes) * 100, 3),
      net: seedHistory(36, 14),
      block: seedHistory(12, 8),
    };
    return base;
  };

  const containers: DemoContainer[] = [
    mk("vega-shop-gateway-1", "nginx:1.27-alpine", {
      composeService: "gateway",
      ports: ports([
        [80, 8080],
        [443, 8443],
      ]),
      command: "nginx -g 'daemon off;'",
      baseCpu: 6,
      baseMem: 84 * MB,
      pids: 9,
      env: ["NGINX_VERSION=1.27.1", "PKG_RELEASE=1", "UPSTREAM_API=http://api:3000"],
      logLines: [
        '172.19.0.1 - - [10/Oct/2026:09:14:02 +0000] "GET /healthz HTTP/1.1" 200 2 "-" "kube-probe/1.30"',
        '172.19.0.44 - - [10/Oct/2026:09:14:07 +0000] "GET /api/catalog?page=2 HTTP/1.1" 200 18342 "-" "Mozilla/5.0"',
        '172.19.0.44 - - [10/Oct/2026:09:14:09 +0000] "POST /api/orders HTTP/1.1" 201 812 "-" "Mozilla/5.0"',
        '172.19.0.61 - - [10/Oct/2026:09:14:12 +0000] "GET /api/orders/8841 HTTP/1.1" 502 154 "-" "checkout-worker"',
      ],
    }),
    mk("vega-shop-api-1", "ghcr.io/vega/shop-api:2.14.3", {
      composeService: "api",
      ports: ports([[3000, 3000]]),
      command: "node dist/server.js",
      baseCpu: 34,
      baseMem: 512 * MB,
      pids: 42,
      env: ["NODE_ENV=production", "DATABASE_URL=postgres://vega:***@postgres:5432/shop", "REDIS_URL=redis://redis:6379", "RABBITMQ_URL=amqp://rabbitmq:5672", "OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317"],
      logLines: [
        "info: api listening on :3000 (pid 1)",
        "info: connected postgres pool size=10",
        "info: redis ready",
        "warn: orders upstream responded 502 in 1884ms (retry 1/3)",
        "info: GET /api/catalog 200 41ms",
        "info: POST /api/orders 201 96ms",
      ],
    }),
    mk("vega-shop-auth-1", "ghcr.io/vega/auth:1.9.0", {
      composeService: "auth",
      command: "java -jar /app/auth.jar",
      baseCpu: 12,
      baseMem: 380 * MB,
      pids: 31,
      env: ["JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70", "SPRING_PROFILES_ACTIVE=prod", "JWKS_ROTATION_DAYS=7"],
      logLines: [
        "Started AuthApplication in 6.812 seconds (process running for 7.44)",
        "o.s.b.a.e.web.EndpointLinksResolver : Exposing 3 endpoint(s) beneath base path '/actuator'",
        "issued access token sub=usr_8841 ttl=900s",
        "token introspection ok client=checkout-worker",
      ],
    }),
    mk("vega-shop-catalog-1", "ghcr.io/vega/catalog:3.2.1", {
      composeService: "catalog",
      command: "java -jar /app/catalog.jar",
      baseCpu: 18,
      baseMem: 448 * MB,
      pids: 34,
      env: ["JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=70", "CACHE_TTL=120"],
      logLines: [
        "Started CatalogApplication in 7.221 seconds",
        "cache warm: 4,182 skus in 812ms",
        "GET /api/catalog page=2 size=48 cache=hit 12ms",
      ],
    }),
    mk("vega-shop-orders-1", "ghcr.io/vega/orders:4.0.2", {
      composeService: "orders",
      state: "restarting",
      health: "unhealthy",
      exitCode: 137,
      restartCount: 7,
      command: "./orders --config /etc/orders.yaml",
      baseCpu: 2,
      baseMem: 1.9 * GB,
      memoryLimitBytes: 2 * GB,
      pids: 0,
      oom: true,
      env: ["ORDERS_DB=postgres://postgres:5432/orders", "ORDER_CONCURRENCY=32"],
      logLines: [
        "orders: starting worker pool size=32",
        "orders: loaded 12,004 pending orders",
        "orders: consumer prefetch=64 queue=orders.created",
        "fatal: runtime: out of memory: cannot allocate 134217728-byte block",
        "fatal: out of memory (OOM) — container killed with exit code 137 (limit 2GiB)",
      ],
    }),
    mk("vega-shop-jobs-1", "ghcr.io/vega/jobs:1.4.0", {
      composeService: "jobs",
      state: "exited",
      health: "none",
      exitCode: 0,
      command: "./jobs nightly-reconcile",
      baseCpu: 0,
      baseMem: 64 * MB,
      pids: 0,
      finishedAt: Date.now() - 5 * 3_600_000,
      logLines: ["job nightly-reconcile started", "processed 41,882 ledger rows", "0 discrepancies", "exit 0"],
    }),
    mk("vega-shop-postgres-1", "postgres:16.4", {
      composeService: "postgres",
      ports: ports([[5432, 5432]]),
      command: "postgres",
      baseCpu: 14,
      baseMem: 768 * MB,
      pids: 24,
      env: ["POSTGRES_DB=shop", "POSTGRES_USER=vega", "POSTGRES_PASSWORD=***", "PGDATA=/var/lib/postgresql/data"],
      mounts: [{ type: "volume", source: "vega-shop_pgdata", destination: "/var/lib/postgresql/data", mode: "rw" }],
      networks: [{ name: "vega-shop_backend", ipAddress: "172.20.0.11" }],
      logLines: [
        "LOG:  database system is ready to accept connections",
        "LOG:  checkpoint starting: time",
        "LOG:  checkpoint complete: wrote 1891 buffers (11.5%)",
        "LOG:  duration: 34.221 ms  statement: SELECT * FROM orders WHERE status=$1 LIMIT 50",
      ],
    }),
    mk("vega-shop-redis-1", "redis:7.4-alpine", {
      composeService: "redis",
      ports: ports([[6379, 6379]]),
      command: "redis-server --appendonly yes",
      baseCpu: 3,
      baseMem: 96 * MB,
      pids: 6,
      env: ["REDIS_APPENDONLY=yes"],
      mounts: [{ type: "volume", source: "vega-shop_redisdata", destination: "/data", mode: "rw" }],
      networks: [{ name: "vega-shop_backend", ipAddress: "172.20.0.12" }],
      logLines: ["* Ready to accept connections tcp", "* Background saving started by pid 42", "* Background saving terminated with success"],
    }),
    mk("vega-shop-rabbitmq-1", "rabbitmq:3.13-management", {
      composeService: "rabbitmq",
      ports: ports([
        [5672, 5672],
        [15672, 15672],
      ]),
      command: "rabbitmq-server",
      baseCpu: 7,
      baseMem: 214 * MB,
      pids: 27,
      env: ["RABBITMQ_DEFAULT_USER=vega", "RABBITMQ_DEFAULT_PASS=***"],
      networks: [{ name: "vega-shop_backend", ipAddress: "172.20.0.13" }],
      logLines: ["Server startup complete; 4 plugins started", "accepting AMQP connection 172.20.0.21:51842", "closing AMQP connection 172.20.0.21:51842 (0 bytes)"],
    }),
    mk("observability-prometheus-1", "prom/prometheus:v2.54.1", {
      composeProject: obs,
      composeService: "prometheus",
      ports: ports([[9090, 9090]]),
      command: "--config.file=/etc/prometheus/prometheus.yml",
      baseCpu: 11,
      baseMem: 420 * MB,
      pids: 16,
      networks: [{ name: `${obs}_default`, ipAddress: "172.21.0.11" }],
      mounts: [{ type: "volume", source: "observability_prometheus-data", destination: "/prometheus", mode: "rw" }],
      logLines: ['msg="Server is ready to receive web requests."', 'msg="Completed loading of configuration file"', 'msg="TSDB started"'],
    }),
    mk("observability-grafana-1", "grafana/grafana:11.2.0", {
      composeProject: obs,
      composeService: "grafana",
      ports: ports([[3000, 3001]]),
      command: "/run.sh",
      baseCpu: 5,
      baseMem: 186 * MB,
      pids: 12,
      networks: [{ name: `${obs}_default`, ipAddress: "172.21.0.12" }],
      mounts: [{ type: "volume", source: "observability_grafana-data", destination: "/var/lib/grafana", mode: "rw" }],
      logLines: ["logger=settings log_level=info", "HTTP Server Listen address=[::]:3000", "Migrating from 0 to 1"],
    }),
    mk("observability-otel-collector-1", "otel/opentelemetry-collector-contrib:0.109.0", {
      composeProject: obs,
      composeService: "otel-collector",
      ports: ports([
        [4317, 4317],
        [4318, 4318],
        [8889, 8889],
      ]),
      command: "--config=/etc/otel/config.yaml",
      baseCpu: 9,
      baseMem: 158 * MB,
      pids: 14,
      networks: [{ name: `${obs}_default`, ipAddress: "172.21.0.13" }],
      logLines: ["Everything is ready. Begin running and processing data.", "TracesExporter started", "batch span processor started"],
    }),
    mk("petclinic", "spring-petclinic:3.3.0", {
      composeProject: null,
      composeService: null,
      ports: ports([[8080, 8081]]),
      command: "java -jar /app/petclinic.jar",
      baseCpu: 8,
      baseMem: 512 * MB,
      pids: 29,
      networks: [{ name: "bridge", ipAddress: "172.17.0.4" }],
      env: ["JAVA_TOOL_OPTIONS=-Xmx512m", "SPRING_PROFILES_ACTIVE=default"],
      logLines: ["Started PetClinicApplication in 5.422 seconds", "Tomcat started on port 8080 (http)", "Mapped GET /owners"],
    }),
    mk("edge-proxy", "traefik:v3.1", {
      composeProject: null,
      composeService: null,
      state: "exited",
      health: "none",
      exitCode: 1,
      command: "--providers.docker",
      baseCpu: 0,
      baseMem: 32 * MB,
      pids: 0,
      finishedAt: Date.now() - 26 * 3_600_000,
      networks: [{ name: "bridge", ipAddress: "172.17.0.5" }],
      logLines: [
        "configuration loaded from flags",
        "command traefik error: field not found, node: providers",
        "exit status 1",
      ],
    }),
  ];

  const volumes: (VolumeInfo & { createdAtMs: number })[] = [
    {
      name: "vega-shop_pgdata",
      driver: "local",
      mountpoint: "/var/lib/docker/volumes/vega-shop_pgdata/_data",
      sizeBytes: 2.4 * GB,
      createdAt: agoIso(38),
      usedBy: ["vega-shop-postgres-1"],
      inUse: true,
      createdAtMs: Date.now() - 38 * 86_400_000,
    },
    {
      name: "vega-shop_redisdata",
      driver: "local",
      mountpoint: "/var/lib/docker/volumes/vega-shop_redisdata/_data",
      sizeBytes: 84 * MB,
      createdAt: agoIso(38),
      usedBy: ["vega-shop-redis-1"],
      inUse: true,
      createdAtMs: Date.now() - 38 * 86_400_000,
    },
    {
      name: "shop-uploads",
      driver: "local",
      mountpoint: "/var/lib/docker/volumes/shop-uploads/_data",
      sizeBytes: 12.8 * GB,
      createdAt: agoIso(21),
      usedBy: [],
      inUse: false,
      createdAtMs: Date.now() - 21 * 86_400_000,
    },
    {
      name: "observability_prometheus-data",
      driver: "local",
      mountpoint: "/var/lib/docker/volumes/observability_prometheus-data/_data",
      sizeBytes: 6.1 * GB,
      createdAt: agoIso(64),
      usedBy: ["observability-prometheus-1"],
      inUse: true,
      createdAtMs: Date.now() - 64 * 86_400_000,
    },
    {
      name: "observability_grafana-data",
      driver: "local",
      mountpoint: "/var/lib/docker/volumes/observability_grafana-data/_data",
      sizeBytes: 42 * MB,
      createdAt: agoIso(64),
      usedBy: ["observability-grafana-1"],
      inUse: true,
      createdAtMs: Date.now() - 64 * 86_400_000,
    },
    {
      name: "traefik-acme",
      driver: "local",
      mountpoint: "/var/lib/docker/volumes/traefik-acme/_data",
      sizeBytes: 4 * MB,
      createdAt: agoIso(120),
      usedBy: [],
      inUse: false,
      createdAtMs: Date.now() - 120 * 86_400_000,
    },
  ];

  const networks: NetworkInfo[] = [
    {
      id: hex("net:vega-shop_default", 64),
      name: "vega-shop_default",
      driver: "bridge",
      scope: "local",
      internal: false,
      subnet: "172.19.0.0/16",
      gateway: "172.19.0.1",
      created: agoIso(38),
      containers: containers
        .filter((c) => c.networks.some((n) => n.name === "vega-shop_default"))
        .map((c) => ({
          id: c.id.slice(0, 12),
          name: c.name,
          ipv4: c.networks.find((n) => n.name === "vega-shop_default")?.ipAddress ?? "",
        })),
    },
    {
      id: hex("net:vega-shop_backend", 64),
      name: "vega-shop_backend",
      driver: "bridge",
      scope: "local",
      internal: true,
      subnet: "172.20.0.0/16",
      gateway: "172.20.0.1",
      created: agoIso(38),
      containers: containers
        .filter((c) => c.networks.some((n) => n.name === "vega-shop_backend"))
        .map((c) => ({
          id: c.id.slice(0, 12),
          name: c.name,
          ipv4: c.networks.find((n) => n.name === "vega-shop_backend")?.ipAddress ?? "",
        })),
    },
    {
      id: hex("net:observability_default", 64),
      name: "observability_default",
      driver: "bridge",
      scope: "local",
      internal: false,
      subnet: "172.21.0.0/16",
      gateway: "172.21.0.1",
      created: agoIso(64),
      containers: containers
        .filter((c) => c.networks.some((n) => n.name === "observability_default"))
        .map((c) => ({
          id: c.id.slice(0, 12),
          name: c.name,
          ipv4: c.networks.find((n) => n.name === "observability_default")?.ipAddress ?? "",
        })),
    },
    {
      id: hex("net:bridge", 64),
      name: "bridge",
      driver: "bridge",
      scope: "local",
      internal: false,
      subnet: "172.17.0.0/16",
      gateway: "172.17.0.1",
      created: agoIso(220),
      containers: containers
        .filter((c) => c.networks.some((n) => n.name === "bridge"))
        .map((c) => ({
          id: c.id.slice(0, 12),
          name: c.name,
          ipv4: c.networks.find((n) => n.name === "bridge")?.ipAddress ?? "",
        })),
    },
    {
      id: hex("net:host", 64),
      name: "host",
      driver: "host",
      scope: "local",
      internal: false,
      subnet: null,
      gateway: null,
      created: agoIso(220),
      containers: [],
    },
    {
      id: hex("net:none", 64),
      name: "none",
      driver: "null",
      scope: "local",
      internal: true,
      subnet: null,
      gateway: null,
      created: agoIso(220),
      containers: [],
    },
  ];

  return { containers, volumes, networks, prunedImages: new Set(), tick: 0, starter: Date.now() };
}

const globalForDemo = globalThis as typeof globalThis & { __dockflowDemo?: DemoState };

function state(): DemoState {
  if (!globalForDemo.__dockflowDemo) globalForDemo.__dockflowDemo = buildSeed();
  return globalForDemo.__dockflowDemo;
}

function jitter(value: number, spread: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value + (Math.random() - 0.5) * spread));
}

function imageName(tag: string): { repo: string; tag: string } {
  const idx = tag.lastIndexOf(":");
  const slash = tag.lastIndexOf("/");
  if (idx > slash) return { repo: tag.slice(0, idx), tag: tag.slice(idx + 1) };
  return { repo: tag, tag: "latest" };
}

function ensureLogs(container: DemoContainer, count = 8): void {
  const now = Date.now();
  if (container.state !== "running") return;
  const elapsed = Math.floor((now - container.lastLogAt) / 2500);
  if (elapsed <= 0) return;
  const service = container.composeService ?? container.name;
  const busy = container.baseCpu > 20;
  const samples = [
    `info: ${service} heartbeat ok rss=${Math.round(container.baseMem / MB)}MiB`,
    `info: GET /healthz 200 ${(2 + Math.random() * 12).toFixed(1)}ms`,
    busy ? `warn: upstream latency ${(140 + Math.random() * 900).toFixed(0)}ms (>250ms budget)` : `info: request handled ${(4 + Math.random() * 40).toFixed(1)}ms`,
    `info: gc pause ${(1 + Math.random() * 9).toFixed(1)}ms — heap ${Math.round(container.baseMem / MB)}MiB`,
  ];
  const add = Math.min(elapsed, 6);
  for (let i = 0; i < add; i += 1) {
    container.logLines.push(
      `${logStamp((add - i) * 2.5)} ${samples[Math.floor(Math.random() * samples.length)]}`,
    );
  }
  if (container.logLines.length > 400) container.logLines.splice(0, container.logLines.length - 400);
  container.lastLogAt = now;
}

function statsFor(container: DemoContainer, push = true): ContainerStats {
  const s = state();
  s.tick += 1;
  const running = container.state === "running" || container.state === "restarting";
  const cpu = running ? jitter(container.baseCpu, container.baseCpu > 20 ? 14 : 6) : 0;
  const memPct = running ? jitter((container.baseMem / container.memoryLimitBytes) * 100, 2.5, 1, 99.4) : 0;
  const net = running ? jitter(40, 22) : 0;
  const block = running ? jitter(18, 12) : 0;
  container.netRx += running ? Math.random() * 1.4 * MB : 0;
  container.netTx += running ? Math.random() * 0.9 * MB : 0;
  container.blockRead += running ? Math.random() * 0.4 * MB : 0;
  container.blockWrite += running ? Math.random() * 0.2 * MB : 0;

  if (push) {
    container.history.cpu.push(Number(cpu.toFixed(1)));
    container.history.memory.push(Number(memPct.toFixed(1)));
    container.history.net.push(Number(net.toFixed(1)));
    container.history.block.push(Number(block.toFixed(1)));
    for (const key of ["cpu", "memory", "net", "block"] as const) {
      if (container.history[key].length > 30) container.history[key].shift();
    }
  }

  return {
    cpuPct: Number(cpu.toFixed(2)),
    memoryBytes: Math.round((memPct / 100) * container.memoryLimitBytes),
    memoryLimitBytes: container.memoryLimitBytes,
    memoryPct: Number(memPct.toFixed(2)),
    netRxBytes: container.netRx,
    netTxBytes: container.netTx,
    blockReadBytes: container.blockRead,
    blockWriteBytes: container.blockWrite,
    pids: running ? container.pids : 0,
    history: container.history,
  };
}

function toInfo(container: DemoContainer): ContainerInfo {
  const stats = statsFor(container);
  const startedAt = container.startedAt;
  return {
    id: container.id,
    name: container.name,
    image: container.image,
    imageId: container.imageId,
    command: container.command,
    createdAt: new Date(container.createdAt).toISOString(),
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    finishedAt: container.finishedAt ? new Date(container.finishedAt).toISOString() : null,
    state: container.state,
    health: container.health,
    tone: stateTone(container.state, container.health),
    statusText:
      container.state === "running"
        ? `Up ${Math.max(1, Math.round((Date.now() - (startedAt ?? Date.now())) / 60000))} minutes (${container.health})`
        : container.state === "restarting"
          ? `Restarting (${container.exitCode ?? 137}) ${container.restartCount}s ago`
          : container.state === "exited"
            ? `Exited (${container.exitCode ?? 0})`
            : container.state,
    exitCode: container.exitCode,
    restartCount: container.restartCount,
    platform: "linux/amd64",
    composeProject: container.composeProject,
    composeService: container.composeService,
    ports: container.ports,
    networks: container.networks,
    mounts: container.mounts,
    labels: {
      ...(container.composeProject
        ? {
            "com.docker.compose.project": container.composeProject,
            "com.docker.compose.service": container.composeService ?? "",
            "com.docker.compose.version": "2.29.7",
          }
        : {}),
      "org.opencontainers.image.title": container.composeService ?? container.name,
    },
    env: container.env,
    cpuPct: stats.cpuPct,
    memoryBytes: stats.memoryBytes,
    memoryLimitBytes: stats.memoryLimitBytes,
    memoryPct: stats.memoryPct,
    netRxBytes: stats.netRxBytes,
    netTxBytes: stats.netTxBytes,
    blockReadBytes: stats.blockReadBytes,
    blockWriteBytes: stats.blockWriteBytes,
    pids: stats.pids,
    history: container.history,
  };
}

function find(idOrName: string): DemoContainer | undefined {
  return state().containers.find(
    (c) => c.id === idOrName || c.id.startsWith(idOrName) || c.name === idOrName,
  );
}

function parsePorts(list?: string[]): PortMapping[] {
  if (!list?.length) return [];
  return list.flatMap((entry) => {
    const [host, container] = entry.split(":");
    const containerPort = Number(container ?? host);
    if (!Number.isFinite(containerPort)) return [];
    return [
      {
        containerPort,
        hostPort: container ? Number(host) : null,
        hostIp: "0.0.0.0",
        protocol: "tcp",
      },
    ];
  });
}

export const demoEngine: EngineAdapter = {
  kind: "demo",

  async info(): Promise<EngineInfo> {
    const containers = state().containers;
    return {
      id: hex("demo-engine"),
      name: "dockflow-demo",
      serverVersion: "27.3.1-demo",
      apiVersion: "1.46",
      os: "Docker Engine (simulated)",
      arch: "x86_64",
      kernel: "6.8.0-demo",
      host: "sandbox://no-daemon",
      cpus: 8,
      memoryBytes: 16 * GB,
      storageDriver: "overlayfs",
      runtime: "io.containerd.runc.v2 (simulated)",
      loggingDriver: "json-file",
      cgroupVersion: "v2",
      warnings: [
        "demo engine active — no Docker daemon reachable from this host",
        `${containers.filter((c) => c.state === "running").length} of ${containers.length} containers simulated`,
      ],
    };
  },

  async containers(): Promise<ContainerInfo[]> {
    const list = state().containers;
    for (const container of list) ensureLogs(container);
    return list.map(toInfo).sort((a, b) => a.name.localeCompare(b.name));
  },

  async container(id: string): Promise<ContainerInfo | null> {
    const container = find(id);
    if (!container) return null;
    ensureLogs(container);
    return toInfo(container);
  },

  async logs(id: string, options: LogOptions = {}): Promise<string> {
    const container = find(id);
    if (!container) throw new Error(`container ${id} not found`);
    ensureLogs(container);
    const tail = options.tail ?? 250;
    const lines = container.logLines.slice(-tail);
    if (options.timestamps === false) {
      return lines.map((line) => line.replace(/^\S+ /, "")).join("\n");
    }
    return lines.join("\n");
  },

  async exec(id: string, command: string): Promise<ExecResult> {
    const container = find(id);
    if (!container) throw new Error(`container ${id} not found`);
    const started = Date.now();
    if (container.state !== "running") {
      return { exitCode: 1, output: `container ${container.name} is not running (${container.state})`, durationMs: 12 };
    }
    const output = [
      `$ ${command}`,
      `uid=0(root) gid=0(root) groups=0(root)`,
      `hostname: ${container.id.slice(0, 12)}`,
      `image: ${container.image}`,
      `uptime: ${Math.max(1, Math.round((Date.now() - (container.startedAt ?? Date.now())) / 1000))}s`,
      `demo engine executed the command in-process (no daemon)`,
    ].join("\n");
    return { exitCode: 0, output, durationMs: Math.max(18, Date.now() - started) };
  },

  async images(): Promise<ImageInfo[]> {
    const s = state();
    const counts = new Map<string, number>();
    for (const container of s.containers) {
      counts.set(container.image, (counts.get(container.image) ?? 0) + 1);
    }
    const extra = ["alpine:3.20", "busybox:1.36", "node:22-alpine", "eclipse-temurin:21-jre"];
    const tags = Array.from(new Set([...Array.from(counts.keys()), ...extra]));
    return tags
      .filter((tag) => !s.prunedImages.has(tag))
      .map((tag) => ({
        id: `sha256:${hex(`image:${tag}`)}`,
        repoTags: [tag],
        repoDigests: [`${imageName(tag).repo}@sha256:${hex(`digest:${tag}`)}`],
        sizeBytes: (90 + (hash(tag) % 780)) * MB,
        created: agoIso(4 + (hash(tag) % 90)),
        containers: counts.get(tag) ?? 0,
        labels: {},
      }))
      .sort((a, b) => a.repoTags[0].localeCompare(b.repoTags[0]));
  },

  async volumes(): Promise<VolumeInfo[]> {
    const s = state();
    return s.volumes.map((volume) => {
      const usedBy = s.containers.filter((c) => c.mounts.some((m) => m.source === volume.name)).map((c) => c.name);
      return { ...volume, usedBy, inUse: usedBy.length > 0 };
    });
  },

  async networks(): Promise<NetworkInfo[]> {
    const s = state();
    return s.networks.map((network) => ({
      ...network,
      containers: s.containers
        .filter((c) => c.networks.some((n) => n.name === network.name))
        .map((c) => ({
          id: c.id.slice(0, 12),
          name: c.name,
          ipv4: c.networks.find((n) => n.name === network.name)?.ipAddress ?? "",
        })),
    }));
  },

  async action(action: string, target: string, payload: Record<string, unknown> = {}) {
    const s = state();
    if (target.startsWith("image:")) {
      const tag = target.slice(6);
      if (action === "remove") {
        s.prunedImages.add(tag);
        return { ok: true as const, message: `image ${tag} removed` };
      }
      throw new Error(`unsupported image action ${action}`);
    }
    if (target.startsWith("volume:")) {
      const name = target.slice(7);
      if (action === "remove") {
        s.volumes = s.volumes.filter((v) => v.name !== name);
        return { ok: true as const, message: `volume ${name} removed` };
      }
      throw new Error(`unsupported volume action ${action}`);
    }
    if (target.startsWith("network:")) {
      const name = target.slice(8);
      if (action === "remove") {
        s.networks = s.networks.filter((n) => n.name !== name);
        return { ok: true as const, message: `network ${name} removed` };
      }
      throw new Error(`unsupported network action ${action}`);
    }

    const container = find(target);
    if (!container) throw new Error(`container ${target} not found`);
    const now = Date.now();
    switch (action) {
      case "start":
        container.state = "running";
        container.health = "starting";
        container.startedAt = now;
        container.finishedAt = null;
        container.exitCode = null;
        container.pids = Math.max(4, container.pids);
        container.logLines.push(`${logStamp()} info: container started by operator`);
        break;
      case "stop":
        container.state = "exited";
        container.health = "none";
        container.exitCode = 0;
        container.finishedAt = now;
        container.pids = 0;
        container.logLines.push(`${logStamp()} info: received SIGTERM, shutting down gracefully`);
        break;
      case "restart":
        container.restartCount += 1;
        container.state = "running";
        container.health = "healthy";
        container.startedAt = now;
        container.exitCode = null;
        container.logLines.push(`${logStamp()} info: container restarted (restart #${container.restartCount})`);
        break;
      case "pause":
        if (container.state !== "running") throw new Error("container is not running");
        container.state = "paused";
        break;
      case "unpause":
        if (container.state !== "paused") throw new Error("container is not paused");
        container.state = "running";
        break;
      case "kill":
        container.state = "exited";
        container.exitCode = 137;
        container.finishedAt = now;
        container.pids = 0;
        container.logLines.push(`${logStamp()} fatal: SIGKILL sent by operator (exit 137)`);
        break;
      case "remove":
        if (container.state === "running") throw new Error("cannot remove a running container — stop it first");
        s.containers = s.containers.filter((c) => c.id !== container.id);
        return { ok: true as const, message: `container ${container.name} removed` };
      case "update-health": {
        const health = String(payload.health ?? "healthy") as ContainerHealth;
        container.health = health;
        if (health === "healthy" && container.state === "restarting") {
          container.state = "running";
          container.exitCode = null;
        }
        return { ok: true as const, message: `health set to ${health}` };
      }
      default:
        throw new Error(`unsupported action ${action}`);
    }
    return { ok: true as const, message: `${action} ${container.name}` };
  },

  async run(spec: RunSpec) {
    const s = state();
    const name = spec.name?.trim() || `${spec.image.split("/").pop()?.split(":")[0]}-${Math.floor(Math.random() * 9000 + 1000)}`;
    if (s.containers.some((c) => c.name === name)) throw new Error(`container name ${name} is already in use`);
    const id = hex(`run:${name}:${Date.now()}`);
    const container: DemoContainer = {
      id,
      name,
      image: spec.image,
      imageId: `sha256:${hex(`image:${spec.image}`)}`,
      command: spec.command?.trim() || "/entrypoint.sh",
      createdAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: null,
      state: "running",
      health: "starting",
      exitCode: null,
      restartCount: 0,
      composeProject: null,
      composeService: null,
      ports: parsePorts(spec.ports),
      networks: [{ name: "bridge", ipAddress: `172.17.0.${20 + Math.floor(Math.random() * 200)}` }],
      mounts: [],
      env: spec.env?.length ? spec.env : ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"],
      baseCpu: 3,
      baseMem: 64 * MB,
      memoryLimitBytes: 1 * GB,
      pids: 7,
      history: { cpu: seedHistory(3, 3), memory: seedHistory(6, 2), net: seedHistory(10, 6), block: seedHistory(4, 3) },
      logLines: [`${logStamp()} info: container ${name} created from ${spec.image} (demo engine)`],
      netRx: 0,
      netTx: 0,
      blockRead: 0,
      blockWrite: 0,
      lastLogAt: Date.now(),
    };
    s.containers.push(container);
    return { id, name };
  },

  async prune(kind): Promise<PruneResult> {
    const s = state();
    if (kind === "containers") {
      const removed = s.containers.filter((c) => c.state === "exited");
      s.containers = s.containers.filter((c) => c.state !== "exited");
      return {
        kind,
        reclaimedBytes: removed.length * 24 * MB,
        details: removed.map((c) => `${c.name} (exited ${c.exitCode ?? 0})`),
      };
    }
    if (kind === "images") {
      const images = await this.images();
      const unused = images.filter((image) => image.containers === 0);
      unused.forEach((image) => s.prunedImages.add(image.repoTags[0]));
      return {
        kind,
        reclaimedBytes: unused.reduce((sum, image) => sum + image.sizeBytes, 0),
        details: unused.map((image) => image.repoTags[0]),
      };
    }
    if (kind === "volumes") {
      const used = new Set(s.containers.flatMap((c) => c.mounts.map((m) => m.source)));
      const unused = s.volumes.filter((v) => !used.has(v.name));
      s.volumes = s.volumes.filter((v) => used.has(v.name));
      return {
        kind,
        reclaimedBytes: unused.reduce((sum, v) => sum + (v.sizeBytes ?? 0), 0),
        details: unused.map((v) => v.name),
      };
    }
    const used = new Set(s.containers.flatMap((c) => c.networks.map((n) => n.name)));
    const removable = s.networks.filter((n) => !used.has(n.name) && !["host", "bridge", "none"].includes(n.name));
    s.networks = s.networks.filter((n) => !removable.includes(n));
    return { kind, reclaimedBytes: 0, details: removable.map((n) => n.name) };
  },

  async projectAction(project: string, action: "start" | "stop" | "restart") {
    const list = state().containers.filter((c) => c.composeProject === project);
    if (!list.length) throw new Error(`compose project ${project} has no containers`);
    for (const container of list) {
      if (action === "stop") {
        container.state = "exited";
        container.exitCode = 0;
        container.health = "none";
        container.finishedAt = Date.now();
        container.pids = 0;
      } else {
        container.state = "running";
        container.health = "healthy";
        container.startedAt = Date.now();
        container.exitCode = null;
        container.finishedAt = null;
        container.pids = Math.max(4, container.pids);
        if (action === "restart") container.restartCount += 1;
      }
      container.logLines.push(`${logStamp()} info: compose ${action} applied to ${container.name}`);
    }
    return { ok: true as const, message: `${action} ${list.length} containers in ${project}`, affected: list.length };
  },
};

function hash(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) h = (h * 33) ^ value.charCodeAt(i);
  return Math.abs(h);
}

export function resetDemoEngine(): void {
  globalForDemo.__dockflowDemo = buildSeed();
}
