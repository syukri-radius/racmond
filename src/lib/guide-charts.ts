export const CHART_SYSTEM_ARCHITECTURE = `flowchart TB
  subgraph CLIENT["BROWSER · React 19 + Zustand"]
    direction TB
    PAGE["app/page.tsx<br/>Server Component<br/>initial fetch"]
    CANVAS["Canvas.tsx<br/>pan / zoom / drag<br/>extent:parent"]
    SUB["SubFlowNode<br/>recursive renderer"]
    CARDS["NodeCard<br/>group · host+3 gauges<br/>service · endpoint · resource"]
    STORE["store/ops.ts<br/>zustand slices<br/>metrics / series / events"]
    ELK["lib/elk-layout.ts<br/>elkjs layered<br/>compound graph"]
    MERMAID["/guide<br/>mermaid docs"]
  end
  subgraph SERVER["NEXT.JS APP ROUTER · Node.js"]
    direction TB
    TOPO["GET /api/topology<br/>aggregation point"]
    STREAM["GET /api/stream<br/>SSE · 2s ticks"]
    INGEST["POST /api/ingest/*<br/>nodes · metrics · events"]
    PATCH["PATCH /api/nodes/id<br/>x y collapsed status"]
    CLI["POST /api/cli/execute<br/>runbooks"]
    EVENTS["POST /api/events<br/>ack"]
    SVC["lib/topology-service.ts<br/>single aggregation"]
    ENG["lib/telemetry.ts<br/>simulation engine<br/>Prometheus Docker K8s model"]
  end
  subgraph DATA["POSTGRESQL · Drizzle ORM"]
    direction TB
    NODES[("ops_nodes<br/>self-referencing tree")]
    METRICS[("ops_metrics<br/>latest snapshot")]
    SAMPLES[("ops_metric_samples<br/>rolling 50min")]
    EVTS[("ops_events<br/>alert stream")]
    RUNS[("ops_command_runs<br/>cli log")]
  end
  subgraph EXT["EXTERNAL WORLD"]
    direction TB
    LARAVEL["PHP Laravel"]
    SPRING["Java Spring Boot"]
    NODEJS["Node.js"]
    GO["Golang"]
    RUST["Rust"]
    PY["Python"]
    PGEXT["Postgres watchdogs"]
    MINIO["MinIO webhooks"]
    PROM["Prometheus<br/>Docker · K8s"]
  end

  PAGE --> TOPO
  TOPO --> SVC
  SVC --> NODES
  SVC --> METRICS
  SVC --> SAMPLES
  SVC --> EVTS
  STORE --> STREAM
  STREAM --> ENG
  ENG --> NODES
  ENG --> METRICS
  ENG --> SAMPLES
  ENG --> EVTS
  CANVAS --> STORE
  SUB --> CANVAS
  CARDS --> SUB
  ELK --> SUB
  CANVAS --> PATCH
  PAGE --> MERMAID
  EXT --> INGEST
  INGEST --> NODES
  INGEST --> METRICS
  INGEST --> EVTS
  PROM -.-> ENG
  CLI --> RUNS
  STORE --> CLI
  STORE --> EVENTS`;

export const CHART_HIERARCHY = `flowchart TB
  ORG["ORGANIZATION<br/>org-helios<br/>Helios Enterprise Group"]
  DIV1["SUB-ORG · DIV<br/>Cloud Platform Division"]
  DIV2["SUB-ORG · DIV<br/>Retail Operations Division"]
  PRJ1["PROJECT · PRJ<br/>Core Commerce Platform"]
  PRJ2["PROJECT · PRJ<br/>Data & Analytics"]
  PRJ3["PROJECT · PRJ<br/>Store Systems"]
  PRJ4["PROJECT · PRJ<br/>Payments & Treasury"]
  SUB1["SUB-PROJECT<br/>Checkout Modernization"]
  SUB2["SUB-PROJECT<br/>Catalog & Discovery"]
  DC1["DATACENTER<br/>eu-west-1 Amsterdam"]
  DC2["DATACENTER<br/>us-east-1 Ashburn"]
  NS["NAMESPACE<br/>ns/prod · k8s v1.32"]
  SRV["SERVER · SRV<br/>bare-metal / vm / ec2<br/>+ 3 gauges"]
  CTR["CONTAINER · CTR<br/>docker 27<br/>+ 3 gauges"]
  POD["POD · POD<br/>CrashLoop aware<br/>+ 3 gauges"]
  GRP["SERVICE GROUP<br/>Commerce Domain"]
  SGRP["SERVICE SUB-GROUP<br/>Payment Orchestration"]
  SVC["SERVICE · SVC<br/>checkout-api v2.4.1"]
  EP1["ENDPOINT · EP<br/>POST /v1/checkout/session"]
  EP2["ENDPOINT · EP<br/>GET /v1/search"]
  RCPU["RESOURCE<br/>CPU gauge"]
  RMEM["RESOURCE<br/>Memory gauge"]
  RDSK["RESOURCE<br/>Disk gauge"]

  ORG --> DIV1
  ORG --> DIV2
  DIV1 --> PRJ1
  DIV1 --> PRJ2
  DIV2 --> PRJ3
  DIV2 --> PRJ4
  PRJ1 --> SUB1
  PRJ1 --> SUB2
  SUB1 --> DC1
  SUB1 --> DC2
  DC1 --> NS
  DC1 --> SRV
  SRV --> RCPU
  SRV --> RMEM
  SRV --> RDSK
  SRV --> CTR
  NS --> POD
  POD --> RCPU
  CTR --> GRP
  POD --> GRP
  GRP --> SGRP
  SGRP --> SVC
  SVC --> EP1
  SVC --> EP2`;

export const CHART_REALTIME_SEQUENCE = `sequenceDiagram
  autonumber
  participant B as Browser<br/>Server Component
  participant T as GET /api/topology
  participant S as lib/topology-service
  participant DB as Postgres/Drizzle
  participant E as Telemetry engine
  participant SSE as GET /api/stream (SSE)

  B->>T: initial fetch (full hierarchy)
  T->>S: getTopologyPayload()
  S->>DB: ensureSeeded() + select nodes/metrics/series/events
  S->>E: startEngine() · live maps
  S-->>B: TopologyPayload (nodes before children)
  B->>SSE: EventSource connect
  SSE-->>B: hello + full metrics snapshot
  loop every 2s
    E->>E: evolve leaf targets + mean reversion
    E->>E: roll up groups (averages, worst status)
    E->>DB: persist snapshot 10s / samples 30s
    E->>SSE: broadcast metrics updates
    SSE-->>B: data: metrics (+status transitions)
    B->>B: zustand set (no layout recompute)
  end
  E->>SSE: broadcast event / cli output
  SSE-->>B: data: event / cli`;

export const CHART_ER = `erDiagram
  OPS_NODES ||--o{ OPS_NODES : "parent_id self reference"
  OPS_NODES ||--o| OPS_METRICS : "node_id 1:1 snapshot"
  OPS_NODES ||--o{ OPS_METRIC_SAMPLES : "rolling history"
  OPS_NODES ||--o{ OPS_EVENTS : "alerts"
  OPS_NODES ||--o{ OPS_COMMAND_RUNS : "cli runs"

  OPS_NODES {
    text id PK
    text parent_id FK
    text name
    text type "org..endpoint,resource"
    text kind
    text status
    text region
    text owner
    jsonb meta
    real x
    real y
    int sort_order
    boolean collapsed
  }
  OPS_METRICS {
    text node_id PK_FK
    real cpu
    real memory
    real disk
    real network_in
    real network_out
    real requests_per_sec
    real error_rate
    real latency_ms
    real uptime_pct
    int replicas_ready
    int replicas_desired
    text source
  }
  OPS_METRIC_SAMPLES {
    serial id PK
    text node_id FK
    text metric "cpu|memory|disk"
    real value
    timestamptz ts
  }
  OPS_EVENTS {
    serial id PK
    text node_id FK
    text severity
    text source
    text title
    text detail
    boolean acknowledged
    timestamptz ts
  }
  OPS_COMMAND_RUNS {
    serial id PK
    text node_id FK
    text command
    text operator
    text status
    int exit_code
    text output
    timestamptz started_at
    timestamptz finished_at
  }`;

export const CHART_LAYOUT_PIPELINE = `flowchart LR
  A["1 · buildIndexes()<br/>parents before children<br/>childrenOf + depth"] --> B["2 · visibleChildren()<br/>collapse +<br/>resource toggle"]
  B --> C["3 · buildElkNode()<br/>leaf size / collapsed size<br/>header padding"]
  C --> D["4 · ELK layered DOWN<br/>INCLUDE_CHILDREN<br/>orthogonal edges"]
  D --> E["5 · boxes + abs coords<br/>x y w h header"]
  E --> F["6 · SubFlowNode render<br/>relative pos<br/>extent:parent clamp"]
  F --> G["7 · drag override<br/>PATCH /api/nodes/id"]

  style A fill:#1b1236,stroke:#a78bfa,color:#ece4fb
  style D fill:#221745,stroke:#c4b5fd,color:#ece4fb
  style F fill:#1b1236,stroke:#34d399,color:#d9f8ec`;

export const CHART_ADMIN_OPS = `flowchart TB
  START(["Operator opens dashboard"]) --> LIVE{"Live stream open?"}
  LIVE -- "No · paused/closed" --> RECONNECT["Toggle LIVE · EventSource<br/>auto-reconnect 3s"]
  LIVE -- "Yes · tick 2s" --> TRIAGE{"Canvas signals?"}
  RECONNECT --> TRIAGE
  TRIAGE -- "rose pulse / critical" --> FOCUS["Click node → Inspector<br/>overview · metrics · children · cli"]
  TRIAGE -- "amber degraded" --> FOCUS
  TRIAGE -- "all green" --> EXPAND["Expand to INFRA/GROUP/SVC<br/>verify rollups"]
  FOCUS --> DECIDE{"Decision"}
  DECIDE -- "needs compute" --> RUNBOOK["Run runbook<br/>snapshot → restart → scale<br/>drain → failover"]
  DECIDE -- "false positive" --> HEALTHY["mark healthy<br/>PATCH status"]
  DECIDE -- "planned work" --> MAINT["maintain / resume<br/>excluded from rollup"]
  RUNBOOK --> WATCH["Watch SSE + sparklines<br/>confirm recovery"]
  HEALTHY --> WATCH
  MAINT --> WATCH
  WATCH --> ACK["Ack event in dock<br/>POST /api/events"]
  ACK --> DOCK{"More unacked?"}
  DOCK -- Yes --> FOCUS
  DOCK -- No --> DONE(["Estate green · export state"])
  EXPAND --> DONE`;

export const CHART_INTEGRATION_CHOOSER = `flowchart TB
  Q1{"Do you own the<br/>source system?"}
  Q1 -- "Yes · code access" --> PUSH["PUSH · embed agent<br/>POST /api/ingest/* every 15-60s"]
  Q1 -- "No · only infra access" --> Q2{"Does it expose<br/>Prometheus / stats?"}
  Q2 -- "Yes" --> PULL["PULL · collector polls<br/>then pushes to ingest"]
  Q2 -- "No · only logs/files" --> WATCH["WATCH · MinIO / DB trigger<br/>POST /api/ingest/events"]
  PUSH --> REG["1 · register topology<br/>parents first"]
  PULL --> REG
  WATCH --> REG
  REG --> MET["2 · push metrics<br/>cpu mem disk rps err lat"]
  MET --> EVT["3 · raise events<br/>deploy · alert · audit"]
  EVT --> READ["4 · read back<br/>GET /api/topology<br/>GET /api/stream SSE"]
  READ --> DONE(["Visible in sub-flow<br/>in under 2s"])`;

export const CHART_PUSH_SEQUENCE = `sequenceDiagram
  autonumber
  participant APP as Your service<br/>(Laravel/Spring/Node/Go/Rust/Py)
  participant REG as POST /api/ingest/nodes
  participant MET as POST /api/ingest/metrics
  participant EVT as POST /api/ingest/events
  participant OPS as Helios Ops<br/>engine + SSE
  participant UI as Canvas<br/>operator

  APP->>REG: register parents first<br/>{id, parentId, name, type}
  REG-->>APP: 200 ok
  APP->>REG: register service + endpoints
  REG-->>APP: 200 ok
  loop every 15-60s
    APP->>MET: snapshot {cpu, memory, disk, rps, err, lat}
    MET->>OPS: upsert + broadcast metrics
    OPS->>UI: SSE metrics (status derived)
  end
  APP->>EVT: deploy / exception / slow query
  EVT->>OPS: insert + broadcast event
  OPS->>UI: SSE event + critical escalation`;

export const CHART_MINIO_FLOW = `flowchart LR
  APP["App writes<br/>report.pdf"] --> S3["MinIO bucket<br/>reports/*"]
  S3 --> NOTIF["Bucket notification<br/>webhook POST"]
  NOTIF --> BRIDGE["Small bridge<br/>Node/Python/Go<br/>verifies + maps"]
  BRIDGE --> EVTOPS["POST /api/ingest/events<br/>severity info/warning"]
  BRIDGE --> METOPS["POST /api/ingest/metrics<br/>storage-node disk%"]
  EVTOPS --> SSE["SSE → dock row<br/>click to focus"]
  METOPS --> GAUGE["Disk gauge<br/>on storage node"]

  style S3 fill:#221745,stroke:#fbbf24,color:#fdeccb
  style BRIDGE fill:#1b1236,stroke:#a78bfa,color:#ece4fb`;
