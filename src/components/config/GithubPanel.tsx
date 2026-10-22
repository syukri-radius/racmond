"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatBytes, getJson, postJson, timeAgo } from "@/lib/client";
import type { FileNode, GithubModel } from "@/lib/config/types";
import { MapCanvas, type MapCard } from "@/components/map/MapCanvas";
import { Bar, Button, Chip, ErrorNote, Metric, Notice, Panel, Table, Tabs, Td, Th, Toggle, type Tone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { FindingList } from "./FindingList";

type View = "overview" | "issues" | "rollups" | "files";

export function GithubPanel({ onSaved }: { onSaved?: () => void }) {
  const [repo, setRepo] = useState("vega-labs/dockflow");
  const [query, setQuery] = useState("vega-labs/dockflow");
  const [model, setModel] = useState<GithubModel | null>(null);
  const [token, setToken] = useState(false);
  const [fixture, setFixture] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey] = useState(0);

  const load = async (target = repo, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ repo: target });
      if (fixture) params.set("fixture", "1");
      if (force) params.set("refresh", "1");
      const payload = await getJson<{ model: GithubModel; token: boolean }>(`/api/config/github?${params.toString()}`);
      setModel(payload.model);
      setToken(payload.token);
      setRepo(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("vega-labs/dockflow");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (!model) return;
    void load(repo, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture]);

  const cards: MapCard[] = useMemo(
    () =>
      (model?.nodes ?? []).map((node) => ({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        subtitle: node.subtitle,
        kind: node.kind,
        chips: node.chips,
        tone: (node.kind === "issue" && node.subtitle.startsWith("open") ? "warn" : node.kind === "pull-request" ? "info" : node.kind === "repository" ? "accent" : "muted") as Tone,
      })),
    [model],
  );
  const edges = useMemo(
    () =>
      (model?.edges ?? []).map((edge) => ({
        source: edge.source,
        target: edge.target,
        label: edge.label,
        tone: (edge.label === "block" ? "bad" : edge.label?.startsWith("fix") || edge.label?.startsWith("close") ? "ok" : "accent") as Tone,
      })),
    [model],
  );

  const save = async () => {
    if (!model) return;
    try {
      await postJson("/api/config/sources", { name: model.repo, kind: "github", target: model.repo });
      onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <Icon name="github" size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load(query, true);
            }}
            placeholder="owner/repo"
            className="h-7 w-[240px] rounded-md border border-line bg-ink-900/60 pl-7 pr-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none"
          />
        </div>
        <Button variant="primary" icon="search" onClick={() => void load(query, true)} disabled={loading || !query.trim()}>
          {loading ? "loading…" : "load repo"}
        </Button>
        <Button icon="refresh" onClick={() => void load(repo, true)} disabled={loading}>
          refresh
        </Button>
        <div className="w-[180px]">
          <Toggle checked={fixture} onChange={setFixture} label="offline fixture" hint="no GitHub request" />
        </div>
        <Button icon="save" onClick={() => void save()} disabled={!model}>
          save source
        </Button>
        <span className="ml-auto flex items-center gap-1.5">
          <Chip tone={model?.source === "live" ? "ok" : "warn"}>{model?.source ?? "—"}</Chip>
          <Chip tone={token ? "ok" : "muted"}>{token ? "GITHUB_TOKEN set" : "anonymous 60 req/h"}</Chip>
          {model?.rate ? <Chip tone={model.rate.remaining > 10 ? "muted" : "warn"}>{model.rate.remaining}/{model.rate.limit} left</Chip> : null}
        </span>
      </div>

      {error ? <ErrorNote message={error} onRetry={() => void load(query, true)} /> : null}
      {model?.error ? (
        <Notice tone="warn" icon="alert">
          {model.error}
        </Notice>
      ) : null}

      {model ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="repository" value={model.overview.fullName.split("/").pop() ?? model.repo} hint={model.overview.license} icon="github" tone="accent" />
            <Metric label="stars · forks" value={`${model.overview.stars} · ${model.overview.forks}`} hint={`${model.overview.watchers} watchers`} icon="eye" />
            <Metric label="open issues" value={model.counts.open} hint={`${model.counts.closed} closed`} icon="alert" tone={model.counts.open > 10 ? "warn" : "ok"} />
            <Metric label="contributors" value={model.counts.contributors} hint={`${model.counts.labels} labels`} icon="branch" />
            <Metric label="size" value={`${(model.overview.sizeKb / 1024).toFixed(1)} MB`} hint={`pushed ${timeAgo(model.overview.pushedAt)}`} icon="disk" />
            <Metric label="insights" value={model.insights.filter((insight) => insight.severity !== "info").length} hint={`${model.insights.length} findings`} icon="gauge" tone={model.insights.some((insight) => insight.severity === "error") ? "bad" : "ok"} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Tabs
              value={view}
              onChange={setView}
              tabs={[
                { value: "overview", label: "overview", icon: "home" },
                { value: "issues", label: "issue graph", count: model.counts.issues, icon: "network" },
                { value: "rollups", label: "rollups", icon: "layers" },
                { value: "files", label: "files", icon: "folder" },
              ]}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
              {model.overview.defaultBranch} · pushed {timeAgo(model.overview.pushedAt)}
              {model.overview.archived ? " · archived" : ""}
            </span>
          </div>

          {view === "overview" ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-3">
                <Panel title="about" subtitle={model.overview.description || "no description"} icon="github">
                  <div className="flex flex-wrap gap-1">
                    {model.overview.topics.map((topic) => (
                      <Chip key={topic} tone="info">
                        {topic}
                      </Chip>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">languages</p>
                    {model.languages.map((language) => (
                      <div key={language.name} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 truncate font-mono text-[10px] text-slate-300">{language.name}</span>
                        <Bar value={language.pct} tone="accent" height={5} />
                        <span className="tabular w-11 shrink-0 text-right font-mono text-[9.5px] text-slate-400">{language.pct}%</span>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel title="commit activity" subtitle="last 12 weeks" icon="activity">
                  <div className="flex h-[70px] items-end gap-1">
                    {model.commitActivity.map((week) => {
                      const max = Math.max(1, ...model.commitActivity.map((entry) => entry.total));
                      return (
                        <div key={week.week} className="flex-1" title={`${new Date(week.week * 1000).toLocaleDateString()} · ${week.total} commits`}>
                          <div className="w-full rounded-sm bg-ice/45" style={{ height: `${Math.max(3, (week.total / max) * 64)}px` }} />
                        </div>
                      );
                    })}
                    {!model.commitActivity.length ? <p className="text-[11px] text-slate-500">activity stats not computed yet</p> : null}
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {model.commits.map((commit) => (
                      <div key={commit.sha} className="flex items-center gap-2">
                        <span className="w-14 shrink-0 font-mono text-[9.5px] text-ice">{commit.sha}</span>
                        <span className="min-w-0 flex-1 truncate text-[10.5px] text-slate-300">{commit.message}</span>
                        <span className="shrink-0 font-mono text-[9px] text-slate-500">{commit.author}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>

              <div className="flex flex-col gap-3">
                <Panel title="contributors" subtitle={`${model.contributors.length} listed`} icon="branch">
                  <div className="flex flex-col gap-1.5">
                    {model.contributors.map((contributor) => {
                      const max = Math.max(1, ...model.contributors.map((entry) => entry.contributions));
                      return (
                        <div key={contributor.login} className="flex items-center gap-2">
                          <span className="w-4 shrink-0 text-center font-mono text-[9px] text-slate-500">◈</span>
                          <span className="w-28 shrink-0 truncate font-mono text-[10px] text-slate-200">{contributor.login}</span>
                          <Bar value={contributor.contributions} max={max} tone="accent" height={5} />
                          <span className="tabular w-12 shrink-0 text-right font-mono text-[9.5px] text-slate-400">{contributor.contributions}</span>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
                <Panel title="insights" subtitle="issue hygiene & security" icon="gauge" className="min-h-0 flex-1">
                  <div className="scroll-thin max-h-[260px] overflow-y-auto">
                    <FindingList findings={model.insights} />
                  </div>
                </Panel>
              </div>
            </div>
          ) : null}

          {view === "issues" ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
              <Panel padded={false} className="min-h-[420px] overflow-hidden" title="issue graph" subtitle="closes · fixes · blocks · bare #n" icon="network">
                <MapCanvas
                  cards={cards}
                  edges={edges}
                  layout="tree"
                  initialLevels={2}
                  selectedId={selected}
                  onSelect={setSelected}
                  legend={[
                    { label: "open", tone: "warn" },
                    { label: "closed", tone: "muted" },
                    { label: "blocks", tone: "bad" },
                  ]}
                  overlay={<Chip tone="muted">{model.counts.issues} issues</Chip>}
                />
              </Panel>
              <Panel title="issue detail" subtitle={selected ?? "click a node"} icon="file" className="min-h-0">
                <IssueDetail model={model} selected={selected} />
              </Panel>
            </div>
          ) : null}

          {view === "rollups" ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              {[
                { title: "labels", rows: model.rollups.labels.map((row) => ({ key: row.name, open: row.open, closed: row.closed })) },
                { title: "milestones", rows: model.rollups.milestones.map((row) => ({ key: row.name, open: row.open, closed: row.closed })) },
                { title: "assignees", rows: model.rollups.assignees.map((row) => ({ key: row.login, open: row.open, closed: row.closed, load: row.load })) },
              ].map((group) => (
                <Panel key={group.title} title={group.title} subtitle={`${group.rows.length} buckets`} icon="layers">
                  <div className="flex flex-col gap-1.5">
                    {group.rows.map((row) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <span className="w-[110px] shrink-0 truncate font-mono text-[10px] text-slate-300" title={row.key}>
                          {row.key}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                          <Bar value={row.open} max={Math.max(1, row.open + row.closed)} tone="warn" height={4} />
                          <Bar value={row.closed} max={Math.max(1, row.open + row.closed)} tone="ok" height={4} />
                        </div>
                        <span className="tabular w-[62px] shrink-0 text-right font-mono text-[9px] text-slate-400">
                          {row.open}o · {row.closed}c
                        </span>
                      </div>
                    ))}
                    {!group.rows.length ? <p className="text-[11px] text-slate-500">no data</p> : null}
                  </div>
                </Panel>
              ))}
              <Panel title="top issues" subtitle="by last update" icon="activity" className="xl:col-span-3">
                <Table
                  head={
                    <tr className="border-b border-line">
                      <Th>#</Th>
                      <Th>title</Th>
                      <Th>state</Th>
                      <Th>labels</Th>
                      <Th>assignees</Th>
                      <Th>updated</Th>
                    </tr>
                  }
                >
                  {model.issues.slice(0, 12).map((issue) => (
                    <tr key={issue.number} className="border-b border-line-soft/60">
                      <Td className="font-mono text-[10px] text-slate-500">{issue.number}</Td>
                      <Td className="max-w-[380px] truncate text-[11px] text-slate-200">{issue.title}</Td>
                      <Td>
                        <Chip tone={issue.state === "open" ? "warn" : "muted"}>{issue.state}</Chip>
                      </Td>
                      <Td className="max-w-[180px] truncate font-mono text-[9.5px] text-slate-400">{issue.labels.join(", ") || "—"}</Td>
                      <Td className="font-mono text-[9.5px] text-slate-400">{issue.assignees.join(", ") || "unassigned"}</Td>
                      <Td className="font-mono text-[9px] text-slate-500">{timeAgo(issue.updatedAt)}</Td>
                    </tr>
                  ))}
                </Table>
              </Panel>
            </div>
          ) : null}

          {view === "files" ? <FilesView repo={model.repo} gitRef={model.overview.defaultBranch} fixture={model.source === "fixture"} /> : null}
        </>
      ) : (
        <Panel className="min-h-[300px]">
          <p className="py-10 text-center text-[12px] text-slate-500">{loading ? "contacting GitHub…" : "load a repository"}</p>
        </Panel>
      )}
    </div>
  );
}

function IssueDetail({ model, selected }: { model: GithubModel; selected: string | null }) {
  const node = model.nodes.find((entry) => entry.id === selected);
  const number = selected?.startsWith("gh:issue:") ? Number(selected.split(":")[2]) : null;
  const issue = number ? model.issues.find((entry) => entry.number === number) : null;
  const edges = model.edges.filter((edge) => edge.source === selected || edge.target === selected);

  if (!node) return <p className="text-[11.5px] leading-relaxed text-slate-500">Select an issue node to read its body, labels and references.</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Chip tone={node.kind === "repository" ? "accent" : node.kind === "issue-state" ? "info" : "warn"}>{node.kind}</Chip>
        <span className="truncate font-mono text-[10px] text-slate-400">{node.title}</span>
      </div>
      {issue ? (
        <>
          <div className="flex flex-wrap gap-1">
            {issue.labels.map((label) => (
              <Chip key={label} tone="muted">
                {label}
              </Chip>
            ))}
            {issue.pullRequest ? <Chip tone="info">pull request</Chip> : null}
            <Chip tone={issue.state === "open" ? "warn" : "ok"}>{issue.state}</Chip>
          </div>
          <p className="scroll-thin max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded border border-line/60 bg-ink-900/40 p-2 text-[10.5px] leading-relaxed text-slate-300">
            {issue.body || "(no body)"}
          </p>
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">references</p>
            {edges.map((edge) => (
              <div key={`${edge.source}-${edge.target}`} className="flex items-center gap-1.5 font-mono text-[9.5px] text-slate-400">
                <span className="text-slate-500">{edge.source.replace("gh:issue:", "#")}</span>
                <Icon name="arrowRight" size={10} />
                <span className="text-slate-300">{edge.target.replace("gh:issue:", "#")}</span>
                <Chip tone={edge.label === "block" ? "bad" : "muted"}>{edge.label}</Chip>
              </div>
            ))}
            {!edges.length ? <p className="text-[10.5px] text-slate-500">no linked issues</p> : null}
          </div>
          <p className="font-mono text-[9px] text-slate-500">
            opened {timeAgo(issue.createdAt)} · {issue.comments} comments · {issue.milestone ?? "no milestone"}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-slate-500">{node.subtitle}</p>
      )}
    </div>
  );
}

function FilesView({ repo, gitRef, fixture }: { repo: string; gitRef: string; fixture: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, FileNode[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; content: string; size: number } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadDir = async (dirPath: string) => {
    setLoading(dirPath);
    setError(null);
    try {
      const payload = await getJson<{ entries: FileNode[] }>(
        `/api/config/tree?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(dirPath)}&ref=${encodeURIComponent(gitRef)}${fixture ? "&fixture=1" : ""}`,
      );
      setExpanded((current) => ({ ...current, [dirPath]: payload.entries }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    setExpanded({});
    void loadDir("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, gitRef, fixture]);

  const openFile = async (path: string) => {
    setPreviewError(null);
    try {
      const payload = await getJson<{ path: string; content: string; size: number }>(
        `/api/config/file?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}&ref=${encodeURIComponent(gitRef)}${fixture ? "&fixture=1" : ""}`,
      );
      setPreview(payload);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const render = (dirPath: string, depth: number): React.ReactNode => {
    const entries = expanded[dirPath];
    if (!entries) return null;
    return entries.map((entry) => (
      <div key={entry.path}>
        <div className="flex items-center gap-1.5 rounded px-1 py-[3px] hover:bg-ice/[0.06]" style={{ paddingLeft: 6 + depth * 12 }}>
          <button
            type="button"
            onClick={() => (entry.type === "dir" ? (expanded[entry.path] ? setExpanded((current) => { const next = { ...current }; delete next[entry.path]; return next; }) : void loadDir(entry.path)) : void openFile(entry.path))}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <Icon name={entry.type === "dir" ? "folder" : "file"} size={11} className={entry.type === "dir" ? "text-ice/80" : "text-slate-500"} />
            <span className={cn("truncate font-mono text-[10.5px]", entry.type === "dir" ? "text-slate-200" : "text-slate-400")}>{entry.name}</span>
            {entry.type === "dir" ? <Icon name={expanded[entry.path] ? "chevronDown" : "chevronRight"} size={9} className="text-slate-600" /> : null}
          </button>
          {entry.size !== null ? <span className="shrink-0 font-mono text-[8.5px] text-slate-600">{formatBytes(entry.size)}</span> : null}
        </div>
        {entry.type === "dir" && expanded[entry.path] ? render(entry.path, depth + 1) : null}
      </div>
    ));
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Panel title="file tree" subtitle={`${repo} @ ${gitRef}${fixture ? " · offline fixture" : ""}`} icon="folder" padded={false} className="min-h-[360px]">
        <div className="scroll-thin h-full max-h-[calc(100vh-330px)] overflow-y-auto p-2">
          {error ? <ErrorNote message={error} onRetry={() => void loadDir("")} /> : null}
          {loading === "" ? <p className="p-2 text-[11px] text-slate-500">loading root…</p> : null}
          {render("", 0)}
        </div>
      </Panel>
      <Panel title="preview" subtitle="text files · 400 KB ceiling" icon="file" className="min-h-[360px]">
        {previewError ? <ErrorNote message={previewError} /> : null}
        {preview ? (
          <div className="flex h-full flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Chip tone="info">{preview.path}</Chip>
              <Chip tone="muted">{formatBytes(preview.size)}</Chip>
            </div>
            <pre className="scroll-thin max-h-[calc(100vh-390px)] overflow-auto rounded border border-line bg-[#06030c] p-2.5 font-mono text-[10px] leading-relaxed text-slate-300">
              {preview.content || "(binary or empty file)"}
            </pre>
          </div>
        ) : (
          <p className="py-10 text-center text-[11.5px] text-slate-500">Pick a file to preview it without cloning the repo.</p>
        )}
      </Panel>
    </div>
  );
}
