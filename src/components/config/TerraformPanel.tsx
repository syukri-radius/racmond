"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { getJson, postJson } from "@/lib/client";
import type { TerraformModel } from "@/lib/config/types";
import { MapCanvas, type MapCard } from "@/components/map/MapCanvas";
import { Button, Chip, ErrorNote, Metric, Notice, Panel, Table, Td, Th, type Tone } from "@/components/ui/primitives";
import { FindingList } from "./FindingList";

export function TerraformPanel({ initialDir, onDirConsumed }: { initialDir?: string | null; onDirConsumed?: () => void }) {
  const [model, setModel] = useState<TerraformModel | null>(null);
  const [dir, setDir] = useState(initialDir ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"graph" | "inventory">("graph");
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = async (body?: { dir?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const payload = body?.dir
        ? await postJson<{ model: TerraformModel }>("/api/config/terraform", { dir: body.dir })
        : await getJson<{ model: TerraformModel }>("/api/config/terraform");
      setModel(payload.model);
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
    if (!initialDir) return;
    setDir(initialDir);
    void load({ dir: initialDir });
    onDirConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDir]);

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
          tone: (severity === "error" ? "bad" : severity === "warning" ? "warn" : node.kind === "resource" ? "info" : node.kind === "variable" ? "muted" : "accent") as Tone,
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
  };

  const save = async () => {
    if (!model) return;
    try {
      await postJson("/api/config/sources", { name: model.directory.split("/").pop() || "terraform", kind: "terraform", target: model.directory });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      {saved ? <Notice tone="ok">Terraform directory saved to config sources.</Notice> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="resources" value={model?.counts.resources ?? "…"} hint={`${model?.counts.data ?? 0} data sources`} icon="layers" tone="accent" />
        <Metric label="variables" value={model?.counts.variables ?? "…"} hint={`${model?.inventory.variables.filter((variable) => !variable.used).length ?? 0} unused`} icon="code" />
        <Metric label="outputs" value={model?.counts.outputs ?? "…"} hint={`${model?.counts.modules ?? 0} modules`} icon="arrowRight" />
        <Metric label="providers" value={model?.counts.providers ?? "…"} hint={`${model?.files.length ?? 0} .tf files`} icon="server" />
        <Metric label="errors" value={counts.error} hint="must fix" icon="alert" tone={counts.error ? "bad" : "ok"} />
        <Metric label="warnings" value={counts.warning} hint="review" icon="alert" tone={counts.warning ? "warn" : "ok"} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          padded={false}
          className="min-h-[420px] overflow-hidden"
          title={model?.directory.split("/").pop() ?? "terraform"}
          subtitle={mode === "graph" ? "reference graph" : "inventory"}
          icon="map"
          actions={
            <div className="flex items-center gap-1.5">
              <div className="flex overflow-hidden rounded border border-line">
                {(["graph", "inventory"] as const).map((option) => (
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
              emptyMessage="Point at a directory of .tf files."
              legend={[
                { label: "resource", tone: "info" },
                { label: "warning", tone: "warn" },
                { label: "error", tone: "bad" },
              ]}
            />
          ) : (
            <div className="scroll-thin h-full overflow-auto">
              <Table
                head={
                  <tr className="border-b border-line">
                    <Th>address</Th>
                    <Th>type</Th>
                    <Th>file</Th>
                    <Th>references</Th>
                  </tr>
                }
              >
                {(model?.inventory.resources ?? []).map((resource) => (
                  <tr key={resource.address} className="border-b border-line-soft/60">
                    <Td className="font-mono text-[10.5px] text-slate-100">{resource.address}</Td>
                    <Td className="font-mono text-[10px] text-slate-400">{resource.type}</Td>
                    <Td className="font-mono text-[10px] text-slate-500">{resource.file}</Td>
                    <Td className="max-w-[280px] truncate font-mono text-[9.5px] text-slate-500">{resource.references.join(", ") || "—"}</Td>
                  </tr>
                ))}
              </Table>
              <div className="border-t border-line p-2">
                <Table
                  head={
                    <tr className="border-b border-line">
                      <Th>variable</Th>
                      <Th>type</Th>
                      <Th>default</Th>
                      <Th>used</Th>
                    </tr>
                  }
                >
                  {(model?.inventory.variables ?? []).map((variable) => (
                    <tr key={variable.name} className="border-b border-line-soft/60">
                      <Td className="font-mono text-[10.5px] text-slate-100">{variable.name}</Td>
                      <Td className="font-mono text-[10px] text-slate-400">{variable.type}</Td>
                      <Td className="max-w-[200px] truncate font-mono text-[10px] text-slate-400">{variable.default}</Td>
                      <Td>
                        <Chip tone={variable.used ? "ok" : "warn"}>{variable.used ? "used" : "unused"}</Chip>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="target directory" subtitle="relative to CONFIG_ROOT" icon="folder">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <input
                  value={dir}
                  onChange={(event) => setDir(event.target.value)}
                  placeholder="e.g. infra/terraform"
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-ink-900/60 px-2 font-mono text-[10.5px] text-slate-100 placeholder:text-slate-500 focus:border-ice/60 focus:outline-none"
                />
                <Button icon="search" onClick={() => void load({ dir })} disabled={!dir.trim() || loading}>
                  parse
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button icon="refresh" onClick={() => { setDir(""); void load(); }}>
                  bundled demo
                </Button>
                <Button icon="save" onClick={() => void save()} disabled={!model}>
                  save source
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {(model?.files ?? []).map((file) => (
                  <Chip key={file} tone="muted">
                    {file}
                  </Chip>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="checks" subtitle={`${findings.length} findings`} icon="alert" className="min-h-0 flex-1">
            <div className="scroll-thin max-h-[300px] overflow-y-auto">
              <FindingList findings={findings} onSelect={setSelected} />
            </div>
          </Panel>

          {(model?.inventory.modules ?? []).length ? (
            <Panel title="modules" subtitle="sources" icon="stack">
              <div className="flex flex-col gap-1">
                {model?.inventory.modules.map((module) => (
                  <div key={module.name} className="flex items-center gap-2 rounded border border-line/60 px-2 py-1">
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-200">{module.name}</span>
                    <span className="max-w-[150px] truncate font-mono text-[9px] text-slate-500">{module.source}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
