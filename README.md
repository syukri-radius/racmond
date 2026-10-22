# DOCKFLOW · local ops console

A single-operator, localhost control room for Docker estates. It talks to a real
Docker endpoint when one answers, and falls back to a fully functional in-memory
**demo engine** when nothing does — every page keeps working, and the real error
is preserved and shown.

No authentication, no users, no RBAC: run it on your laptop, open the browser.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm run build && npm start
npm run db:push      # drizzle-kit push (schema and bootstrap DDL agree)
```

Storage is libsql/SQLite through drizzle. The URL is resolved from
`LIBSQL_URL` → `TURSO_DATABASE_URL` → `DATABASE_URL` → `file:${cwd}/data/dockflow.db`.
Blank environment variables are treated as unset everywhere (`envOr`), so an
empty `DOCKER_SOCKET=""` or `DATABASE_URL=""` in a template is harmless;
postgres URLs are ignored on purpose.

| env | effect |
| --- | --- |
| `DOCKER_SOCKET` / `DOCKER_HOST` | explicit engine endpoint (unix / tcp / npipe) |
| `LIBSQL_URL`, `TURSO_DATABASE_URL`, `DATABASE_URL` | database target |
| `GITHUB_TOKEN` / `GH_TOKEN` | optional, raises the REST quota to 5000/h |
| `CONFIG_ROOT` / `WORKSPACE_ROOT` | root that config paths and scans are confined to (defaults to cwd) |

## Pages

| route | what it does |
| --- | --- |
| `/` | engine card with probe latency and warnings, busiest containers, prune actions, per-project start/restart/stop, APM snapshot, recent workflow runs, PATH scan |
| `/containers` | containers / images / volumes / networks tabs, metric strip, filters, row actions, `docker run` form, drawer with overview, logs (250 lines, auto-refresh), stats sparklines and exec |
| `/graph` | hierarchical estate map: host → compose project → service → container → networks/mounts, plus the engine resource branch. Expand/collapse pills, expand-all / collapse / fit, `X/Y visible` |
| `/apm` | service map (call-flow and hierarchy views), Apdex vs SLA, traces with waterfall and rpm buckets, labelled synthetic traffic toggle, service drawer |
| `/workflows` | xyflow automation builder: palette from the step registry, per-node settings, save / clone / delete, run timeline, history |
| `/jvm` | Jolokia / Actuator / simulated targets, monitor, visual GC, threads with deadlock detection, statistical sampler call tree, MBeans, persisted dumps, anatomy tree |
| `/config` | compose visualiser + validator, dependency-free HCL/Terraform parser with a reference graph, GitHub repo overview + issue graph + rollups + file browser, bounded workspace scan |
| `/cli` | preset library by category, ad-hoc runner, terminal output with exit / duration / truncation badges, history, detected binaries |

## API

All routes are JSON and live under `/api`; every graph page is driven by them.

- engine: `status`, `endpoints`, `containers`, `containers/[id]`, `containers/[id]/logs`, `containers/[id]/exec`, `resources`, `actions`, `overview`, `health`
- apm: `map`, `traces`, `service/[key]`, `simulate`, `reset`, plus ingest at `/radion/api/apm/ingest`
- workflows: `workflows`, `workflows/[id]`, `workflows/[id]/run`, `workflows/runs`, `workflows/runs/[id]`
- jvm: `targets`, `snapshot`, `threads`, `mbeans`, `sampler`, `dumps`, `dumps/[id]`, `anatomy`
- cli: `tools`, `run`, `detect`
- config: `compose`, `terraform`, `github`, `tree`, `file`, `scan`, `sources`, `sources/[id]`

## Notes

- Cycles, dangling parents and duplicate ids never break a layout: the tree
  layout cuts cycles after one visit and a layered layout falls back to
  insertion order.
- The CLI runner uses argv arrays with `shell: false`, a quote-aware tokenizer,
  a 30s default timeout (120s max) killed with SIGKILL, an output byte budget
  and a deny-list; `ENOENT` is reported as *not installed*.
- GitHub requests are cached for five minutes; failures degrade to the bundled
  offline fixture and say so.
- Config scans are bounded (depth 6, 4000 entries, 200 hits) and confined to
  `CONFIG_ROOT`; anything that resolves outside the root is rejected, including
  `..` and symlink escapes.
