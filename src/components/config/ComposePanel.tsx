"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { getJson, postJson } from "@/lib/client";
import type { ComposeModel } from "@/lib/config/types";
import { MapCanvas, type MapCard } from "@/components/map/MapCanvas";
import { Button, Chip, ErrorNote, Metric, Notice, Panel, SeverityChip, Table, Td, TextArea, Th, type Tone } from "@/components/ui/primitives";
import { FindingList } from "./FindingList";

export function ComposePanel({ initialPath, onPathConsumed }: { initialPath?: string | null; onPathConsumed?: () => void }) {
  const [model, setModel] = useState<ComposeModel | null>(null);
  const [source, setSource] = useState("");
  const [path, setPath] = useState(initialPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"graph" | "services">("graph");
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async (body?: { content?: string; path?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = body ? await postJson<{ model: ComposeModel }>("/api/config/compose", body) : await getJson<{ model: ComposeModel }>("/api/config/compose");
      setModel(payload.model);
      if (!body) setSource("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialPath) return;
    setPath(initialPath);
    void load({ path: initialPath });
    onPathConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const cards: MapCard[] = useMemo(
    () =>
      (model?.nodes ?? []).map((node) => {
        const severity = (model?.findings ?? []).find((finding) => finding.target === node.id)?.severity;
        return {
          id: node.id,
          parentId: node.parentId,
          title: node.title,
          subtitle: node.subtitle,
          kind: node.kind,
          chips: node.chips,
          tone: (severity === "error" ? "bad" : severity === "warning" ? "warn" : node.kind === "service" ? "info" : node.kind === "project" ? "accent" : "muted") as Tone,
          badge: severity === "error" ? "error" : severity === "warning" ? "warn" : undefined,
        };
      }),
    [model],
  );

  const edges = useMemo(() => (model?.edges ?? []).map((edge) => ({ source: edge.source, target: edge.target, label: edge.label, tone: "accent" as const })), [model]);

  const findings = model?.findings ?? [];
  const counts = {
    error: findings.filter((finding) => finding.severity === "error").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };
  const detail = model?.nodes.find((node) => node.id === selected) ?? null;

  const save = async () => {
    if (!model) return;
    if (!source.trim() && !path.trim()) {
      setSaved(null);
      setError("Paste YAML or set a file path before saving — the bundled demo is not a file on disk.");
      return;
    }
    try {
      await postJson("/api/config/sources", {
        name: model.project,
        kind: "compose",
        target: path || "docker-compose.yml",
        content: source.trim() ? source : undefined,
      });
      setSaved("Saved to config sources.");
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      {saved ? <Notice tone="ok">{saved}</Notice> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="project" value={model?.project ?? "…"} hint={model?.version ? `compose ${model.version}` : "compose v2"} icon="stack" tone="accent" />
        <Metric label="services" value={model?.counts.services ?? "…"} hint={`${model?.counts.ports ?? 0} published ports`} icon="box" />
        <Metric label="volumes · networks" value={`${model?.counts.volumes ?? "…"} · ${model?.counts.networks ?? "…"}`} hint={`${model?.counts.secrets ?? 0} secrets`} icon="disk" />
        <Metric label="errors" value={counts.error} hint="must fix" icon="alert" tone={counts.error ? "bad" : "ok"} />
        <Metric label="warnings" value={counts.warning} hint="review" icon="alert" tone={counts.warning ? "warn" : "ok"} />
        <Metric label="notes" value={counts.info} hint="informational" icon="file" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          padded={false}
          className="min-h-[420px] overflow-hidden"
          title={model?.project ?? "compose"}
          subtitle={mode === "graph" ? "service dependency graph" : "service matrix"}
          icon="map"
          actions={
            <div className="flex items-center gap-1.5">
              <div className="flex overflow-hidden rounded border border-line">
                {(["graph", "services"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={cn("px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em]", mode === option ? "bg-ice/15 text-ice" : "text-slate-400")}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <Button size="xs" icon="refresh" onClick={() => void load()} disabled={loading}>
                reload
              </Button>
            </div>
          }
        >
          {mode === "graph" ? (
            <MapCanvas
              cards={cards}
              edges={edges}
              layout="tree"
              initialLevels={2}
              selectedId={selected}
              onSelect={setSelected}
              emptyMessage="Paste a compose file to validate it."
              legend={[
                { label: "ok", tone: "ok" },
                { label: "warning", tone: "warn" },
                { label: "error", tone: "bad" },
              ]}
            />
          ) : (
            <Table
              head={
                <tr className="border-b border-line">
                  <Th>service</Th>
                  <Th>image</Th>
                  <Th>ports</Th>
                  <Th>depends on</Th>
                  <Th>networks</Th>
                  <Th>volumes</Th>
                  <Th>health</Th>
                  <Th>profiles</Th>
                </tr>
              }
            >
              {(model?.services ?? []).map((service) => (
                <tr key={service.name} className="border-b border-line-soft/60">
                  <Td className="font-mono text-[10.5px] text-slate-100">{service.name}</Td>
                  <Td className="max-w-[160px] truncate font-mono text-[10px] text-slate-400">{service.image}</Td>
                  <Td className="max-w-[130px] truncate font-mono text-[10px] text-slate-400">{service.ports}</Td>
                  <Td className="max-w-[170px] truncate font-mono text-[10px] text-slate-400">{service.dependsOn}</Td>
                  <Td className="max-w-[120px] truncate font-mono text-[10px] text-slate-400">{service.networks}</Td>
                  <Td className="max-w-[140px] truncate font-mono text-[10px] text-slate-400">{service.volumes}</Td>
                  <Td>
                    <Chip tone={service.healthcheck === "yes" ? "ok" : "muted"}>{service.healthcheck}</Chip>
                  </Td>
                  <Td className="font-mono text-[10px] text-slate-400">{service.profiles}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="validate" subtitle="paste or point at a file" icon="search">
            <div className="flex flex-col gap-2">
              <TextArea value={source} onChange={setSource} rows={7} placeholder={"services:\n  api:\n    image: nginx:1.27\n    ports: [\"8080:80\"]"} />
              <div className="flex items-center gap-1.5">
                <Button variant="primary" icon="check" onClick={() => void load({ content: source })} disabled={!source.trim() || loading}>
                  validate yaml
                </Button>
                <Button icon="refresh" onClick={() => { setSource(""); void load(); }}>
                  demo
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="relative path under CONFIG_ROOT"
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-ink-900/60 px-2 font-mono text-[10.5px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none"
                />
                <Button icon="file" onClick={() => void load({ path })} disabled={!path.trim() || loading}>
                  parse
                </Button>
              </div>
              <Button icon="save" onClick={() => void save()} disabled={!model}>
                save source
              </Button>
            </div>
          </Panel>

          <Panel title="findings" subtitle={`${findings.length} checks`} icon="alert" className="min-h-0 flex-1">
            <div className="scroll-thin max-h-[300px] overflow-y-auto">
              <FindingList findings={findings} onSelect={setSelected} />
              {detail ? <p className="mt-2 rounded border border-line/60 px-2 py-1 font-mono text-[9.5px] text-slate-400">selected: {detail.title}</p> : null}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function FindingsSummary({ findings }: { findings: { severity: "error" | "warning" | "info" }[] }) {
  return (
    <div className="flex items-center gap-1">
      {(["error", "warning", "info"] as const).map((severity) => (
        <Chip key={severity} tone={severity === "error" ? "bad" : severity === "warning" ? "warn" : "info"}>
          {findings.filter((finding) => finding.severity === severity).length}
        </Chip>
      ))}
    </div>
  );
}

export { SeverityChip };
