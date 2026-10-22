import Link from "next/link";
import { Mermaid } from "@/components/guide/Mermaid";
import { CodeBlock } from "@/components/guide/CodeBlock";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  CHART_ADMIN_OPS,
  CHART_ER,
  CHART_HIERARCHY,
  CHART_INTEGRATION_CHOOSER,
  CHART_LAYOUT_PIPELINE,
  CHART_MINIO_FLOW,
  CHART_PUSH_SEQUENCE,
  CHART_REALTIME_SEQUENCE,
  CHART_SYSTEM_ARCHITECTURE,
} from "@/lib/guide-charts";
import {
  SAMPLE_CURL,
  SAMPLE_DATABASE,
  SAMPLE_GO,
  SAMPLE_LARAVEL,
  SAMPLE_MINIO,
  SAMPLE_NODE,
  SAMPLE_PYTHON,
  SAMPLE_RUST,
  SAMPLE_SPRING,
  SAMPLE_SSE,
} from "@/lib/guide-samples";

export const metadata = {
  title: "HELIOS OPS · User Guide — Architecture, Administration & Integration",
  description:
    "Complete operator and integrator manual: architecture patterns, administration runbooks, integration contracts and copy-paste samples for Laravel, Spring Boot, Node.js, Go, Rust, Python, Postgres and MinIO.",
};

const TOC: { href: string; label: string; depth: number }[] = [
  { href: "#quickstart", label: "60-second quickstart", depth: 0 },
  { href: "#arch", label: "1 · Architecture & patterns", depth: 0 },
  { href: "#arch-overview", label: "1.1 System overview", depth: 1 },
  { href: "#arch-hierarchy", label: "1.2 Hierarchy model", depth: 1 },
  { href: "#arch-frontend", label: "1.3 Frontend patterns", depth: 1 },
  { href: "#arch-backend", label: "1.4 Backend patterns", depth: 1 },
  { href: "#arch-data", label: "1.5 Data model", depth: 1 },
  { href: "#arch-realtime", label: "1.6 Realtime data-flow", depth: 1 },
  { href: "#arch-layout", label: "1.7 ELK layout pipeline", depth: 1 },
  { href: "#admin", label: "2 · Application administration", depth: 0 },
  { href: "#admin-daily", label: "2.1 Daily operator loop", depth: 1 },
  { href: "#admin-canvas", label: "2.2 Canvas & navigator", depth: 1 },
  { href: "#admin-inspector", label: "2.3 Inspector & CLI runbooks", depth: 1 },
  { href: "#admin-data", label: "2.4 Data, env & maintenance", depth: 1 },
  { href: "#admin-trouble", label: "2.5 Troubleshooting", depth: 1 },
  { href: "#integration", label: "3 · Integration pattern", depth: 0 },
  { href: "#integration-chooser", label: "3.1 Push / pull / watch", depth: 1 },
  { href: "#integration-contracts", label: "3.2 API contracts", depth: 1 },
  { href: "#integration-sequence", label: "3.3 Push sequence", depth: 1 },
  { href: "#integration-rules", label: "3.4 Mapping & status rules", depth: 1 },
  { href: "#samples", label: "4 · Sample integrations", depth: 0 },
  { href: "#sample-curl", label: "4.0 curl + SSE (any stack)", depth: 1 },
  { href: "#sample-laravel", label: "4.1 PHP Laravel", depth: 1 },
  { href: "#sample-spring", label: "4.2 Java Spring Boot", depth: 1 },
  { href: "#sample-node", label: "4.3 JavaScript Node.js", depth: 1 },
  { href: "#sample-go", label: "4.4 Golang", depth: 1 },
  { href: "#sample-rust", label: "4.5 Rust (Axum)", depth: 1 },
  { href: "#sample-python", label: "4.6 Python (FastAPI/Flask)", depth: 1 },
  { href: "#sample-database", label: "4.7 Database (Postgres)", depth: 1 },
  { href: "#sample-minio", label: "4.8 MinIO object storage", depth: 1 },
];

function Section({
  id,
  kicker,
  title,
  children,
}: {
  id: string;
  kicker?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-line-soft pb-10 pt-8 first:pt-2">
      {kicker ? (
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ice">{kicker}</p>
      ) : null}
      <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-100">{title}</h2>
      <div className="mt-4 flex flex-col gap-4 text-[13.5px] leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-[15px] font-semibold text-slate-100">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-slate-300">{children}</p>;
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[560px] border-collapse text-left font-mono text-[11px]">
        <thead>
          <tr className="bg-ink-850 text-[9.5px] uppercase tracking-[0.14em] text-slate-500">
            {head.map((h) => (
              <th key={h} className="border-b border-line px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line-soft/60 last:border-0 odd:bg-ink-900/40">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5 align-top text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ tone, title, children }: { tone: "ice" | "amber" | "rose" | "mint"; title: string; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    ice: "border-sky-500/30 bg-sky-500/[0.07]",
    amber: "border-amber-500/30 bg-amber-500/[0.07]",
    rose: "border-rose-500/30 bg-rose-500/[0.07]",
    mint: "border-emerald-500/30 bg-emerald-500/[0.07]",
  };
  return (
    <div className={`glass-inset rounded-lg border px-3 py-2.5 text-[12.5px] ${tones[tone]}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-200">{title}</p>
      <div className="mt-1 text-slate-300">{children}</div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      {/* top bar */}
      <header className="glass-bar flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400 transition hover:border-ice/50 hover:text-ice"
        >
          ← dashboard
        </Link>
        <div className="leading-tight">
          <h1 className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em] text-slate-100">
            Helios<span className="text-ice">·</span>Ops — user guide
          </h1>
          <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-500">
            architecture · administration · integration · samples
          </p>
        </div>
        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {[
            ["#arch", "architecture"],
            ["#admin", "administration"],
            ["#integration", "integration"],
            ["#samples", "samples"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded border border-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400 transition hover:border-line hover:text-ice"
            >
              {label}
            </a>
          ))}
        </nav>
        <ThemeToggle className="ml-auto lg:ml-1" />
      </header>

      <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-[1280px]">
        {/* TOC */}
        <aside className="hidden w-[248px] shrink-0 overflow-y-auto border-r border-line-soft px-3 py-4 md:block">
          <p className="px-1 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">on this page</p>
          <nav className="mt-2 flex flex-col">
            {TOC.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`rounded px-2 py-[3px] font-mono text-[10.5px] transition hover:bg-ink-850 hover:text-ice ${
                  item.depth === 0 ? "mt-1 font-semibold text-slate-300" : "pl-4 text-[10px] text-slate-500"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="glass-card mt-4 rounded-lg border border-line p-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">live endpoints</p>
            <ul className="mt-1.5 flex flex-col gap-1 font-mono text-[10px] text-slate-400">
              <li>GET /api/topology</li>
              <li>GET /api/stream (SSE)</li>
              <li>POST /api/ingest/nodes</li>
              <li>POST /api/ingest/metrics</li>
              <li>POST /api/ingest/events</li>
              <li>PATCH /api/nodes/[id]</li>
              <li>POST /api/cli/execute</li>
            </ul>
          </div>
        </aside>

        {/* content */}
        <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-8">
          {/* hero */}
          <div className="glass-card rounded-2xl border border-line bg-gradient-to-br from-ink-850/70 via-ink-900/50 to-ink-950/30 p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ice">
              hierarchical operation control &amp; monitoring
            </p>
            <h1 className="mt-1 max-w-[720px] text-[26px] font-semibold leading-tight tracking-tight text-slate-50">
              One canvas from holding company down to CPU gauge — and a documented way to plug every
              stack into it.
            </h1>
            <p className="mt-2 max-w-[760px] text-[13.5px] leading-relaxed text-slate-400">
              This guide is the single operator + integrator manual for the dashboard at{" "}
              <Link href="/" className="text-ice underline underline-offset-2">
                /
              </Link>
              . Part 1 explains the architecture and patterns, part 2 is the administration runbook,
              part 3 defines the integration pattern, and part 4 gives copy-paste agents for PHP
              Laravel, Java Spring Boot, JavaScript Node.js, Golang, Rust, Python, Postgres and MinIO.
              Every Mermaid diagram below includes its source so you can reuse it in your own docs.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em]">
              {["Next.js App Router", "ELK layered", "Zustand + SSE", "Drizzle + Postgres", "compound sub-flows", "extent:parent"].map(
                (chip) => (
                  <span key={chip} className="rounded border border-line bg-ink-950/60 px-2 py-1 text-slate-400">
                    {chip}
                  </span>
                ),
              )}
            </div>
          </div>

          <Section id="quickstart" kicker="start here" title="60-second quickstart">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["1 · see it", "Open the dashboard, press ALL in the expand-to strip, then fit. Org → division → project → datacenter → server/pod → service group → service → endpoint is one nested canvas."],
                ["2 · operate it", "Click any node for the inspector. Run snapshot → restart → scale from the CLI tab. Ack alerts in the dock. Dragging is clamped to the parent (extent:parent)."],
                ["3 · feed it", "Register your service with POST /api/ingest/nodes, push metrics every 20–30s, raise deploys as events. It appears on the canvas in under 2 seconds."],
              ].map(([t, d]) => (
                <div key={t} className="glass-card rounded-lg border border-line p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ice">{t}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-slate-300">{d}</p>
                </div>
              ))}
            </div>
            <CodeBlock title="quickstart — register + push + alert" language="bash" code={SAMPLE_CURL} />
          </Section>

          <Section id="arch" kicker="part 1" title="Architectural information and pattern">
            <P>
              The application is a full-stack Next.js control room. The mental model is simple:{" "}
              <strong className="text-slate-100">everything is a node in one tree</strong>, every
              container renders its children as a sub-flow, and ELK computes the nested layout while
              a 2-second SSE channel keeps only the metric leaves moving. Structure changes (collapse,
              filter, direction) re-run layout; metric ticks never do.
            </P>
          </Section>

          <Section id="arch-overview" kicker="1.1" title="System overview">
            <P>
              Client, server and data each own one job. The browser owns rendering and interaction,
              the App Router owns aggregation and fan-out, Postgres owns durable state. External
              systems never touch the database — they go through the ingest gateway, which keeps the
              in-memory engine and the canvas in sync within one tick.
            </P>
            <Mermaid chart={CHART_SYSTEM_ARCHITECTURE} title="fig 1 — system architecture (flowchart)" />
            <Table
              head={["layer", "lives in", "responsibility"]}
              rows={[
                ["browser shell", "app/page.tsx (server) + OpsDashboard (client)", "Initial fetch of the full hierarchy; then attaches EventSource. First paint already has topology."],
                ["canvas", "components/ops/Canvas.tsx + SubFlowNode", "Pan/zoom viewport, recursive sub-flow renderer, extent:parent drag clamp, orthogonal parent links."],
                ["cards", "components/ops/NodeCard.tsx", "Memoized cards: group header, host 3-gauge strip, service sparkline, endpoint SLA chip, resource arc gauge."],
                ["layout", "lib/elk-layout.ts (elkjs)", "Compound layered layout DOWN/RIGHT, header padding, collapsed sizes. Runs off the metric path."],
                ["state", "store/ops.ts (zustand)", "Separate slices: structure, metrics, series, events, view. Metric ticks update maps only — no layout rerun."],
                ["aggregation", "lib/topology-service.ts", "Single function feeding both SSR and GET /api/topology. Parents emitted before children."],
                ["realtime", "lib/telemetry.ts + /api/stream", "Mean-reversion simulation + rollups; SSE fan-out of metrics/event/cli messages with keep-alive."],
                ["ingest", "/api/ingest/*", "Push gateway for all external stacks. Validates, upserts, syncs engine, broadcasts."],
                ["persistence", "src/db/schema.ts (drizzle)", "ops_nodes tree, ops_metrics snapshot, rolling samples, events, command runs."],
              ]}
            />
            <Callout tone="ice" title="pattern names to use in reviews">
              Compound-graph sub-flows · layered hierarchical layout · server-component bootstrap +
              SSE hydration · slice-isolated store updates · gateway ingestion (never direct DB) ·
              average-rollup (never recursive sums) · parents-before-children invariant.
            </Callout>
          </Section>

          <Section id="arch-hierarchy" kicker="1.2" title="Hierarchy model — org to resource gauge">
            <P>
              Fourteen node types form one spine. The first eleven are <em>containers</em> (they can
              hold children); the last three are leaves. Servers, containers and pods always carry
              three resource children (CPU / Memory / Disk) rendered as arc gauges. The rule the
              whole renderer depends on: <strong className="text-slate-100">parents appear before
              children</strong> in every array, API payload and seed insert.
            </P>
            <Mermaid chart={CHART_HIERARCHY} title="fig 2 — hierarchy spine (flowchart)" />
            <Table
              head={["level", "type key", "container?", "what it means"]}
              rows={[
                ["0 · holding", "organization", "yes", "Helios Enterprise Group. Root of the canvas."],
                ["1 · division", "sub_org", "yes", "Cloud Platform / Retail Operations. Budget + owner."],
                ["2 · programme", "project", "yes", "Core Commerce, Data, Store Systems, Payments."],
                ["3 · epic", "sub_project", "yes", "Checkout Modernization, Ledger Rewrite… Leaf of the org tree."],
                ["4 · facility", "datacenter", "yes", "eu-west-1, us-east-1… PUE, feeds, capacity."],
                ["5a · host", "server", "yes", "Bare-metal / VM / EC2 + 3 gauges. IP, rack, OS."],
                ["5b · k8s scope", "namespace", "yes", "ns/prod-* + cluster, quotas, network policy."],
                ["6a · runtime", "container", "yes", "Docker engine + image + 3 gauges."],
                ["6b · runtime", "pod", "yes", "Deployment pod + phase/restarts + 3 gauges."],
                ["7 · domain", "service_group", "yes", "Commerce, Treasury, Risk… business domains."],
                ["8 · sub-domain", "service_sub_group", "yes", "Payment Orchestration, Basket & Pricing…"],
                ["9 · workload", "service", "no", "checkout-api v2.4.1 + protocol, RPS, p99, error %."],
                ["10 · operation", "endpoint", "no", "METHOD + path + SLA + auth. SLO chip turns rose over budget."],
                ["H · gauge", "resource", "no", "CPU/Memory/Disk arc gauge mirroring its host. Toggleable."],
              ]}
            />
          </Section>

          <Section id="arch-frontend" kicker="1.3" title="Frontend patterns">
            <H3>Recursive sub-flows with extent:parent</H3>
            <P>
              Each <code className="font-mono text-[12px] text-ice">SubFlowNode</code> renders its own
              card plus its children positioned <em>relative</em> to it. Dragging is clamped to{" "}
              <code className="font-mono text-[12px] text-ice">[0, parent − self]</code> so a child can
              never leave its container — the DOM equivalent of the flutter_flow_chart{" "}
              <code className="font-mono text-[12px] text-ice">extent: parent</code> constraint.
              Double-click collapses a branch; collapse state persists via PATCH.
            </P>
            <H3>Memoization discipline</H3>
            <P>
              Cards are <code className="font-mono text-[12px] text-ice">React.memo</code> and subscribe
              to single keys (<code className="font-mono text-[12px] text-ice">s.metrics[id]</code>,{" "}
              <code className="font-mono text-[12px] text-ice">s.nodesById[id]</code>) instead of whole
              arrays. A 2-second tick with 456 nodes therefore re-renders only gauges and sparklines —
              never the layout. The navigator tree, search index and rollups read from precomputed{" "}
              <code className="font-mono text-[12px] text-ice">childrenOf / depthOf / descendantCount</code> maps.
            </P>
            <H3>Viewport</H3>
            <P>
              Wheel pans, Ctrl+wheel zooms to cursor (0.06–2.4×), backdrop drag pans, Fit centres the
              estate, Focus expands collapsed ancestors then centres the node. First paint prefers a
              legible zoom over a fully-zoomed-out estate on wide hierarchies.
            </P>
          </Section>

          <Section id="arch-backend" kicker="1.4" title="Backend patterns">
            <H3>One aggregation point</H3>
            <P>
              <code className="font-mono text-[12px] text-ice">getTopologyPayload()</code> is the only
              place that joins nodes + metrics + series + events + runs. Both the server component and{" "}
              <code className="font-mono text-[12px] text-ice">GET /api/topology</code> call it, so SSR
              and client bootstrap can never diverge.
            </P>
            <H3>Bounded simulation that behaves like Prometheus/Docker/K8s</H3>
            <P>
              Each monitored node mean-reverts toward a drifting operating point (no random-walk
              explosions), spikes are rare and damped, and ceilings cap every channel. Group nodes roll
              up with <strong className="text-slate-100">averages — never sums</strong> (the same
              request is measured at host, workload, service and endpoint, so sums would compound it).
              Status derives from thresholds (cpu &gt; 92 / err &gt; 5 → critical; cpu &gt; 79 / err
              &gt; 1.4 / mem &gt; 88 → degraded) and groups take the worst child status, except
              maintenance which is sticky.
            </P>
            <H3>CLI executor as audited side-effects</H3>
            <P>
              Runbooks (snapshot, restart, scale +2, drain, logs, failover) stream output line-by-line
              over SSE, persist to <code className="font-mono text-[12px] text-ice">ops_command_runs</code>,
              and apply real topology effects: restart halves CPU/memory targets, drain sets maintenance,
              scale bumps replicas. Risky runbooks can fail closed with an exit-1 audit trail.
            </P>
          </Section>

          <Section id="arch-data" kicker="1.5" title="Data model">
            <P>
              Five tables. The tree is one self-referencing table; everything else hangs off it with
              cascading deletes. Samples are pruned to a rolling 50-minute window so sparklines stay
              cheap.
            </P>
            <Mermaid chart={CHART_ER} title="fig 3 — entity-relationship (erDiagram)" />
          </Section>

          <Section id="arch-realtime" kicker="1.6" title="Realtime data-flow">
            <Mermaid chart={CHART_REALTIME_SEQUENCE} title="fig 4 — bootstrap + tick loop (sequenceDiagram)" />
            <P>
              Message shapes on <code className="font-mono text-[12px] text-ice">GET /api/stream</code>:{" "}
              <code className="font-mono text-[12px] text-ice">hello</code> (tick, nodeCount),{" "}
              <code className="font-mono text-[12px] text-ice">metrics</code> (full update array every
              2s), <code className="font-mono text-[12px] text-ice">event</code> (single alert),{" "}
              <code className="font-mono text-[12px] text-ice">cli</code> (run + optional line). Lines
              starting with <code className="font-mono text-[12px] text-ice">:</code> are keep-alives —
              ignore empty <code className="font-mono text-[12px] text-ice">data</code> frames.
            </P>
          </Section>

          <Section id="arch-layout" kicker="1.7" title="ELK layout pipeline">
            <Mermaid chart={CHART_LAYOUT_PIPELINE} title="fig 5 — structure-only layout (flowchart)" />
            <P>
              ELK options that matter: <code className="font-mono text-[12px] text-ice">layered</code>{" "}
              algorithm, <code className="font-mono text-[12px] text-ice">direction DOWN|RIGHT</code>,{" "}
              <code className="font-mono text-[12px] text-ice">hierarchyHandling INCLUDE_CHILDREN</code>,{" "}
              <code className="font-mono text-[12px] text-ice">elk.padding top = header height</code> so
              children clear the card header, orthogonal edge routing, and minimum sizes per type.
              Collapsed containers become fixed-size leaves, which is what keeps a 456-node estate
              laying out in ~150–600ms.
            </P>
          </Section>

          <Section id="admin" kicker="part 2" title="Application administration">
            <P>
              This is the runbook for humans. If you operate the estate, read this section end to end;
              everything else is reference.
            </P>
            <Mermaid chart={CHART_ADMIN_OPS} title="fig 6 — operator loop (flowchart)" />
          </Section>

          <Section id="admin-daily" kicker="2.1" title="Daily operator loop">
            <Table
              head={["step", "where", "what good looks like"]}
              rows={[
                ["1 · stream check", "Top bar right", "LIVE pill green, stream open, tick advancing every ~2s, last-tick says seconds ago."],
                ["2 · estate glance", "Top stat tiles", "Critical 0, degraded 0–2, avg CPU < 70%, p99 within SLO, error rate < 0.4%."],
                ["3 · triage", "Canvas", "No rose pulse. Amber nodes get clicked first. Dimmed nodes are just filtered, not gone."],
                ["4 · inspect", "Inspector → overview", "Gauges + sparklines agree, subtree health lists only known offenders, updated Xs ago is fresh."],
                ["5 · act", "Inspector → CLI", "snapshot before restart; scale before failover; drain before host work. Watch the run stream."],
                ["6 · close out", "Dock → events", "Every warning/critical is acked with a title that explains itself. Unacked count returns to 0."],
              ]}
            />
            <Callout tone="amber" title="severity honesty">
              Critical means page someone. Degraded means watch it this shift. Offline means the agent is
              silent (check the collector before the app). Maintenance is intentional and excluded from
              rollups — don&apos;t use it to hide a real incident.
            </Callout>
          </Section>

          <Section id="admin-canvas" kicker="2.2" title="Canvas & navigator">
            <Table
              head={["control", "location", "effect"]}
              rows={[
                ["expand-to ORG…ALL", "Top bar strip", "Collapses everything deeper than the chosen depth, then fits. ALL on 400+ nodes will be wide — prefer INFRA/GROUP."],
                ["resource gauge nodes", "Top bar checkbox", "Shows/hides the CPU/Memory/Disk children. Off by default for readability; hosts still show their 3-gauge strip."],
                ["elk.direction", "Top bar", "DOWN for org trees, RIGHT for deep service chains. Triggers relayout + fit."],
                ["spacing slider", "Top bar", "Node/layer gaps. Larger values help screenshots, smaller values help overviews."],
                ["auto-layout", "Top bar", "Discards all manual drag offsets and re-runs ELK. Use after a messy triage session."],
                ["search", "Top bar input", "Matches name, id, kind, region, owner. Canvas dims non-matches; navigator switches to match list."],
                ["status filter", "Left rail bottom", "Dims everything not in the chosen severities. Combine with search for on-call views."],
                ["navigator tree", "Left rail", "Mirrors the canvas. Chevron collapses the sub-flow; row click focuses + centres the node."],
                ["drag node", "Canvas", "Moves within the parent only (extent:parent). Offset persists via PATCH on release."],
                ["double-click", "Canvas group", "Collapses/expands that sub-flow in place without moving the viewport."],
                ["reseed", "Top bar", "Rebuilds the 456-node reference dataset. Destroys manual edits — confirm before pressing in shared envs."],
                ["theme", "Top bar · guide header", "Switches between the dark and light purple glassmorphism themes. The choice is stored per browser; until one is made the OS preference is followed."],
              ]}
            />
            <Callout tone="ice" title="appearance & design tokens">
              All chrome is glass: translucent surfaces, a 22px backdrop blur, 1px lavender
              borders and a soft inner highlight. Colours live in{" "}
              <code className="font-mono text-[12px] text-ice">src/app/globals.css</code> as CSS
              variables — <code className="font-mono text-[12px] text-ice">--ink-*</code> for
              surfaces, <code className="font-mono text-[12px] text-ice">--accent</code> for the
              purple interactive accent,{" "}
              <code className="font-mono text-[12px] text-ice">--type-*</code> per node type and{" "}
              <code className="font-mono text-[12px] text-ice">--glass-*</code> for the glass
              recipe. Both themes resolve the same tokens, so a rebrand is a value change rather
              than a component change.
            </Callout>
          </Section>

          <Section id="admin-inspector" kicker="2.3" title="Inspector & CLI runbooks">
            <Table
              head={["tab", "use it for"]}
              rows={[
                ["overview", "Gauges, sparklines, subtree health, owner/region/meta. The 30-second brief on any node."],
                ["metrics", "Full bars, net I/O, RPS, p99, errors, uptime, replicas + the collector query behind the numbers."],
                ["children", "Direct children with live CPU/RPS. Fastest way to find which child is poisoning a group rollup."],
                ["cli", "Six runbooks with live streaming output. snapshot/logs are read-only; restart/drain/failover are privileged and audited."],
              ]}
            />
            <Table
              head={["runbook", "risk", "what it does to the topology"]}
              rows={[
                ["capture resource snapshot", "read-only", "No change. Dumps cpu/mem/disk/net/RPS/latency into the run log."],
                ["tail last 200 log lines", "read-only", "No change. Streams recent logs for triage."],
                ["restart workload", "privileged", "Halves CPU/memory operating targets, clears error rate. Node returns to healthy."],
                ["scale replicas +2", "standard", "Bumps replicasDesired/Ready by 2 on the live snapshot."],
                ["cordon + drain host", "privileged", "Sets status maintenance (sticky, excluded from rollups) while work proceeds."],
                ["failover to standby", "privileged", "Marks healthy after traffic shift; raises a cli-executor audit event."],
              ]}
            />
          </Section>

          <Section id="admin-data" kicker="2.4" title="Data, environment & maintenance">
            <Table
              head={["item", "detail"]}
              rows={[
                ["seed", "First request to /api/topology seeds 456 nodes + baselines + 48 history points + 46 events. POST /api/admin/reseed rebuilds it."],
                ["DATABASE_URL", "Postgres connection string in .env. Health probe: GET /api/health returns {ok:true}."],
                ["persistence cadence", "Snapshots every 10s, sparkline samples every 30s, samples pruned beyond 50 minutes."],
                ["drag/collapse/status", "Persisted per node via PATCH /api/nodes/[id] {x, y, collapsed, status}."],
                ["events", "GET /api/events?limit=60, POST {id} or {all:true} to acknowledge."],
                ["runs", "Every CLI execution is stored with operator, exit code and full output; streamed over SSE."],
                ["backups", "Standard pg_dump of the five ops_* tables is sufficient. Reseed can regenerate reference data from scratch."],
              ]}
            />
            <CodeBlock
              title="ops housekeeping — shell"
              language="bash"
              code={`# health + counts
curl -s localhost:3000/api/health
curl -s localhost:3000/api/topology | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['nodes']), 'nodes')"

# acknowledge every alert (e.g. after a maintenance window)
curl -s -X POST localhost:3000/api/events -H 'content-type: application/json' -d '{"all":true}'

# rebuild reference data
curl -s -X POST localhost:3000/api/admin/reseed

# database sizes
psql $DATABASE_URL -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
psql $DATABASE_URL -c "SELECT count(*) FROM ops_nodes; SELECT count(*) FROM ops_metric_samples;"`}
            />
          </Section>

          <Section id="admin-trouble" kicker="2.5" title="Troubleshooting">
            <Table
              head={["symptom", "likely cause → fix"]}
              rows={[
                ["canvas empty / loading forever", "/api/topology failing → check DATABASE_URL, GET /api/health, server logs for [telemetry] errors."],
                ["stream stuck on connecting", "Proxy buffering SSE → ensure X-Accel-Buffering:no passthrough; toggle LIVE off/on to reconnect."],
                ["metrics frozen but stream open", "Engine not ticking → restart app; simulator ticks every 2s and unrefs its timer."],
                ["absurd RPS/network numbers", "Old build persisted recursive sums → POST /api/admin/reseed once; current rollups use averages."],
                ["node missing after ingest", "Parent registered after child → re-POST parents first; unknown parentId returns 400 by design."],
                ["layout takes seconds", "ALL depth + resource gauges on 400+ nodes → drop to GROUP depth, hide resource nodes, then fit."],
                ["dragged node lost offscreen", "Stale override → press auto-layout to discard offsets, or PATCH x/y back to null."],
              ]}
            />
          </Section>

          <Section id="integration" kicker="part 3" title="Integration pattern">
            <P>
              Three verbs cover every integration: <strong className="text-slate-100">register the
              shape</strong> (nodes), <strong className="text-slate-100">push the signals</strong>{" "}
              (metrics), <strong className="text-slate-100">raise what matters</strong> (events). Read
              the estate back with the topology snapshot and the SSE stream. Nothing writes to Postgres
              directly — the ingest gateway is the contract.
            </P>
            <Mermaid chart={CHART_INTEGRATION_CHOOSER} title="fig 7 — push / pull / watch chooser (flowchart)" />
          </Section>

          <Section id="integration-contracts" kicker="3.2" title="API contracts">
            <H3>POST /api/ingest/nodes — shape</H3>
            <Table
              head={["field", "required", "rule"]}
              rows={[
                ["id", "yes", "Stable, globally unique. Convention: parent::child::leaf, e.g. org-acme::svc-billing."],
                ["parentId", "for children", "Must already exist. Parents-before-children is enforced with 400 otherwise."],
                ["name", "yes", "Human label shown on the card."],
                ["type", "yes", "One of organization, sub_org, project, sub_project, datacenter, namespace, server, container, pod, service_group, service_sub_group, service, endpoint, resource."],
                ["kind / region / owner", "no", "Shown as chips. kind doubles as runtime line on hosts (php8.3 / laravel11)."],
                ["status", "no", "healthy|degraded|critical|offline|maintenance. Defaults healthy."],
                ["meta", "no", "Free JSON. Services: protocol/version. Endpoints: method/path/slaMs/auth."],
              ]}
            />
            <H3>POST /api/ingest/metrics — signals</H3>
            <Table
              head={["field", "unit", "notes"]}
              rows={[
                ["nodeId", "—", "Must be registered. Unknown ids return 404 with a pointer to /nodes."],
                ["cpu / memory / disk", "% 0–100", "Clamped server-side. Hosts should send all three; services may send cpu/memory."],
                ["requestsPerSec (rps alias)", "ops/s", "Per-interval rate, not a lifetime counter. Capped at 20000."],
                ["errorRate", "%", ">5 → critical, >1.4 → degraded (unless offline/maintenance)."],
                ["latencyMs", "ms p99", "Endpoint SLA chip compares against meta.slaMs."],
                ["uptimePct", "%", "Rolls up as the minimum of children — one weak leg drags the group."],
                ["replicasReady/Desired", "count", "Services/pods only. Feeds the replicas tile and scale runbook."],
                ["source", "enum", "prometheus|docker|kubernetes|agent. Shown as the collector chip."],
              ]}
            />
            <H3>POST /api/ingest/events — what matters</H3>
            <Table
              head={["field", "rule"]}
              rows={[
                ["title", "Required, ≤240 chars. Write it like a headline: Deployed billing-api v2.4.0."],
                ["severity", "info|warning|critical. Critical also escalates the node status on the canvas."],
                ["source", "Free label: laravel, spring, minio, postgres-trigger, deploy-pipeline…"],
                ["nodeId", "Optional but recommended — makes the dock row clickable to focus."],
                ["detail", "Optional ≤2000 chars: ship SHA, SQL snippet, bucket key, stack head."],
              ]}
            />
            <H3>Reading back</H3>
            <Table
              head={["endpoint", "use"]}
              rows={[
                ["GET /api/topology", "Full snapshot: nodes (parents first), metrics map, 24-point series, 60 events, 25 runs. Poll every 30–60s or once at boot."],
                ["GET /api/stream", "SSE channel: hello → metrics every 2s → event → cli. Reconnect with backoff; ignore : keep-alive frames."],
                ["GET /api/ingest/metrics?nodeId=…", "Latest snapshot for one node. Handy for smoke tests after pushing."],
                ["PATCH /api/nodes/[id]", "{x, y, collapsed, status} — operators own the view; agents should not call this in loops."],
              ]}
            />
            <Callout tone="mint" title="reliability contract">
              Telemetry must never break business traffic: 4-second timeouts, fire-and-forget with a
              warning log, batch the heartbeat on a 15–60s ticker (not per request), and register
              topology once at boot — not on every tick. All samples in part 4 follow this rule.
            </Callout>
          </Section>

          <Section id="integration-sequence" kicker="3.3" title="Push sequence">
            <Mermaid chart={CHART_PUSH_SEQUENCE} title="fig 8 — register → heartbeat → alert (sequenceDiagram)" />
          </Section>

          <Section id="integration-rules" kicker="3.4" title="Mapping & status rules">
            <Table
              head={["your world", "helios node"]}
              rows={[
                ["company / tenant", "organization"],
                ["business unit / division", "sub_org"],
                ["programme / portfolio", "project → sub_project"],
                ["region / AZ / facility", "datacenter"],
                ["VM / bare-metal / EC2 host", "server (+3 resource gauges)"],
                ["docker host workload", "container (+3 gauges)"],
                ["k8s workload", "namespace → pod (+3 gauges)"],
                ["bounded context", "service_group → service_sub_group"],
                ["deployable / API", "service (protocol, version, RPS, p99, err%)"],
                ["route / RPC / topic", "endpoint (method, path, slaMs, auth)"],
                ["cpu/mem/disk probe", "resource gauge (usually auto-created; toggleable)"],
              ]}
            />
            <Table
              head={["signal", "healthy", "degraded", "critical"]}
              rows={[
                ["cpu %", "< 79", "79–92 or mem > 88", "> 92"],
                ["errorRate %", "≤ 1.4", "1.4–5", "> 5"],
                ["groups", "all children healthy", "any child degraded", "any child critical (maintenance excluded)"],
                ["uptime rollup", "min of children", "min < 99.9 draws amber attention", "min < 98.5 pages"],
              ]}
            />
            <Callout tone="amber" title="two invariants">
              1) Parents before children — in seed files, in registration order, and in every payload.
              2) Averages roll up, sums don&apos;t — if you pre-aggregate RPS across replicas, send the
              average per replica or the gateway will smooth it again on the way up.
            </Callout>
          </Section>

          <Section id="samples" kicker="part 4" title="Sample integrations">
            <P>
              Each sample below is self-contained: registration, heartbeat and alerting in the
              framework&apos;s own idioms. Replace{" "}
              <code className="font-mono text-[12px] text-ice">https://your-ops-host</code> and the{" "}
              <code className="font-mono text-[12px] text-ice">org-acme::…</code> ids, then verify with
              the curl smoke test and the SSE consumer.
            </P>
          </Section>

          <Section id="sample-curl" kicker="4.0" title="curl + SSE — works from any stack">
            <P>
              Use this to prove the contract before writing the agent. It registers a service, pushes
              one snapshot, raises one event, then shows how to read the estate back.
            </P>
            <CodeBlock title="contract smoke test" language="bash" code={SAMPLE_CURL} />
            <H3>Live consumer (paste into any page or Node script)</H3>
            <CodeBlock title="follow the stream" language="javascript" code={SAMPLE_SSE} />
          </Section>

          <Section id="sample-laravel" kicker="4.1" title="PHP Laravel">
            <P>
              A config file, a reporter service, a minutely heartbeat command and an exception hook.
              Schedule the heartbeat with the Laravel scheduler; report exceptions without ever
              breaking the request.
            </P>
            <CodeBlock title="laravel — config + reporter + heartbeat + handler" language="php" code={SAMPLE_LARAVEL} />
            <Callout tone="ice" title="laravel notes">
              Register topology inside the heartbeat (idempotent upsert) so fresh environments
              self-register. Map queue workers to a second service node and Horizon metrics to RPS.
            </Callout>
          </Section>

          <Section id="sample-spring" kicker="4.2" title="Java Spring Boot">
            <P>
              Non-blocking WebClient reporter, a Micrometer-backed{" "}
              <code className="font-mono text-[12px] text-ice">@Scheduled</code> heartbeat and a{" "}
              <code className="font-mono text-[12px] text-ice">@ControllerAdvice</code> that turns
              exceptions into warning events.
            </P>
            <CodeBlock title="spring boot — reporter + heartbeat + advice" language="java" code={SAMPLE_SPRING} />
          </Section>

          <Section id="sample-node" kicker="4.3" title="JavaScript Node.js">
            <P>
              A 60-line agent module: topology registration, process-stat snapshots, an interval
              heartbeat and Express middleware that observes latency and forwards 5xx as events.
            </P>
            <CodeBlock title="node — agent + express wiring" language="javascript" code={SAMPLE_NODE} />
          </Section>

          <Section id="sample-go" kicker="4.4" title="Golang">
            <P>
              A small <code className="font-mono text-[12px] text-ice">internal/ops</code> package with
              a ticker heartbeat and chi-style middleware. Telemetry failures are swallowed by design.
            </P>
            <CodeBlock title="go — reporter + heartbeat + middleware sketch" language="go" code={SAMPLE_GO} />
          </Section>

          <Section id="sample-rust" kicker="4.5" title="Rust web framework (Axum)">
            <P>
              Typed reporter with <code className="font-mono text-[12px] text-ice">reqwest + serde</code>,
              host stats from <code className="font-mono text-[12px] text-ice">sysinfo</code>, spawned
              heartbeat task and one-line event calls from handlers.
            </P>
            <CodeBlock title="rust — reporter + axum wiring" language="rust" code={SAMPLE_RUST} />
          </Section>

          <Section id="sample-python" kicker="4.6" title="Python (FastAPI / Flask / workers)">
            <P>
              One importable module for every Python runtime: registration, snapshot push, event
              raising, a <code className="font-mono text-[12px] text-ice">BaseHTTPMiddleware</code> for
              FastAPI and a worker heartbeat loop using{" "}
              <code className="font-mono text-[12px] text-ice">psutil</code>.
            </P>
            <CodeBlock title="python — agent + middleware + worker loop" language="python" code={SAMPLE_PYTHON} />
          </Section>

          <Section id="sample-database" kicker="4.7" title="Database (PostgreSQL)">
            <P>
              No app changes needed. Pattern A pushes a minutely heartbeat with{" "}
              <code className="font-mono text-[12px] text-ice">pg_cron + pg_net</code>, pattern B turns
              failed inserts into warning events via trigger, pattern C is a cron sidecar when the
              extensions aren&apos;t available.
            </P>
            <CodeBlock title="postgres — heartbeat + trigger + sidecar" language="sql" code={SAMPLE_DATABASE} />
          </Section>

          <Section id="sample-minio" kicker="4.8" title="MinIO object storage">
            <P>
              MinIO can&apos;t speak the ingest API directly, so a 30-line bridge receives bucket
              notifications and maps them to events (one row per object) plus a storage-node disk
              gauge. Register the MinIO host as a server node first.
            </P>
            <Mermaid chart={CHART_MINIO_FLOW} title="fig 9 — minio webhook bridge (flowchart)" />
            <CodeBlock title="minio — mc config + flask bridge" language="bash" code={SAMPLE_MINIO} />
            <Callout tone="mint" title="you are integrated when…">
              The service appears under its parent in the navigator, its card shows fresh RPS/p99, the
              endpoint SLA chip is green, a deploy produces a dock row, and forcing an error turns the
              node amber then rose within two ticks. If all five hold, wire the heartbeat into your
              scheduler and move on.
            </Callout>
          </Section>

          <footer className=" flex flex-col gap-2 pt-8 text-[12px] text-slate-500">
            <p>
              Helios Ops user guide · rendered alongside the dashboard · diagrams are Mermaid with
              sources inline · samples target the live contracts at{" "}
              <code className="font-mono text-[11px] text-slate-300">/api/ingest/*</code>,{" "}
              <code className="font-mono text-[11px] text-slate-300">/api/topology</code> and{" "}
              <code className="font-mono text-[11px] text-slate-300">/api/stream</code>.
            </p>
            <Link href="/" className="w-fit rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400 transition hover:border-ice/50 hover:text-ice">
              ← back to live control room
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
