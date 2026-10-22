"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { deleteJson, getJson, postJson, timeAgo, usePoll } from "@/lib/client";
import type { ConfigSourceRow } from "@/lib/config/types";
import { Button, Chip, ErrorNote, Notice, PageHeader, Panel, Table, Tabs, Td, Th, type Tone } from "@/components/ui/primitives";
import { ComposePanel } from "@/components/config/ComposePanel";
import { TerraformPanel } from "@/components/config/TerraformPanel";
import { GithubPanel } from "@/components/config/GithubPanel";

type Tab = "compose" | "terraform" | "github" | "workspace";

interface ScanPayload {
  root: string;
  configRoot: string;
  hits: { kind: "compose" | "terraform" | "dockerfile"; path: string; relative: string; label: string; size: number | null }[];
  counts: { compose: number; terraform: number; dockerfile: number };
  scanned: number;
  truncated: boolean;
  skipped: string[];
  durationMs: number;
}

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>("compose");
  const [composePath, setComposePath] = useState<string | null>(null);
  const [terraformDir, setTerraformDir] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);
  const sources = usePoll<{ sources: ConfigSourceRow[] }>("/api/config/sources", 0);

  const openHit = (hit: ScanPayload["hits"][number]) => {
    if (hit.kind === "compose") {
      setComposePath(hit.relative);
      setTab("compose");
    } else if (hit.kind === "terraform") {
      setTerraformDir(hit.relative);
      setTab("terraform");
    }
  };

  const removeSource = async (source: ConfigSourceRow) => {
    try {
      await deleteJson(`/api/config/sources/${source.id}`);
      setNotice({ tone: "warn", message: `Removed ${source.name}.` });
      sources.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="config / review"
        title="Configuration intelligence"
        description="Visualise and validate Compose files, walk a dependency-free Terraform parse, and read a GitHub repository's issues, rollups and files — all without leaving the console."
        actions={
          <>
            <Button icon="refresh" onClick={() => sources.refresh()}>
              sources
            </Button>
            <Chip tone="muted">read-only</Chip>
          </>
        }
      />

      {sources.error ? <ErrorNote message={sources.error} onRetry={sources.refresh} /> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "compose", label: "compose", icon: "stack" },
            { value: "terraform", label: "terraform", icon: "layers" },
            { value: "github", label: "github", icon: "github" },
            { value: "workspace", label: "workspace scan", icon: "search" },
          ]}
        />
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">
            {sources.data?.sources.length ?? 0} saved sources
          </span>
          {(sources.data?.sources ?? []).slice(0, 4).map((source) => (
            <span key={source.id} className="inline-flex items-center gap-1 rounded border border-line px-1 py-[1px] font-mono text-[9px] text-slate-400">
              {source.kind}:{source.name}
              <button type="button" onClick={() => void removeSource(source)} className="text-slate-500 hover:text-rose-300" aria-label={`remove ${source.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "compose" ? <ComposePanel initialPath={composePath} onPathConsumed={() => setComposePath(null)} /> : null}
        {tab === "terraform" ? <TerraformPanel initialDir={terraformDir} onDirConsumed={() => setTerraformDir(null)} /> : null}
        {tab === "github" ? <GithubPanel onSaved={() => { sources.refresh(); setNotice({ tone: "ok", message: "GitHub source saved." }); }} /> : null}
        {tab === "workspace" ? <WorkspacePanel onOpen={openHit} /> : null}
      </div>

      {(sources.data?.sources ?? []).length ? (
        <Panel title="saved sources" subtitle="config_sources" icon="save" padded={false}>
          <Table
            head={
              <tr className="border-b border-line">
                <Th>name</Th>
                <Th>kind</Th>
                <Th>target</Th>
                <Th>status</Th>
                <Th>last loaded</Th>
                <Th>summary</Th>
                <Th className="text-right">actions</Th>
              </tr>
            }
          >
            {(sources.data?.sources ?? []).map((source) => (
              <tr key={source.id} className="border-b border-line-soft/60">
                <Td className="font-mono text-[10.5px] text-slate-100">{source.name}</Td>
                <Td>
                  <Chip tone="info">{source.kind}</Chip>
                </Td>
                <Td className="max-w-[260px] truncate font-mono text-[10px] text-slate-400">{source.target}</Td>
                <Td>
                  <Chip tone={source.status === "error" ? "bad" : "ok"}>{source.status}</Chip>
                  {source.lastError ? <p className="mt-0.5 max-w-[240px] truncate font-mono text-[9px] text-rose-300">{source.lastError}</p> : null}
                </Td>
                <Td className="font-mono text-[9.5px] text-slate-500">{timeAgo(source.lastLoadedAt)}</Td>
                <Td className="max-w-[220px] truncate font-mono text-[9.5px] text-slate-500">
                  {source.summary ? Object.entries(source.summary).map(([key, value]) => `${key}=${String(value)}`).join(" · ") : "—"}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="xs"
                      icon="refresh"
                      onClick={async () => {
                        try {
                          await getJson(`/api/config/sources/${source.id}?refresh=1`);
                          setNotice({ tone: "ok", message: `${source.name} reloaded.` });
                          sources.refresh();
                        } catch (error) {
                          setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
                          sources.refresh();
                        }
                      }}
                    >
                      reload
                    </Button>
                    <Button size="xs" variant="danger" icon="trash" onClick={() => void removeSource(source)}>
                      delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
    </div>
  );
}

function WorkspacePanel({ onOpen }: { onOpen: (hit: ScanPayload["hits"][number]) => void }) {
  const [target, setTarget] = useState("");
  const [scan, setScan] = useState<ScanPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (path) params.set("path", path);
      const payload = await getJson<ScanPayload>(`/api/config/scan${params.toString() ? `?${params.toString()}` : ""}`);
      setScan(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote message={error} onRetry={() => void run(target || undefined)} /> : null}
      <Panel title="workspace scan" subtitle="bounded walk · path-escape guarded" icon="search">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="subdirectory relative to CONFIG_ROOT (blank = root)"
            className="h-7 min-w-[240px] flex-1 rounded-md border border-line bg-ink-900/60 px-2 font-mono text-[10.5px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none"
          />
          <Button variant="primary" icon="search" onClick={() => void run(target || undefined)} disabled={loading}>
            {loading ? "scanning…" : "scan"}
          </Button>
          <Button
            icon="save"
            onClick={async () => {
              try {
                await postJson("/api/config/sources", { name: `workspace ${scan?.root.split("/").pop() ?? "root"}`, kind: "workspace", target: target || "." });
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
            disabled={!scan}
          >
            save source
          </Button>
        </div>
        {scan ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-slate-500">
            <Chip tone="info">{scan.counts.compose} compose</Chip>
            <Chip tone="accent">{scan.counts.terraform} terraform dirs</Chip>
            <Chip tone="muted">{scan.counts.dockerfile} dockerfiles</Chip>
            <span>
              {scan.scanned} entries · {scan.durationMs}ms
            </span>
            {scan.truncated ? <Chip tone="warn">truncated at the depth/entry bound</Chip> : null}
            <span className="truncate text-slate-500">{scan.root}</span>
          </div>
        ) : null}
        {scan?.skipped.length ? <p className="mt-1 font-mono text-[9px] text-slate-500">skipped: {scan.skipped.join(", ")}</p> : null}
      </Panel>

      {scan ? (
        <Panel title="candidates" subtitle="open one in the visualiser" icon="folder" padded={false}>
          <Table
            head={
              <tr className="border-b border-line">
                <Th>kind</Th>
                <Th>path</Th>
                <Th>size</Th>
                <Th className="text-right">open</Th>
              </tr>
            }
          >
            {scan.hits.map((hit) => (
              <tr key={`${hit.kind}-${hit.relative}`} className="border-b border-line-soft/60">
                <Td>
                  <Chip tone={hit.kind === "compose" ? "info" : hit.kind === "terraform" ? "accent" : "muted"}>{hit.kind}</Chip>
                </Td>
                <Td className={cn("max-w-[420px] truncate font-mono text-[10.5px]", hit.kind === "dockerfile" ? "text-slate-500" : "text-slate-200")}>{hit.relative}</Td>
                <Td className="font-mono text-[9.5px] text-slate-500">{hit.size === null ? "—" : `${(hit.size / 1024).toFixed(1)} KB`}</Td>
                <Td>
                  <div className="flex justify-end">
                    <Button size="xs" icon="arrowRight" disabled={hit.kind === "dockerfile"} onClick={() => onOpen(hit)}>
                      {hit.kind === "terraform" ? "graph" : hit.kind === "compose" ? "validate" : "—"}
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
            {!scan.hits.length ? (
              <tr>
                <Td className="py-8 text-center text-slate-500">No compose files or .tf directories found under this root.</Td>
              </tr>
            ) : null}
          </Table>
        </Panel>
      ) : (
        <Panel className="min-h-[200px]">
          <p className="py-10 text-center text-[11.5px] text-slate-500">Scan a directory to find compose files, Terraform roots and Dockerfiles.</p>
        </Panel>
      )}
    </div>
  );
}
