# Helios·Ops — Architecture, Administration & Integration

**Presentation outline, slide descriptions and speaker notes**  
Companion document to `doc/helios-ops-architecture-deck.pptx` · 27 slides · approximately 45 minutes including questions  
Source of truth for every claim: the `/guide` manual and the running application in this repository.

---

## About this deck

**Helios·Ops** is a hierarchical operations control room. It joins two truths that normally live apart: the
 organisational truth (holding company → division → programme → datacenter → host → workload) and the
 operational truth (CPU, memory, error rate, p99, replicas). Both are expressed as one self-referencing tree,
 rendered as nested sub-flows on a single canvas and refreshed every two seconds over server-sent events.

This deck is a working briefing in three movements. **Part 1** gives the case and the mental model — fourteen
node types, eleven of which are containers that render their own children. **Part 2** is the architecture:
a single aggregation point, a bounded telemetry engine, five tables, an SSE loop and a structure-only ELK
layout pipeline. **Part 3** is the operator runbook: the anatomy of the screen, the six-step shift loop, the
controls, the inspector, the six audited runbooks and the failure modes you will actually see. **Part 4** is
the integration contract — register, push, raise, read back — with push/pull/watch modes, exact payloads,
mapping rules and eight stack recipes. **Part 5** closes with a five-minute acceptance test, a production
roadmap and the five sentences worth remembering.

Every slide carries speaker notes written as a talk track, not as a summary: they explain what to say, in what
order, and which objection each slide is answering. The deck is designed to be presented at 40–45 minutes and
cut to 30 by dropping the per-stack samples (slide 23 details) and compressing slides 7–11.

### How to use it

- **Presenting:** every slide is 16:9 with a dark control-room palette; notes are visible in presenter view only.
- **As a leave-behind:** the slides stand alone — each has a one-sentence description under the title.
- **For a review:** slides 5–11 are the architecture record; 18–22 are the integration contract.
- **For onboarding an operator:** 12–17 plus the daily loop on slide 13.

---

## Outline at a glance

| # | Section | Slide | Focus |
|---|---------|-------|-------|
| 01 | Opening | Helios·Ops — one canvas from holding company to CPU gauge | What the product is, in one sentence and one picture |
| 02 | Foundations | Why Helios·Ops exists | The problem, the idea and the payoff — plus the deck thesis |
| 03 | Foundations | What we will cover | Five parts with timings |
| 04 | Foundations | The product in numbers | The reference estate in numbers |
| 05 | Architecture & patterns | Client, server and data each own one job | Client, server and data — one job each |
| 06 | Architecture & patterns | Everything is a node — containers are sub-flows | Fourteen node types, eleven containers |
| 07 | Architecture & patterns | Recursive sub-flows, memoized cards, a calm viewport | Recursive sub-flows, memoized cards, calm viewport |
| 08 | Architecture & patterns | One aggregation point, a bounded engine, audited actions | One aggregation point, a bounded engine, audited actions |
| 09 | Architecture & patterns | Five tables, one self-referencing tree | Five tables and one self-referencing tree |
| 10 | Architecture & patterns | Bootstrap once, then tick every two seconds | Bootstrap once, then tick every two seconds |
| 11 | Architecture & patterns | Layout is a structure problem, not a metric problem | Layout is a structure problem |
| 12 | Application administration | Six regions, one operating picture | Six regions of the control room |
| 13 | Application administration | A shift has six steps, and a definition of done | The six-step operator loop |
| 14 | Application administration | Depth is a lens, not a filter | Depth is a lens, not a filter |
| 15 | Application administration | Four tabs answer four different questions | Four inspector tabs, four questions |
| 16 | Application administration | Six actions, three of them privileged | Six runbooks, three privileged |
| 17 | Application administration | Operate the data plane, then fix the classics | Data plane and the six classic failures |
| 18 | Integration pattern | Three verbs, one read-back | Three verbs and one read-back |
| 19 | Integration pattern | Push, pull or watch — pick by what you control | Push, pull or watch |
| 20 | Integration pattern | What goes in, what comes back | Payload fields and read endpoints |
| 21 | Integration pattern | Register once, heartbeat forever, alert on change | Register, heartbeat, alert |
| 22 | Integration pattern | Translate your world into the tree | Mapping your world onto the tree |
| 23 | Integration pattern | Eight stacks, one contract | Eight stacks, one contract |
| 24 | Wrap-up | The five-minute acceptance test | The five-minute acceptance test |
| 25 | Wrap-up | What it takes to run this for real | Six workstreams to production |
| 26 | Wrap-up | Five sentences to remember | Five sentences to remember |
| 27 | Appendix | Glossary and where to go next | Glossary and where to go next |

---

## Slide-by-slide: description and speaker notes

### Opening

#### 01 · Helios·Ops — one canvas from holding company to CPU gauge

*Opening title: the product in one sentence, over a live sub-flow motif that shows a pod, its service and three resource gauges.*

**Speaker notes**

Welcome. This is Helios·Ops — the hierarchical control and monitoring plane for the estate.

The deck is the presentation companion to the live product at / and its operator manual at /guide. It has three jobs: first, explain the architecture and the handful of patterns that make it hold together; second, give operators a shift runbook they can follow; third, give integration teams the exact contract for feeding the platform from any stack.

Framing line for the room: most monitoring tools stop at hosts, and most org charts stop at projects. Helios·Ops joins the two — one navigable tree from holding company to CPU gauge, with a two-second live truth.

Suggested pacing: about 45 minutes including questions. If you have 30, present slides 1–6, 12–15, 18–22 and 24; the rest are reference. Tell the audience that every slide has detailed speaker notes and that the full text lives in the outline document.

### Foundations

#### 02 · Why Helios·Ops exists

`01 · THE CASE`

*Infrastructure dashboards usually stop at hosts; org charts stop at projects. Helios·Ops joins them into one navigable tree — and turns telemetry into a contract, not a screenshot.*

**Speaker notes**

Start with the tension, not the technology.

Every large estate has two truths that never meet. The operational truth — CPU, memory, error rate, p99 — lives in Prometheus, Docker, Kubernetes or a framework agent. The organisational truth — which division owns the programme, which datacenter hosts it, which team is on call — lives in an org chart or a spreadsheet. When something breaks, humans spend the first ten minutes rebuilding the link between those two truths.

Helios·Ops makes that link structural. One self-referencing tree holds every level. Containers are not just folders: they render their children as compound sub-flows, so the canvas itself is the org chart and the topology at the same time. The visual grammar is consistent at every depth.

The second idea is separation of update paths. Structure changes rarely and triggers layout. Metrics change every two seconds and only repaint gauges and sparklines. That is what keeps a 456-node estate usable.

The payoff is on the right: one screen, six audited actions, and an integration contract that eight different stacks already follow. If the audience remembers one sentence, make it this: one tree, one contract, one loop.

#### 03 · What we will cover

`02 · OUTLINE`

*Five parts, about 45 minutes including questions. Part 2 ends with a demo checkpoint on the live control room.*

**Speaker notes**

Give the room the shape of the next 45 minutes so they know when to ask detail questions.

Part 1 is the case and the vocabulary. If the audience is mixed — operators, engineers, managers — this is where everyone gets the same mental model. The key idea is the 14-type tree and the fact that containers render their own children.

Part 2 is the architecture. We move from the system map down through the frontend, backend, data model, realtime loop and layout pipeline. This is the material for architecture review; if the room is purely operational, you can compress slides 7–11 and spend the time on Part 3 instead.

Part 3 is the operator runbook: what the screen is made of, what a shift looks like, which controls exist, and what to do when something is wrong.

Part 4 is for integrators. The three verbs — register, push, raise — plus the read-back options, then the eight stack recipes.

Part 5 closes with acceptance criteria and the production roadmap. The glossary is appendix material; use it if the audience is new to the vocabulary.

Housekeeping: the live dashboard is at /, the full manual with Mermaid sources at /guide, and this deck has a companion outline document with every speaker note in text.

#### 04 · The product in numbers

`03 · AT A GLANCE`

*A reference estate ships with the app: 456 nodes across 14 types, five tables, six runbooks, and a documented bridge for eight stacks.*

**Speaker notes**

These numbers are not marketing estimates; they are the deterministic reference dataset and the shipped configuration.

Fourteen node types, of which eleven are containers that can hold children. The three leaves are service, endpoint and resource. The reference estate has 456 nodes: one holding company, two divisions, four projects, five sub-projects, nine datacenters, and then the infrastructure under them — 12 servers, 19 containers, 22 pods, 9 namespaces, 41 service groups and sub-groups, 41 services, 91 endpoints and 159 resource gauges.

The live plane updates every two seconds over server-sent events. Durable snapshots are written every ten seconds, sparkline samples every thirty seconds, and samples older than fifty minutes are pruned.

Six runbooks: three read-only — snapshot, logs, scale — and three privileged — restart, drain, failover. Five tables hold the whole product: the node tree, the latest metric snapshot, rolling samples, the event stream and command-run audit.

Eight integration recipes cover Laravel, Spring Boot, Node.js, Go, Rust, Python, PostgreSQL and MinIO. The last two are interesting because they need no application change: a database trigger or a bucket-notification bridge maps existing events into the ingest contract.

Close this slide by naming the three audiences: operators get a screen, integrators get a contract, reviewers get an architecture.

### Architecture & patterns

#### 05 · Client, server and data each own one job

`1.1 · SYSTEM OVERVIEW`

*The browser renders and interacts. The App Router aggregates and fans out. Postgres holds durable state. External systems only ever write through the ingest gateway.*

**Speaker notes**

This is the deployment view. Read it left to right and top to bottom.

The browser column is the whole client: one server component bootstraps with a full topology payload, then a client component takes over. The canvas renders recursively — each container draws its own card and then its children as a sub-flow. Cards are memoized, and all live state sits in a Zustand store split into slices. The layout engine is the only thing that computes positions.

The server column shows the App Router's routes. The important one is getTopologyPayload: a single function that joins nodes, metrics, series, events and runs. Both the server component and GET /api/topology call it, so the first paint and any later refresh can never disagree. GET /api/stream is the SSE fan-out; the ingest routes are the only write path from outside; PATCH handles operator view state.

The data column is five tables. ops_nodes is the tree; everything else hangs off it with cascading deletes. Five tables is deliberate — this is a control plane, not a data lake.

The external strip at the bottom is the most important architectural constraint: external systems never touch Postgres. They call the ingest gateway, which validates, upserts, syncs the in-memory engine and broadcasts to every connected canvas within one tick.

If someone asks “why not just write to the database?” — because the in-memory engine is the live truth between ticks, and a direct insert would be invisible until reload. The gateway keeps both in step.

#### 06 · Everything is a node — containers are sub-flows

`1.2 · HIERARCHY MODEL`

*Fourteen types form one spine. The first eleven can hold children; service, endpoint and resource are leaves. Parents always appear before children.*

**Speaker notes**

This is the single most important slide for understanding the product. Everything else follows from the tree.

Read the spine top to bottom. The holding company is the root. Divisions and projects follow the organisational shape. At the leaf of the org tree — a sub-project — we attach datacenters, and under a datacenter we attach both servers and Kubernetes namespaces. A server holds Docker containers; a namespace holds pods. Under every runtime — container or pod — sits a service group, then a service sub-group, then a service, then its endpoints. Servers, containers and pods also get three resource children: CPU, memory and disk.

Two kinds of node. Eleven types are containers: they have a header and a child sub-flow, and they can be collapsed. Three are leaves: service, endpoint and resource. That distinction is not cosmetic — it drives the layout. Collapsed containers become fixed-size leaves, which is how a 456-node estate lays out quickly.

The invariant in the amber box is enforced everywhere: seed order, ingest validation, API payloads. If you register a child before its parent, the gateway returns 400 by design. This sounds strict, but it means the renderer never has to guess.

One more detail worth calling out: resource gauges mirror their host's metrics and are deliberately excluded from group rollups. They are a visual convenience, not a second measurement of the same signal.

#### 07 · Recursive sub-flows, memoized cards, a calm viewport

`1.3 · FRONTEND PATTERNS`

*Three frontend decisions carry the experience: children live inside their parent, cards subscribe to single keys, and view state is reversible.*

**Speaker notes**

Three frontend decisions explain why the canvas feels calm with hundreds of nodes.

One: recursion with clamping. Every container is a component that renders a card and then its children, positioned relative to itself. Dragging is clamped to the interval from zero to parent-size minus self-size. That is the DOM equivalent of the extent-parent constraint you may know from canvas libraries. A child literally cannot be dragged outside its parent, so the visual hierarchy survives an energetic triage session.

Two: subscriptions. Cards are memoized and subscribe to single keys in the store — the metric for that node, the node record for that node. Not the whole list, not the whole metrics map. When a two-second tick updates 456 snapshots, React repaints only the gauges and sparklines that changed. The layout pass does not run at all.

Three: reversibility. Collapse flags and drag offsets are persisted per node, so the canvas a colleague arranged is the canvas you inherit. Navigator selection, search and subtree rollups read precomputed indexes rather than walking the tree on every keystroke.

The viewport follows the same philosophy: wheel pans, control-wheel zooms to the cursor between six percent and 2.4 times, backdrop drag pans, Fit centres everything, Focus reveals and centres a node. On a wide hierarchy, first paint deliberately chooses a legible zoom instead of fitting the whole estate into an unreadable thumbnail.

The bottom line is the vocabulary to use in a review: compound-graph sub-flows, slice-isolated store updates, memoized leaf subscriptions, structure-only relayout.

#### 08 · One aggregation point, a bounded engine, audited actions

`1.4 · BACKEND PATTERNS`

*The server has three jobs: serve one consistent snapshot, evolve believable telemetry, and execute runbooks with a receipt.*

**Speaker notes**

Three backend patterns, and one warning.

The aggregation point is about consistency. There is exactly one function that assembles the topology payload. The React server component calls it for the first paint; the API route calls it for every client that boots without server rendering. Because both go through the same join, production can never show one number and the client another.

The engine is about believability. Each monitored node has an operating point, and every two seconds the value mean-reverts toward it with small noise. Occasional spikes are damped. Every channel has a ceiling. That is why the demo screenshots look like a real estate instead of a random walk. Group nodes roll up with averages plus the worst child status, and resource gauge children are excluded so the same host is not counted twice.

Actions with a receipt is about trust. Six runbooks produce output that streams line by line, persists with operator and exit code, and — for the risky three — actually changes topology: restart halves CPU and memory targets, drain sets maintenance, scale bumps replicas. A failure is recorded as a failure; nothing is silently swallowed.

The amber panel is the most common review objection. A request is measured at several levels of the tree. If you sum, you compound. So the rule is: average per level.

Status derivation is deliberately conservative: critical means page someone; degraded means watch it this shift. Offline is only used when the agent itself is silent.

#### 09 · Five tables, one self-referencing tree

`1.5 · DATA MODEL`

*ops_nodes holds the hierarchy. Everything else hangs off it with cascading deletes, and sample history is pruned to a rolling 50-minute window.*

**Speaker notes**

Five tables is the entire durable model.

ops_nodes is a self-referencing tree: one row per node, parent_id pointing back into the same table. It carries identity, the type, status, ownership metadata, the manual drag offset and the collapse flag. The two indexes are parent_id and type — exactly the two access patterns the navigator and layout need.

ops_metrics is a one-to-one snapshot for each monitored node: current state, not history. It exists so the app can restart and show something sensible before the engine has ticked. It is where the ingest gateway writes incoming pushes.

ops_metric_samples is the rolling history behind sparklines, with a fifty-minute window. Older rows are deleted. It is not a metrics archive — that is Prometheus's job. Note the composite index on node, metric and timestamp; it is what keeps sparkline loads cheap.

ops_events is the alert and audit stream with severity, source, acknowledgement and an optional node link. ops_command_runs is the executor receipt: command, operator, status, exit code, full output, start and finish times.

Everything cascades from ops_nodes, so deleting a subtree cannot leave orphans, and the reference dataset can be rebuilt from code with POST /api/admin/reseed.

If someone asks about scale: this model is designed for hundreds to low thousands of nodes. Beyond that, the sample table and the full-snapshot payload are the first two things to change — time-series storage for samples, incremental topology deltas for the payload.

#### 10 · Bootstrap once, then tick every two seconds

`1.6 · REALTIME DATA-FLOW`

*The first paint already has topology. The stream then carries only what changes: metrics, status transitions, alerts and CLI output.*

**Speaker notes**

This timing diagram is the heartbeat of the product.

Bootstrap: the browser asks for the topology once. That request lands on the aggregation point, which ensures the dataset exists and selects from the five tables, then returns a payload with nodes ordered parents-first plus metrics, series, events and runs. The first paint is therefore complete — no spinner followed by a random shuffle.

Then the client opens an EventSource against /api/stream. The server acknowledges with a hello message and immediately sends a full metrics snapshot, so a client that connects mid-tick is never stale.

Inside the loop, the engine evolves operating points, applies mean reversion, rolls groups up with averages and derives status transitions. Persistence is throttled: snapshots every ten seconds, samples every thirty. The broadcast carries an array of metric updates plus any changed statuses.

The browser applies that array into the Zustand store. Only gauge and sparkline components subscribe to those keys, so nothing re-runs layout. That is the whole trick behind a live 456-node canvas.

Events and CLI lines travel the same channel, so an alert raised by an external system and a runbook line appear side by side in the dock. Keep-alive comments stop proxies from closing an idle connection; clients ignore empty data frames. If an SSE path buffers, the stream will look stuck on connecting — the guide has a troubleshooting row for exactly that.

#### 11 · Layout is a structure problem, not a metric problem

`1.7 · ELK LAYOUT PIPELINE`

*Seven steps turn the tree into nested boxes — and it only runs when structure changes: collapse, filter, direction or spacing.*

**Speaker notes**

Layout is the most expensive thing the client does, so it is deliberately isolated from the live plane.

The pipeline: build indexes from a parents-first list; compute visible children after collapse and the resource-gauge toggle; build an ELK node for each visible node using leaf sizes, collapsed sizes and a header padding equal to the card's header height; hand that compound graph to ELK with the layered algorithm, include-children hierarchy handling and orthogonal edge routing; convert the result into boxes with absolute coordinates; render them recursively with relative offsets; finally, persist any manual drag as an override.

Two details explain the performance. First, collapsed containers become fixed-size leaves — collapsing is not just a visual state, it shrinks the graph ELK has to solve. Second, resource gauges are hidden by default, which removes 159 nodes from the reference estate.

The measured range is roughly 150 to 600 milliseconds, and the canvas HUD shows the last pass time so you never have to guess. The options panel lists the six settings that matter; the one worth memorising is padding-top equals header height, because that is what makes children sit inside the card instead of under its title.

The right-hand panel is the rule operators should internalise: collapse, depth, direction, spacing and resize trigger a relayout. Metric ticks, status colours, selection, hover and pan do not. If layout ever feels slow, the answer is almost always the same: reduce depth, hide gauges, then fit.

### Application administration

#### 12 · Six regions, one operating picture

`2 · CONTROL ROOM ANATOMY`

*Every operator question has a fixed home on the screen. Learn the six regions and you can work the estate without opening a menu.*

**Speaker notes**

Orient the room before showing any control.

The top bar is the estate's vital signs plus the global controls: the LIVE pill and stream state on the right, the search box, then the control strip with expand-to — ORG, PROJ, DC, INFRA, GROUP, SVC, ALL — direction, spacing, relayout, fit and reseed. The stat tiles are totals by status plus average CPU and memory, throughput, p99 and error rate.

The navigator on the left is the same tree as a list. It is how you get somewhere fast when the canvas is zoomed out. The status filter at its base dims everything outside the chosen severities — that is how an on-call engineer builds a view of only the thing they are being paged about.

The canvas is the product. Containers are cards with a header and a nested sub-flow. A rose pulse means critical; an amber border means degraded; dimmed means filtered. Chips show runtime, protocol and ownership.

The dock along the bottom has two tabs: live alert stream and CLI executor log. The unacknowledged count is deliberately visible at all times.

The inspector on the right is the 30-second brief for whatever is selected: overview with gauges and sparklines, metrics with the full channel list, children with live per-child load, and the CLI tab for runbooks.

If you are demoing, follow the path in the card: press ALL, then INFRA, click the amber pod, open the CLI tab. That single sequence shows depth control, focus and action without any narration.

#### 13 · A shift has six steps, and a definition of done

`2.1 · DAILY OPERATOR LOOP`

*Same loop every shift: confirm the stream, glance at the estate, triage, inspect, act, close out. If step six is not empty, the shift is not finished.*

**Speaker notes**

This is the loop to teach new operators, and the checklist to run in a handover.

Step one is trust the pipe before you trust the picture. LIVE green, stream open, tick advancing, last tick measured in seconds. If the stream is closed you are looking at a photograph, not a control room.

Step two is the estate glance: critical zero, degraded between zero and two, average CPU under seventy, p99 inside SLO, error rate under 0.4 percent. Those are the numbers that tell you whether this is a normal shift. If critical is non-zero, skip the tour and go to the rose node.

Step three is triage on the canvas. Rose pulse first, amber second. Remember that dimmed nodes are filtered, not absent — a common source of “where did the service go?”. Note the chips before you click, because runtime and owner decide who you call.

Step four is the inspector. Check that gauges and sparklines agree, that subtree health lists only known offenders, and that the updated label is fresh. A stale timestamp points at the collector, not the workload.

Step five is action. Always snapshot before restart, scale before failover, drain before host work. Watch the run stream; do not fire and forget. If a privileged run fails, it failed closed — nothing changed, and the exit code is in the log.

Step six is close-out. Every warning and critical gets acknowledged with a title that explains itself, because that title becomes the audit trail. The unacknowledged count must be zero at handover, or the open item needs a named owner.

The severity panel is the honesty rule. Critical means page someone. Degraded means watch it this shift. Offline means the agent is silent — check the collector before blaming the application. Maintenance is intentional and excluded from rollups; never use it to hide a real incident.

The definition of a good shift on the right is deliberately short enough to remember.

#### 14 · Depth is a lens, not a filter

`2.2 · CANVAS CONTROLS`

*Most “where is it?” problems are depth problems. Expand-to changes how much of the tree is materialised; search and status filters change what is emphasised.*

**Speaker notes**

These are the controls that decide what the canvas is showing, and they are the source of most confusion for new users.

Expand-to is a lens. Choosing ORG collapses everything below the holding company; choosing INFRA materialises down to servers, containers and pods; ALL goes to endpoints and resource gauges. On a large estate, ALL produces a very wide drawing — that is expected, and the answer is usually INFRA or GROUP plus search, not more zooming.

The resource-gauge checkbox materialises the 159 gauge children. They are off by default because the per-card three-gauge strip already shows the same numbers.

Direction and spacing are presentation controls with a real cost: both trigger a relayout. Down is right for the org shape; right is better for long service chains that would otherwise become very tall.

Auto-layout discards manual drag offsets. It is the correct response to a canvas that a previous shift arranged into a maze.

Search matches name, id, kind, region and owner, and the navigator switches to a result list. The status filter is a dimming layer; it never removes nodes, so a filtered canvas still lets you find the thing you filtered out.

Dragging is clamped to the parent, and double-click collapses a branch in place without moving the viewport. That combination is what keeps a shared view stable.

Reseed is destructive: it wipes manual edits and rebuilds the reference dataset. In production this would be a controlled operation, not a button; treat it accordingly.

#### 15 · Four tabs answer four different questions

`2.3 · THE INSPECTOR`

*Overview is the brief, metrics is the evidence, children is the blame path, CLI is the action. Select a node and read left to right.*

**Speaker notes**

The inspector is where triage becomes a decision, and each tab answers a different question.

Overview answers “what is this and how is it doing?”. You get the header with identity, runtime, version, owner and SLA, the three gauges, a sparkline and subtree health. Read the header first: type and runtime tell you what “slow” means here, and the SLA is the number the endpoint chip will be judged against.

Then read the freshness label. If it says the data is old while the stream claims to be live, you have found the problem — it is the collector, not the workload. This is the single most useful sentence in the slide.

Then read subtree health. Group values are averages of children, so a green parent with a red child is still a red incident, and the child is where the work is.

Metrics answers “what exactly is the evidence?”. Every channel is listed — CPU, memory, disk, network in and out, requests per second, p99 latency, error rate, uptime, replicas — together with the collector source. This is the tab to screenshot into an incident ticket.

Children answers “which child is poisoning the rollup?”. Listing children with live CPU and RPS finds the bad replica immediately, and clicking through focuses it on the canvas.

CLI answers “what can I safely do right now?”. Six runbooks, each labelled read-only or privileged, with output streaming into the dock and every run persisted with the operator and exit code.

#### 16 · Six actions, three of them privileged

`2.4 · RUNBOOKS`

*Each runbook renders a real command template against the selected node, streams output line by line, and records the result. Risky runs can fail closed.*

**Speaker notes**

Six runbooks cover the actions operators actually take, and the risk column is the important part.

The read-only three are snapshot, logs and scale. Snapshot renders top, df and free against the node and writes the result into the run log. Logs tails the last two hundred lines. Scale bumps replicas by two — technically a change, but reversible and low risk.

The privileged three are restart, drain and failover. Restart halves the CPU and memory operating points and clears the error rate, which is why the node visibly returns to healthy in the demo. Drain sets maintenance, which is sticky and excluded from rollups until someone resumes the node. Failover marks the node healthy after the traffic shift and raises an audit event in the CLI log.

Every run — successful or not — writes a row into ops_command_runs with the node, the rendered command, the operator, the status, the exit code, the full output and the timestamps. Output streams into the dock line by line over the same SSE channel as the metrics.

Fail-closed is a deliberate design choice: a privileged run may fail by design, with exit code one and a failed status, and the topology is left exactly as it was. An operator who sees a failure knows nothing happened — which is far better than a half-applied action.

Always snapshot before restart, scale before failover, and drain before host maintenance. That ordering is the difference between a runbook and a gamble.

#### 17 · Operate the data plane, then fix the classics

`2.5 · DATA, ENVIRONMENT & TROUBLESHOOTING`

*Seeding, cadence, persistence and backups on the left; the recurring failure modes and their fixes on the right.*

**Speaker notes**

Two halves: how the data plane behaves, and how to fix the failures you will actually see.

On the data plane: the first request to the topology endpoint seeds the reference estate — 456 nodes, baseline metrics, forty-eight history points per channel and forty-six events. The database URL comes from the environment and the health endpoint is the one-line probe. Snapshots persist every ten seconds and samples every thirty, with pruning past fifty minutes. Drag offsets, collapse state and manual status overrides persist per node. Acknowledgement takes an id or all, and the unacknowledged count is effectively the shift's open work. Backups are a plain dump of the five tables; the reference data can always be regenerated.

The commands in the code block are the three housekeeping calls worth memorising: health, acknowledge-all, reseed.

On the right are the recurring failures. An empty canvas almost always means the topology request is failing — check the database URL, the health probe, then the logs. A stream stuck on connecting is proxy buffering, not a broken app.

Metrics frozen with an open stream means the engine is not ticking; restart the app. A node that will not appear usually means a child was registered before its parent — the gateway returns 400 by design, and the fix is to register upward.

Absurd RPS numbers come from an old build that summed recursively; one reseed fixes the stored data, and current rollups use averages.

Layout taking seconds is a depth and gauge problem, not an algorithm problem: drop to GROUP, hide resource gauges, then fit.

### Integration pattern

#### 18 · Three verbs, one read-back

`3 · INTEGRATION PATTERN`

*Register the shape, push the signals, raise what matters — then read the estate back. Every stack in the estate uses the same four calls.*

**Speaker notes**

Integration is deliberately small: three write verbs and one read path.

Register the shape: one call per node, idempotent by id, safe to run at every boot. The gateway enforces the parents-first rule, so if the parent is unknown you get a 400 and the fix is to walk up the tree, not to invent a parent id.

Push the signals: one snapshot per node per heartbeat. Fifteen to sixty seconds is the sensible cadence — fast enough for the canvas, slow enough not to matter. Values are clamped server-side, so a bad collector cannot poison the estate, and an unknown node id returns a 404 pointing back at the register endpoint.

Raise what matters: deploys, exceptions, slow queries, audit notes. Severity info, warning or critical, and a critical event on a node also escalates that node's status on the canvas. Passing the node id makes the dock row clickable, which is the difference between an alert and a breadcrumb.

Read the estate back: one snapshot at boot, or a stream. The stream carries metrics, events and CLI lines, and there is a small single-node metrics endpoint that is perfect for a smoke test after your first push.

The reliability contract is not optional. Telemetry must never break business traffic. Four-second timeout, fire and forget, warn on failure, batch on a ticker, register once at boot. If you push on every user request you have built a traffic amplifier, not an agent.

The red panel lists the three mistakes we have seen: writing to the database directly, pushing per request, and blocking a user request on a telemetry call.

#### 19 · Push, pull or watch — pick by what you control

`3.1 · CHOOSING A MODE`

*The three modes differ only in who runs the loop. The target is always the same ingest gateway, so the canvas cannot tell them apart.*

**Speaker notes**

Three integration modes, and the choice is almost always made by access rather than preference.

Push is for systems you own. You embed a small reporter, register the topology at boot, heartbeat on a ticker, and raise events from the places that already know something happened — the deploy pipeline, the exception handler, the slow-query guard.

Pull is for systems you cannot change. A collector polls Prometheus, Docker or the Kubernetes API and pushes normalised snapshots. If you already run Prometheus, this is usually a thin mapping job rather than a new agent.

Watch is for things that do not have an API you can call: a database that can run a trigger, an object store that can send bucket notifications, a legacy job that only writes files. You translate an existing signal into events and a few synthetic metrics.

All three converge on the same four steps, and that is the point: the canvas, the status rules and the runbooks do not care how the data arrived. A pushed pod and a polled pod look identical, because the contract is the boundary.

The three questions on the bottom left are the actual decision procedure. Can you deploy code? Can you scrape metrics? Is there an event stream you already trust? The first yes decides the mode.

The acceptance test on the right is the same one used at the end of the deck: a deploy appears in the dock and forces the node amber within two ticks. If that works, the integration is real.

#### 20 · What goes in, what comes back

`3.2 · API CONTRACTS`

*Three payloads and four read endpoints. Everything is JSON over HTTP; the only unusual rule is that parents must be registered before children.*

**Speaker notes**

These are the three payloads and the four read endpoints — the entire integration surface.

Register takes seven fields. id and name and type are mandatory; parentId is mandatory for anything that is not a root. The value of kind is free text but it is displayed, so use it for the runtime or the hypervisor. meta is a free JSON object: for a service put protocol, version and SLA; for an endpoint put method, path, slaMs and auth. The id convention — parent::child::leaf — makes debugging easy when someone reports a missing node.

Push takes a node id plus numeric channels. Everything is clamped server-side, requestsPerSec is a per-interval rate rather than a lifetime counter, and errorRate is what drives status transitions. Send source so the collector chip is honest.

Raise takes a title that is required and should read like a headline, a severity, a free-form source label, an optional node id and an optional detail. A critical event on a node also escalates that node on the canvas, which is how a deploy pipeline can mark a bad release without waiting for metrics to catch up.

Reading back: the topology snapshot for boot or polling, the stream for live updates, the single-node metrics endpoint for a smoke test, and PATCH for view state. One warning: agents should not call PATCH in a loop — that endpoint belongs to operators, and it persists drag and collapse state.

If the audience only remembers one line from this slide: title like a headline, ids like a path, parents before children.

#### 21 · Register once, heartbeat forever, alert on change

`3.3 · PUSH SEQUENCE`

*The end-to-end sequence of a well-behaved agent: one registration block at boot, a steady heartbeat, and events raised only when something happened.*

**Speaker notes**

Read this sequence top to bottom; it is the reference implementation for every sample in the guide.

The boot block runs once per process. The agent registers its parents, then itself, then its endpoints — in that order, because the gateway rejects a child whose parent is unknown. Each call returns 200 with an upsert, and the engine syncs the new node immediately, so the canvas shows it before the first heartbeat arrives.

The loop block runs every fifteen to sixty seconds. One snapshot per node with the six channels that matter: cpu, memory, disk, requests per second, error rate and latency. The gateway upserts, broadcasts, and every connected canvas receives an SSE metrics frame with the derived status.

The event block is not periodic — it fires when something happened. A deploy, an exception, a slow query. The event is inserted and broadcast, and if it is critical the node is escalated on the canvas immediately, before metrics catch up.

The footer is the contract that makes this safe in production: a four-second timeout, fire and forget, log a warning on failure, and register once at boot. Telemetry is a passenger, never a dependency.

One nuance for reviewers: metrics pushed by an agent and metrics generated by the simulation share the same store, so an agent's snapshot appears on the canvas exactly like a simulated one. That is deliberate — it lets you develop an integration against the demo estate.

#### 22 · Translate your world into the tree

`3.4 · MAPPING & STATUS RULES`

*Every system has a shape. The job of integration is to land that shape on the fourteen node types without inventing new ones — and to keep the rollup honest.*

**Speaker notes**

This is the translation table every integration team asks for.

The left column is the real world — companies, business units, programmes, regions, hosts, workloads, bounded contexts, deployables and routes. The middle column is the node type you map them to, and the right column is what that node carries in its metadata and cards.

Two rules keep the tree useful. Map to the closest existing type — the fourteen types are the schema, and inventing a fifteenth is a product change, not an integration detail. And preserve the containment order, because every screen assumes a child makes sense inside its parent.

The status thresholds on the right are the second half of the contract: CPU above 92 is critical, above 79 degraded; error rate above 5 is critical, above 1.4 degraded; memory above 88 is degraded; uptime below 98.5 pages, below 99.9 draws attention. Groups take the worst child status, with maintenance excluded.

The two invariants are the ones that cause real incidents when violated. Parents before children — otherwise registration fails with a 400 and the node never appears. Averages up, never sums — otherwise the same request gets counted at host, pod, service and endpoint and the numbers inflate with every level.

The note at the bottom is the consequence for integrators: a green service under a degraded pod does not save the pod. If you want an aggregate that looks healthy, the leaves have to be healthy.

#### 23 · Eight stacks, one contract

`4 · SAMPLE INTEGRATIONS`

*Each recipe is self-contained: registration, heartbeat and alerting in the framework's own idioms. Replace the host and the ids, then run the same smoke test.*

**Speaker notes**

Eight recipes, one contract. The code lives in the guide at /guide, with full copy-paste samples for each stack.

Laravel: a config file, a reporter service, a minutely scheduled heartbeat and an exception hook. The interesting part is registering topology inside the heartbeat so a fresh environment self-registers on its first tick.

Spring Boot: a non-blocking WebClient reporter, a scheduled heartbeat fed by Micrometer, and a controller advice that turns exceptions into warning events.

Node.js: a small agent module with process stats, an interval heartbeat, and Express middleware that observes latency and forwards 5xx as events.

Go: an internal package with a ticker goroutine and chi-style middleware. Telemetry errors are swallowed by design, which is the right default for a passenger dependency.

Rust: typed reporter structs over reqwest and serde, host stats from sysinfo, a spawned heartbeat task.

Python: one importable module that works for FastAPI, Flask and plain workers, with a middleware and a psutil loop.

PostgreSQL is the interesting one because there is no application change: pg_cron plus pg_net pushes a minutely heartbeat, a trigger turns failed inserts into warning events, and a sidecar is the fallback when those extensions are unavailable.

MinIO cannot speak the ingest API, so a thirty-line bridge receives bucket notifications and maps them to events plus a storage-node disk gauge.

Whatever the stack, the smoke test on the bottom is the same: push one snapshot, then read it back from the single-node metrics endpoint. If that round-trips, the hard part is done.

### Wrap-up

#### 24 · The five-minute acceptance test

`5.1 · ACCEPTANCE`

*A control room is only real if it can prove itself. Run these five checks in order — each one exercises a different layer of the architecture.*

**Speaker notes**

This is the acceptance test to run before you let anyone depend on the platform — and again after any significant change.

Test one is structure: from holding company to CPU gauge, in one canvas, with every container rendering its children. If a level is missing, the problem is in the tree or in the sub-flow renderer, not in the metrics.

Test two is live truth: a tick every two seconds, values moving, layout still. If the canvas jumps on every tick, someone has wired metrics into the layout input, and that is the regression to fix.

Test three is action: run a snapshot, then a restart, and confirm two things — the output streams into the dock, and a row appears in the CLI executor log with an exit code and an operator. That is the audit trail.

Test four is the acknowledgement loop: raise an event through the ingest API, watch it appear, acknowledge it, watch the count drop. That exercises ingest, broadcast and the ack path in one minute.

Test five is integration: take any stack, register it, push one snapshot, raise one deploy. The node appears under its parent with fresh numbers, and the deploy shows up in the dock.

The order matters, because each test depends on the previous one. If structure fails, do not debug the stream. If live truth fails, do not debug integrations.

The bottom line is the promise: all five pass, the control room is trustworthy. Any one fails, and the layer it proves is the layer to fix first.

#### 25 · What it takes to run this for real

`5.2 · PRODUCTION READINESS`

*The demo estate is complete; production adds authentication, a real collector fleet and a retention policy. Six workstreams, roughly a quarter.*

**Speaker notes**

The demo estate is complete, but production is six workstreams, not one switch.

Access is first because the runbooks are real actions: SSO in front of the app, and a role split between viewers, operators and admins. Privileged runbooks should require a second approval, especially drain and failover.

Collectors replace the simulator: Prometheus scrape, Docker events, Kubernetes metrics and one agent per stack. This is the longest pole, which is why it comes first in the sequence.

Retention is the honest gap in the current design: samples belong in a time-series store, Postgres keeps the short window, and events are archived for audit.

Scale is a should-have at the thousand-node mark: topology deltas instead of full snapshots, and a connection pooler in front of Postgres.

Runbooks need to be wired to real automation, with fail-closed retained as the default. It is the property that lets an operator trust a failed run.

Governance is last because it depends on the tree being correct: ownership metadata, alert routing by owner, and a monthly review of nodes nobody owns.

The sequencing card explains the order: collectors first, governance last. And the exit criteria are deliberately operational rather than technical — two clean weeks of handover and a one-minute find-and-act target are better signals of readiness than a green test suite.

#### 26 · Five sentences to remember

`5.3 · TAKEAWAYS`

*If the room forgets everything else, these five lines carry the architecture, the operations and the integration contract.*

**Speaker notes**

Five sentences, in order of how often they come up.

One tree: every object is a node, containers are sub-flows, parents come before children. If someone understands only this, they can navigate the product.

One contract: register, push, raise, read back, and never write to the database directly. This is what makes eight different stacks look identical on the canvas.

One loop: live metrics repaint leaves, structure changes relayout. Two paths that never cross — that is the performance story and the reason the canvas stays readable.

One action surface: six runbooks, three privileged, every run audited, and privileged runs can fail closed. This is the difference between a monitoring tool and an operations tool.

One truth: averages roll up, sums never do. The number on a parent is the average of its children, which is why the estate does not inflate as you zoom out.

The quote on the right is the design principle: a control room is not a dashboard you look at; it is a contract the estate keeps with the people who run it. That is why the invariants are strict and the runbooks are audited.

For next steps, keep it to three concrete asks: book the acceptance test with one real stack, pick the first three collectors, agree the on-call owner map. Those three unblock everything else.

### Appendix

#### 27 · Glossary and where to go next

`APPENDIX`

*Short definitions for the vocabulary used in this deck, plus the two places to look: the live control room and the operator manual at /guide.*

**Speaker notes**

Use this as the reference slide in Q&A, and leave it up while people leave.

The glossary is deliberately short: node, sub-flow, extent-parent, rollup, runbook, ingest gateway, SSE, relayout, snapshot and sample. Those ten terms cover every question that came up in the first three reviews.

The three links are the practical next steps. The root path is the live control room. The guide is the operator and integrator manual — nine Mermaid diagrams with their sources, the administration runbook, and eight complete sample agents you can copy. The architecture anchor jumps straight to the part of the guide that matches slides five to eleven of this deck.

Close by inviting the two useful kinds of follow-up: a pairing session with the first integration team, and a review of the collector plan. Those are the two things that move the project from demo to production.

And if you need one closing line for the room: one tree, one contract, one loop — and an estate that can prove itself in five minutes.

---

## Timing plan

| Part | Slides | Time | Can be cut? |
|------|--------|------|-------------|
| Opening & foundations | 01–04 | 5 min | No |
| Architecture & patterns | 05–11 | 12 min | Compress 07–11 to 6 min |
| Application administration | 12–17 | 10 min | Drop 14 or 16 for a shorter run |
| Integration pattern | 18–23 | 12 min | Keep 18–22; 23 can be a handout |
| Wrap-up & appendix | 24–27 | 4 min | Keep 24 and 26 |

## Production notes

- **Format:** 16:9 (13.333 × 7.5 in), PowerPoint `.pptx`, no external images or fonts required.
- **Typography:** Segoe UI for prose, Consolas for identifiers and endpoints.
- **Palette:** ink `#05070D` background, ice `#7DD3FC`, mint `#34D399`, amber `#FBBF24`, rose `#FB7185`, violet `#A78BFA`.
- **Accessibility:** body text is 7.5 pt or larger on a dark ground; key numbers are 15 pt and up. If printing, export to PDF in colour.
- **Editing:** diagrams are native shapes, so colours and labels can be changed without redrawing.

## Reference material

| Topic | Where |
|-------|-------|
| Live control room | `/` |
| Operator + integrator manual | `/guide` |
| Mermaid diagram sources | `src/lib/guide-charts.ts` |
| Stack sample code | `src/lib/guide-samples.ts` |
| Node and metric contracts | `src/lib/types.ts`, `src/app/api/ingest/*` |
| Data model | `src/db/schema.ts` |
| Telemetry engine and runbooks | `src/lib/telemetry.ts` |
