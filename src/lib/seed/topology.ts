import type { NodeStatus, NodeType } from "@/lib/types";

export interface SeedNode {
  id: string;
  parentId: string | null;
  name: string;
  type: NodeType;
  kind: string | null;
  status: NodeStatus;
  region: string | null;
  owner: string | null;
  meta: Record<string, unknown>;
  sortOrder: number;
}

/** deterministic PRNG so the reference dataset is stable between reseeds */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260214);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));

interface ServiceDef {
  name: string;
  group: string;
  sub: string;
  runtime: string;
  protocol: "HTTP/2" | "gRPC" | "HTTP/1.1" | "AMQP";
  endpoints: { method: string; path: string; slaMs: number; auth: string }[];
}

const SERVICE_CATALOGUE: ServiceDef[] = [
  {
    name: "checkout-api",
    group: "Commerce Domain",
    sub: "Payment Orchestration",
    runtime: "node20 / fastify",
    protocol: "HTTP/2",
    endpoints: [
      { method: "POST", path: "/v1/checkout/session", slaMs: 250, auth: "oauth2" },
      { method: "GET", path: "/v1/checkout/session/:id", slaMs: 120, auth: "oauth2" },
      { method: "POST", path: "/v1/checkout/confirm", slaMs: 320, auth: "mtls" },
    ],
  },
  {
    name: "cart-service",
    group: "Commerce Domain",
    sub: "Basket & Pricing",
    runtime: "go1.24 / chi",
    protocol: "gRPC",
    endpoints: [
      { method: "RPC", path: "cart.v1.CartService/Merge", slaMs: 90, auth: "mtls" },
      { method: "RPC", path: "cart.v1.CartService/Price", slaMs: 140, auth: "mtls" },
    ],
  },
  {
    name: "catalog-search",
    group: "Commerce Domain",
    sub: "Search & Discovery",
    runtime: "java21 / spring",
    protocol: "HTTP/2",
    endpoints: [
      { method: "GET", path: "/v2/search?q=", slaMs: 180, auth: "api-key" },
      { method: "GET", path: "/v2/facets", slaMs: 160, auth: "api-key" },
      { method: "POST", path: "/v2/reindex", slaMs: 900, auth: "mtls" },
    ],
  },
  {
    name: "payments-gateway",
    group: "Treasury Domain",
    sub: "Acquiring",
    runtime: "java21 / quarkus",
    protocol: "HTTP/2",
    endpoints: [
      { method: "POST", path: "/v1/authorize", slaMs: 400, auth: "mtls" },
      { method: "POST", path: "/v1/capture", slaMs: 350, auth: "mtls" },
      { method: "POST", path: "/v1/refund", slaMs: 500, auth: "mtls" },
    ],
  },
  {
    name: "ledger-writer",
    group: "Treasury Domain",
    sub: "Double Entry Core",
    runtime: "rust1.83 / axum",
    protocol: "gRPC",
    endpoints: [
      { method: "RPC", path: "ledger.v1.Journal/Append", slaMs: 60, auth: "mtls" },
      { method: "RPC", path: "ledger.v1.Journal/Balance", slaMs: 80, auth: "mtls" },
    ],
  },
  {
    name: "fraud-scorer",
    group: "Risk Domain",
    sub: "Realtime Scoring",
    runtime: "python3.13 / triton",
    protocol: "gRPC",
    endpoints: [
      { method: "RPC", path: "risk.v1.Scorer/Score", slaMs: 70, auth: "mtls" },
      { method: "GET", path: "/v1/models/active", slaMs: 40, auth: "api-key" },
    ],
  },
  {
    name: "inventory-sync",
    group: "Supply Domain",
    sub: "Stock Projection",
    runtime: "go1.24 / kafka-go",
    protocol: "AMQP",
    endpoints: [
      { method: "SUB", path: "topic:stock.mutations", slaMs: 200, auth: "sasl" },
      { method: "GET", path: "/v1/stock/:sku", slaMs: 90, auth: "api-key" },
    ],
  },
  {
    name: "pos-bridge",
    group: "Store Domain",
    sub: "Lane Connectivity",
    runtime: "dotnet9 / aspnet",
    protocol: "HTTP/1.1",
    endpoints: [
      { method: "POST", path: "/v1/lanes/heartbeat", slaMs: 500, auth: "device-cert" },
      { method: "POST", path: "/v1/lanes/sale", slaMs: 700, auth: "device-cert" },
    ],
  },
  {
    name: "identity-broker",
    group: "Platform Domain",
    sub: "AuthN / AuthZ",
    runtime: "go1.24 / oidc",
    protocol: "HTTP/2",
    endpoints: [
      { method: "POST", path: "/oauth2/token", slaMs: 110, auth: "public" },
      { method: "GET", path: "/.well-known/jwks.json", slaMs: 30, auth: "public" },
      { method: "POST", path: "/oauth2/introspect", slaMs: 60, auth: "mtls" },
    ],
  },
  {
    name: "stream-ingest",
    group: "Data Domain",
    sub: "Event Ingestion",
    runtime: "scala3 / fs2",
    protocol: "AMQP",
    endpoints: [
      { method: "SUB", path: "topic:telemetry.raw", slaMs: 250, auth: "sasl" },
      { method: "POST", path: "/v1/batch", slaMs: 800, auth: "api-key" },
    ],
  },
  {
    name: "metrics-agg",
    group: "Data Domain",
    sub: "Rollup Pipeline",
    runtime: "python3.13 / duckdb",
    protocol: "HTTP/2",
    endpoints: [
      { method: "GET", path: "/v1/series/:metric", slaMs: 200, auth: "oauth2" },
      { method: "POST", path: "/v1/rollup/run", slaMs: 1200, auth: "mtls" },
    ],
  },
  {
    name: "notification-dispatch",
    group: "Platform Domain",
    sub: "Messaging",
    runtime: "node20 / nest",
    protocol: "HTTP/2",
    endpoints: [
      { method: "POST", path: "/v1/email", slaMs: 300, auth: "api-key" },
      { method: "POST", path: "/v1/push", slaMs: 260, auth: "api-key" },
    ],
  },
];

const EDGE_SERVICES: ServiceDef[] = [
  {
    name: "edge-proxy",
    group: "Edge & Delivery",
    sub: "TLS Termination",
    runtime: "nginx 1.27",
    protocol: "HTTP/2",
    endpoints: [
      { method: "GET", path: "/", slaMs: 40, auth: "public" },
      { method: "GET", path: "/nginx_status", slaMs: 15, auth: "internal" },
    ],
  },
  {
    name: "cache-layer",
    group: "Edge & Delivery",
    sub: "Distributed Cache",
    runtime: "redis 7.4",
    protocol: "HTTP/1.1",
    endpoints: [
      { method: "CMD", path: "GET/SET/MGET", slaMs: 5, auth: "acl" },
      { method: "GET", path: "/health", slaMs: 10, auth: "internal" },
    ],
  },
  {
    name: "log-shipper",
    group: "Observability",
    sub: "Log Pipeline",
    runtime: "vector 0.44",
    protocol: "HTTP/1.1",
    endpoints: [
      { method: "GET", path: "/health", slaMs: 20, auth: "internal" },
      { method: "GET", path: "/metrics", slaMs: 25, auth: "internal" },
    ],
  },
];

interface OrgSpec {
  id: string;
  name: string;
  type: NodeType;
  kind: string;
  owner: string;
  region?: string;
  meta?: Record<string, unknown>;
  children?: OrgSpec[];
  /** service domains hosted at this leaf of the org tree */
  domains?: number[];
}

const ORG_TREE: OrgSpec = {
  id: "org-helios",
  name: "Helios Enterprise Group",
  type: "organization",
  kind: "holding",
  owner: "group-noc",
  region: "global",
  meta: { tier: 0, code: "HLX", employees: 41200, costCenter: "CC-0000" },
  children: [
    {
      id: "div-cloud",
      name: "Cloud Platform Division",
      type: "sub_org",
      kind: "digital-platform",
      owner: "cto-office",
      region: "global",
      meta: { tier: 1, code: "CPD", budgetUsd: 184_000_000 },
      children: [
        {
          id: "prj-commerce",
          name: "Core Commerce Platform",
          type: "project",
          kind: "revenue-platform",
          owner: "commerce-eng",
          meta: { tier: 2, code: "CCP", criticality: "mission-critical" },
          children: [
            {
              id: "sp-checkout",
              name: "Checkout Modernization",
              type: "sub_project",
              kind: "programme",
              owner: "checkout-squad",
              meta: { tier: 3, code: "CKO-MOD", epic: "EPIC-4417" },
              domains: [0, 1, 3, 5],
            },
            {
              id: "sp-catalog",
              name: "Catalog & Discovery",
              type: "sub_project",
              kind: "programme",
              owner: "search-squad",
              meta: { tier: 3, code: "CAT-DSC", epic: "EPIC-4522" },
              domains: [2, 6],
            },
          ],
        },
        {
          id: "prj-data",
          name: "Data & Analytics Platform",
          type: "project",
          kind: "data-platform",
          owner: "data-eng",
          meta: { tier: 2, code: "DAP", criticality: "high" },
          children: [
            {
              id: "sp-streaming",
              name: "Realtime Event Streaming",
              type: "sub_project",
              kind: "programme",
              owner: "streaming-squad",
              meta: { tier: 3, code: "RES", epic: "EPIC-5120" },
              domains: [9, 10],
            },
          ],
        },
      ],
    },
    {
      id: "div-retail",
      name: "Retail Operations Division",
      type: "sub_org",
      kind: "physical-retail",
      owner: "coo-office",
      region: "emea",
      meta: { tier: 1, code: "ROD", budgetUsd: 96_500_000 },
      children: [
        {
          id: "prj-stores",
          name: "Store Systems",
          type: "project",
          kind: "edge-fleet",
          owner: "store-tech",
          meta: { tier: 2, code: "STS", criticality: "high" },
          children: [
            {
              id: "sp-pos",
              name: "POS Fleet Rollout",
              type: "sub_project",
              kind: "programme",
              owner: "pos-squad",
              meta: { tier: 3, code: "POS-FLT", epic: "EPIC-6102" },
              domains: [7, 8],
            },
          ],
        },
        {
          id: "prj-payments",
          name: "Payments & Treasury",
          type: "project",
          kind: "regulated",
          owner: "treasury-eng",
          meta: { tier: 2, code: "PAY", criticality: "mission-critical", pci: true },
          children: [
            {
              id: "sp-ledger",
              name: "Core Ledger Rewrite",
              type: "sub_project",
              kind: "programme",
              owner: "ledger-squad",
              meta: { tier: 3, code: "LGR-RW", epic: "EPIC-7011" },
              domains: [4, 3, 11],
            },
          ],
        },
      ],
    },
  ],
};

const DATACENTERS: Record<string, { id: string; name: string; region: string; kind: string }[]> = {
  "sp-checkout": [
    { id: "dc-eu-west-1", name: "DC · eu-west-1 · Amsterdam", region: "eu-west-1", kind: "colocation" },
    { id: "dc-us-east-1", name: "DC · us-east-1 · Ashburn", region: "us-east-1", kind: "owned" },
  ],
  "sp-catalog": [
    { id: "dc-eu-west-1", name: "DC · eu-west-1 · Amsterdam", region: "eu-west-1", kind: "colocation" },
    { id: "dc-ap-south-1", name: "DC · ap-south-1 · Mumbai", region: "ap-south-1", kind: "cloud-region" },
  ],
  "sp-streaming": [
    { id: "dc-us-east-1", name: "DC · us-east-1 · Ashburn", region: "us-east-1", kind: "owned" },
    { id: "dc-ap-south-1", name: "DC · ap-south-1 · Mumbai", region: "ap-south-1", kind: "cloud-region" },
  ],
  "sp-pos": [{ id: "dc-eu-central-edge", name: "DC · eu-central · Edge POPs", region: "eu-central-1", kind: "edge-pop" }],
  "sp-ledger": [
    { id: "dc-eu-west-1", name: "DC · eu-west-1 · Amsterdam", region: "eu-west-1", kind: "colocation" },
    { id: "dc-us-east-1", name: "DC · us-east-1 · Ashburn", region: "us-east-1", kind: "owned" },
  ],
};

const SERVER_PROFILES = [
  { kind: "bare-metal", os: "RHEL 9.5", cores: 64, ramGb: 512, hypervisor: "none" },
  { kind: "vmware-vm", os: "Ubuntu 24.04 LTS", cores: 16, ramGb: 128, hypervisor: "vSphere 8u3" },
  { kind: "ec2-instance", os: "Amazon Linux 2023", cores: 32, ramGb: 256, hypervisor: "nitro" },
  { kind: "bare-metal", os: "Debian 12.9", cores: 48, ramGb: 384, hypervisor: "none" },
];

const slug = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

export function buildSeedTopology(): SeedNode[] {
  const out: SeedNode[] = [];
  let order = 0;
  const push = (n: Omit<SeedNode, "sortOrder">) => {
    out.push({ ...n, sortOrder: order++ });
  };

  /** inject the three resource gauge children for every host-like node */
  const addResourceNodes = (parentId: string) => {
    (["cpu", "memory", "disk"] as const).forEach((metric, i) => {
      push({
        id: `${parentId}::res-${metric}`,
        parentId,
        name: metric === "cpu" ? "CPU" : metric === "memory" ? "Memory" : "Disk",
        type: "resource",
        kind: metric,
        status: "healthy",
        region: null,
        owner: null,
        meta: { metric, unit: metric === "cpu" ? "%" : metric === "memory" ? "%" : "%", index: i },
      });
    });
  };

  const addServiceChain = (
    parentId: string,
    parentRegion: string | null,
    service: ServiceDef,
    ownerTeam: string,
    status: NodeStatus,
  ) => {
    const groupId = `${parentId}::grp-${slug(service.group)}`;
    const existingGroup = out.find((n) => n.id === groupId);
    if (!existingGroup) {
      push({
        id: groupId,
        parentId,
        name: service.group,
        type: "service_group",
        kind: "domain-group",
        status: "healthy",
        region: parentRegion,
        owner: ownerTeam,
        meta: { domain: service.group },
      });
    }
    const subId = `${groupId}::sub-${slug(service.sub)}`;
    if (!out.find((n) => n.id === subId)) {
      push({
        id: subId,
        parentId: groupId,
        name: service.sub,
        type: "service_sub_group",
        kind: "sub-domain",
        status: "healthy",
        region: parentRegion,
        owner: ownerTeam,
        meta: { domain: service.group, subDomain: service.sub },
      });
    }
    const serviceId = `${subId}::svc-${service.name}`;
    push({
      id: serviceId,
      parentId: subId,
      name: service.name,
      type: "service",
      kind: service.runtime,
      status,
      region: parentRegion,
      owner: ownerTeam,
      meta: {
        protocol: service.protocol,
        runtime: service.runtime,
        version: `v${intBetween(1, 9)}.${intBetween(0, 24)}.${intBetween(0, 12)}`,
        slaMs: Math.max(...service.endpoints.map((e) => e.slaMs)),
      },
    });
    service.endpoints.forEach((endpoint) => {
      const endpointStatus: NodeStatus =
        status === "critical" ? "critical" : status === "degraded" && rand() > 0.6 ? "degraded" : status === "offline" ? "offline" : "healthy";
      push({
        id: `${serviceId}::ep-${slug(endpoint.method + endpoint.path)}`,
        parentId: serviceId,
        name: `${endpoint.method} ${endpoint.path}`,
        type: "endpoint",
        kind: service.protocol,
        status: endpointStatus,
        region: parentRegion,
        owner: ownerTeam,
        meta: {
          method: endpoint.method,
          path: endpoint.path,
          slaMs: endpoint.slaMs,
          auth: endpoint.auth,
          protocol: service.protocol,
        },
      });
    });
  };

  const addInfra = (dcId: string, dcName: string, region: string, domains: number[], ownerTeam: string) => {
    // ---- physical / virtual servers with docker containers
    const serverCount = intBetween(1, 2);
    for (let s = 0; s < serverCount; s++) {
      const profile = SERVER_PROFILES[(s + dcId.length) % SERVER_PROFILES.length];
      const serverId = `${dcId}::srv-${String(s + 1).padStart(2, "0")}`;
      const status: NodeStatus = rand() > 0.93 ? "offline" : rand() > 0.86 ? "maintenance" : rand() > 0.78 ? "degraded" : "healthy";
      push({
        id: serverId,
        parentId: dcId,
        name: `${profile.kind === "ec2-instance" ? "i-0a" : profile.kind === "vmware-vm" ? "vm-" : "esx-"}${slug(region)}-${String(s + 1).padStart(2, "0")}`,
        type: "server",
        kind: profile.kind,
        status,
        region,
        owner: ownerTeam,
        meta: {
          os: profile.os,
          cores: profile.cores,
          ramGb: profile.ramGb,
          hypervisor: profile.hypervisor,
          ip: `10.${intBetween(10, 90)}.${intBetween(0, 250)}.${intBetween(2, 250)}`,
          rack: `${region.slice(0, 2).toUpperCase()}-R${intBetween(1, 24)}-U${intBetween(1, 42)}`,
          uptimeDays: intBetween(3, 420),
        },
      });
      addResourceNodes(serverId);

      const containerCount = intBetween(1, 2);
      for (let c = 0; c < containerCount; c++) {
        const edge = EDGE_SERVICES[(c + s) % EDGE_SERVICES.length];
        const containerId = `${serverId}::ctr-${edge.name}`;
        const cStatus: NodeStatus = status === "offline" ? "offline" : rand() > 0.88 ? "degraded" : "healthy";
        push({
          id: containerId,
          parentId: serverId,
          name: edge.name,
          type: "container",
          kind: "docker",
          status: cStatus,
          region,
          owner: ownerTeam,
          meta: {
            image: `${edge.name}:${intBetween(1, 3)}.${intBetween(0, 27)}`,
            engine: "docker 27.3.1",
            containerId: Math.floor(rand() * 1e12).toString(16).padStart(12, "0"),
            restarts: intBetween(0, 6),
            state: cStatus === "offline" ? "exited" : "running",
          },
        });
        addResourceNodes(containerId);
        addServiceChain(containerId, region, edge, ownerTeam, cStatus);
      }
    }

    // ---- kubernetes namespace with pods
    const nsId = `${dcId}::ns-prod-${slug(region)}`;
    const nsStatus: NodeStatus = rand() > 0.9 ? "degraded" : "healthy";
    push({
      id: nsId,
      parentId: dcId,
      name: `ns/prod-${slug(ownerTeam)}`,
      type: "namespace",
      kind: "kubernetes-namespace",
      status: nsStatus,
      region,
      owner: ownerTeam,
      meta: {
        cluster: `${region}-prod-01`,
        version: "v1.32.1",
        quotas: { cpu: "240", memory: "960Gi", pods: 400 },
        networkPolicy: "default-deny-ingress",
      },
    });

    const podCount = Math.min(3, Math.max(2, domains.length));
    for (let p = 0; p < podCount; p++) {
      const service = SERVICE_CATALOGUE[domains[p % domains.length] % SERVICE_CATALOGUE.length];
      const podStatus: NodeStatus =
        nsStatus === "degraded" && p === 0 ? "degraded" : rand() > 0.9 ? "critical" : rand() > 0.82 ? "degraded" : "healthy";
      const podId = `${nsId}::pod-${service.name}-${Math.floor(rand() * 65535).toString(16)}`;
      const desired = intBetween(2, 8);
      push({
        id: podId,
        parentId: nsId,
        name: `${service.name}-${Math.floor(rand() * 65535).toString(16)}${Math.floor(rand() * 90 + 10)}`,
        type: "pod",
        kind: "k8s-pod",
        status: podStatus,
        region,
        owner: ownerTeam,
        meta: {
          workload: `deploy/${service.name}`,
          image: `registry.helix.internal/${service.name}:${intBetween(1, 4)}.${intBetween(0, 30)}.${intBetween(0, 99)}`,
          cluster: `${region}-prod-01`,
          node: `node-${intBetween(1, 40)}.${region}`,
          phase: podStatus === "critical" ? "CrashLoopBackOff" : "Running",
          restarts: podStatus === "critical" ? intBetween(6, 40) : intBetween(0, 3),
        },
      });
      addResourceNodes(podId);
      addServiceChain(podId, region, service, ownerTeam, podStatus);
    }
  };

  const walk = (spec: OrgSpec, parentId: string | null, depth: number) => {
    push({
      id: spec.id,
      parentId,
      name: spec.name,
      type: spec.type,
      kind: spec.kind,
      status: "healthy",
      region: spec.region ?? null,
      owner: spec.owner,
      meta: { ...spec.meta, tier: depth },
    });

    if (spec.children?.length) {
      spec.children.forEach((child) => walk(child, spec.id, depth + 1));
      return;
    }

    // leaf of the org tree == a sub-project: attach datacenters + infrastructure
    const dcs = DATACENTERS[spec.id] ?? [
      { id: "dc-eu-west-1", name: "DC · eu-west-1 · Amsterdam", region: "eu-west-1", kind: "colocation" },
    ];
    dcs.forEach((dc) => {
      const dcId = `${spec.id}::${dc.id}`;
      push({
        id: dcId,
        parentId: spec.id,
        name: dc.name,
        type: "datacenter",
        kind: dc.kind,
        status: "healthy",
        region: dc.region,
        owner: spec.owner,
        meta: {
          tier: 4,
          pue: Number(between(1.08, 1.42).toFixed(2)),
          feeds: pick(["dual", "dual + generator", "tri-feed"]),
          capacityMw: Number(between(4, 26).toFixed(1)),
        },
      });
      addInfra(dcId, dc.name, dc.region, spec.domains ?? [0, 8], spec.owner);
    });
  };

  walk(ORG_TREE, null, 0);
  return out;
}

/** deterministic "interesting" statuses so the control room is not all-green */
export const FORCED_STATUSES: Record<string, NodeStatus> = {
  "sp-ledger::dc-eu-west-1::ns-prod-treasury-eng": "degraded",
};

export const SEED_EVENT_TEMPLATES = [
  { severity: "critical", source: "prometheus", title: "CPU saturation above 92% for 5m", detail: "rule: node_cpu_saturation / for: 5m" },
  { severity: "warning", source: "kubernetes", title: "Pod restarted 4 times in 10m", detail: "reason: CrashLoopBackOff / lastState: OOMKilled" },
  { severity: "warning", source: "docker", title: "Container memory usage above 80%", detail: "docker stats: mem_usage / limit" },
  { severity: "info", source: "agent", title: "TLS certificate renewed", detail: "notAfter extended by 90d" },
  { severity: "critical", source: "prometheus", title: "Endpoint p99 latency over SLO", detail: "slo_burn_rate_1h = 14.2" },
  { severity: "info", source: "runbook", title: "Autoscaler added 2 replicas", detail: "hpa: targetCPUUtilization 70%" },
  { severity: "warning", source: "agent", title: "Disk usage above 75%", detail: "mount: /var/lib/docker" },
  { severity: "info", source: "kubernetes", title: "Rolling update completed", detail: "deployment rollout status: complete" },
] as const;
