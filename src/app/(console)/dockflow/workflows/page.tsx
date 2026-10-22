"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { cn } from "@/lib/cn";
import { deleteJson, formatMs, getJson, patchJson, postJson, timeAgo, usePoll } from "@/lib/client";
import { NODE_DEFINITIONS, NODE_TYPES, definitionOf } from "@/lib/workflows/registry";
import type { StepStatus, StepType, WorkflowGraphEdge, WorkflowGraphNode, WorkflowRunRow, WorkflowStep } from "@/lib/workflows/types";
import { Chip, Dot, ErrorNote, Field, Notice, PageHeader, Panel, Select, TextArea, TextInput, Toggle, type Tone } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

type StepNodeData = { label?: string; config: Record<string, unknown>; stepType: StepType };
type StepNode = Node<StepNodeData>;

const STATUS_TONE: Record<string, Tone> = {
  success: "ok",
  running: "info",
  pending: "muted",
  skipped: "muted",
  failed: "bad",
  cancelled: "warn",
};

const StepNodeCard = ({ data, selected }: NodeProps) => {
  const nodeData = data as unknown as StepNodeData & { label: string };
  const def = definitionOf(nodeData.stepType);
  const status = (nodeData.config.__status as StepStatus | undefined) ?? "pending";
  return (
    <div
      className={cn(
        "node-surface relative flex w-[196px] flex-col gap-1 rounded-[10px] border px-2.5 py-2",
        selected ? "border-ice/70" : "border-line",
      )}
      style={{ boxShadow: selected ? "0 0 0 1px var(--accent), var(--glass-node-shadow)" : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0" style={{ background: status !== "pending" ? "var(--metric-ok)" : def.accent }} />
      <div className="flex items-center gap-1.5">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px]"
          style={{ color: def.accent, borderColor: `color-mix(in srgb, ${def.accent} 45%, transparent)`, background: `color-mix(in srgb, ${def.accent} 12%, transparent)` }}
        >
          {def.glyph}
        </span>
        <p className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-slate-100">{String(nodeData.label ?? def.label)}</p>
        {status !== "pending" ? <Dot tone={STATUS_TONE[status] ?? "muted"} pulse={status === "running"} /> : null}
      </div>
      <p className="truncate font-mono text-[8.5px] uppercase tracking-[0.12em]" style={{ color: def.accent }}>
        {def.label}
      </p>
      <p className="line-clamp-2 font-mono text-[9px] leading-tight text-slate-500">{primarySummary(nodeData.config)}</p>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0" style={{ background: def.accent }} />
    </div>
  );
};

function primarySummary(config: Record<string, unknown>): string {
  const entries = Object.entries(config).filter(([key]) => !key.startsWith("__") && config[key] !== "" && config[key] !== undefined);
  if (!entries.length) return "no settings yet";
  const [key, value] = entries[0];
  return `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`;
}

const nodeTypes = { step: StepNodeCard };

export default function WorkflowsPage() {
  return (
    <ReactFlowProvider>
      <WorkflowStudio />
    </ReactFlowProvider>
  );
}

function WorkflowStudio() {
  const list = usePoll<{ workflows: WorkflowRow[] }>("/api/workflows", 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: Tone; message: string } | null>(null);
  const [activeRun, setActiveRun] = useState<WorkflowRunRow | null>(null);
  const [runs, setRuns] = useState<WorkflowRunRow[]>([]);
  const reactFlowRef = useRef<HTMLDivElement>(null);

  const workflows = list.data?.workflows ?? [];
  const current = workflows.find((workflow) => workflow.id === selectedId) ?? workflows[0] ?? null;

  // load the first workflow automatically
  useEffect(() => {
    if (!selectedId && workflows.length) setSelectedId(workflows[0].id);
  }, [selectedId, workflows]);

  // hydrate the canvas whenever the workflow changes
  useEffect(() => {
    if (!current) return;
    setName(current.name);
    setNodes(
      (current.nodes ?? []).map((node) => ({
        id: node.id,
        type: "step",
        position: node.position ?? { x: 40, y: 40 },
        data: { label: node.data?.label, config: node.data?.config ?? {}, stepType: node.type },
      })),
    );
    setEdges(
      (current.edges ?? []).map((edge) => ({
        id: edge.id ?? `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: false,
        style: { stroke: "var(--link-default)", strokeWidth: 1.3 },
        labelStyle: { fill: "var(--fg-400)", fontSize: 9, fontFamily: "var(--font-mono)" },
      })),
    );
    setDirty(false);
    setSelectedNode(null);
    setActiveRun(null);
    void getJson<{ runs: WorkflowRunRow[] }>(`/api/workflows/${current.id}`).then((payload) => setRuns(payload.runs ?? [])).catch(() => setRuns([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // poll the active run while it is in flight
  const runState = usePoll<{ run: WorkflowRunRow }>(activeRun && (activeRun.status === "running" || activeRun.status === "pending") ? `/api/workflows/runs/${activeRun.id}` : null, 2000);
  useEffect(() => {
    if (runState.data?.run) {
      setActiveRun(runState.data.run);
      if (runState.data.run.status === "success" || runState.data.run.status === "failed" || runState.data.run.status === "cancelled") {
        setRuns((currentRuns) => [runState.data!.run, ...currentRuns.filter((run) => run.id !== runState.data!.run.id)].slice(0, 20));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runState.data]);

  const stepStatuses = useMemo(() => {
    const map = new Map<string, StepStatus>();
    for (const step of activeRun?.steps ?? []) map.set(step.nodeId, step.status);
    return map;
  }, [activeRun]);

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: { ...node.data, config: { ...node.data.config, __status: stepStatuses.get(node.id) ?? "pending" } },
      })),
    [nodes, stepStatuses],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((existing) => addEdge({ ...connection, id: `${connection.source}-${connection.target}-${Date.now()}`, style: { stroke: "var(--link-default)", strokeWidth: 1.3 } }, existing));
      setDirty(true);
    },
    [setEdges],
  );

  const addStep = (type: StepType, position?: { x: number; y: number }) => {
    const def = definitionOf(type);
    const id = `${type}-${Date.now().toString(36)}`;
    const index = nodes.length;
    setNodes((existing) => [
      ...existing,
      {
        id,
        type: "step",
        position: position ?? { x: 80 + (index % 4) * 230, y: 60 + Math.floor(index / 4) * 130 },
        data: { label: def.label, config: { ...(def.defaults ?? {}) }, stepType: type },
      },
    ]);
    setSelectedNode(id);
    setDirty(true);
  };

  const updateConfig = (nodeId: string, key: string, value: unknown) => {
    setNodes((existing) =>
      existing.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } } : node)),
    );
    setDirty(true);
  };

  const renameNode = (nodeId: string, label: string) => {
    setNodes((existing) => existing.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, label } } : node)));
    setDirty(true);
  };

  const save = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const payload = {
        name,
        nodes: nodes.map((node) => ({ id: node.id, type: node.data.stepType, position: node.position, data: { label: node.data.label, config: stripInternal(node.data.config) } })),
        edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, label: typeof edge.label === "string" ? edge.label : undefined })),
      };
      await patchJson(`/api/workflows/${current.id}`, payload);
      setDirty(false);
      setNotice({ tone: "ok", message: "Workflow saved." });
      list.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const createWorkflow = async (cloneOf?: string) => {
    try {
      const payload = await postJson<{ workflow: WorkflowRow }>("/api/workflows", cloneOf ? { cloneOf } : { name: "Untitled workflow" });
      setNotice({ tone: "ok", message: cloneOf ? "Workflow cloned." : "Workflow created." });
      list.refresh();
      setSelectedId(payload.workflow.id);
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const removeWorkflow = async () => {
    if (!current) return;
    try {
      await deleteJson(`/api/workflows/${current.id}`);
      setNotice({ tone: "warn", message: "Workflow deleted." });
      setSelectedId(null);
      list.refresh();
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const runWorkflow = async () => {
    if (!current) return;
    if (dirty) await save();
    try {
      const payload = await postJson<{ run: WorkflowRunRow }>(`/api/workflows/${current.id}/run`, { trigger: { manual: true, startedAt: new Date().toISOString() } });
      setActiveRun(payload.run);
      setRuns((existing) => [payload.run, ...existing].slice(0, 20));
      setNotice({ tone: "info", message: "Run started — steps light up as they execute." });
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    try {
      await postJson(`/api/workflows/runs/${activeRun.id}`, { action: "cancel" });
      setNotice({ tone: "warn", message: "Cancel requested — the runner stops between steps." });
    } catch (error) {
      setNotice({ tone: "bad", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const node = nodes.find((entry) => entry.id === selectedNode) ?? null;
  const definition = node ? definitionOf(node.data.stepType) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader
        eyebrow="workflows / automation studio"
        title="Workflow builder"
        description="Compose docker actions, execs, log assertions, HTTP probes, CLI calls, delays, conditions and notifications into a graph. Runs execute breadth-first with {{node.field}} templating."
        actions={
          <>
            <button
              type="button"
              onClick={() => void createWorkflow()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-300 hover:border-ice/45 hover:text-ice"
            >
              <Icon name="plus" size={12} /> new
            </button>
            <button
              type="button"
              onClick={() => void createWorkflow(current?.id)}
              disabled={!current}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-300 hover:border-ice/45 hover:text-ice disabled:opacity-40"
            >
              <Icon name="copy" size={12} /> clone
            </button>
            <button
              type="button"
              onClick={() => void removeWorkflow()}
              disabled={!current}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-500/40 px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
            >
              <Icon name="trash" size={12} /> delete
            </button>
            <button
              type="button"
              onClick={() => void runWorkflow()}
              disabled={!current}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ice/55 bg-ice/15 px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ice hover:bg-ice/25 disabled:opacity-40"
            >
              <Icon name="play" size={12} /> run
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!current || saving || !dirty}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-300 hover:border-ice/45 hover:text-ice disabled:opacity-40"
            >
              <Icon name="save" size={12} /> {saving ? "saving" : dirty ? "save*" : "saved"}
            </button>
          </>
        }
      />

      {list.error ? <ErrorNote message={list.error} onRetry={list.refresh} /> : null}
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[210px_minmax(0,1fr)_286px]">
        {/* ------------------------------------------------------- workflow list */}
        <Panel title="workflows" subtitle={`${workflows.length} saved`} icon="workflow" padded={false} className="max-h-[calc(100vh-190px)]">
          <div className="scroll-thin flex h-full flex-col divide-y divide-[var(--line-soft)] overflow-y-auto">
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                onClick={() => setSelectedId(workflow.id)}
                className={cn(
                  "flex flex-col gap-0.5 px-3 py-2 text-left hover:bg-ice/[0.06]",
                  current?.id === workflow.id && "bg-ice/[0.1]",
                )}
              >
                <span className="truncate font-mono text-[11px] text-slate-100">{workflow.name}</span>
                <span className="line-clamp-2 text-[9.5px] leading-tight text-slate-500">{workflow.description ?? "no description"}</span>
                <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-500">
                  {(workflow.nodes ?? []).length} nodes · {timeAgo(workflow.updatedAt)}
                </span>
              </button>
            ))}
            {!workflows.length ? <p className="px-3 py-6 text-center text-[11px] text-slate-500">{list.loading ? "loading…" : "no workflows yet"}</p> : null}
          </div>
        </Panel>

        {/* ------------------------------------------------------------- canvas */}
        <Panel
          padded={false}
          className="min-h-[460px] overflow-hidden"
          title={current?.name ?? "canvas"}
          subtitle={dirty ? "unsaved changes" : "saved"}
          icon="workflow"
          actions={<Chip tone={dirty ? "warn" : "muted"}>{nodes.length} nodes · {edges.length} links</Chip>}
        >
          <div className="flex h-[calc(100vh-236px)] min-h-0">
            <div className="scroll-thin w-[136px] shrink-0 overflow-y-auto border-r border-line-soft p-1.5">
              <p className="mb-1 px-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-slate-500">palette</p>
              {NODE_TYPES.map((type) => {
                const def = NODE_DEFINITIONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("application/dockflow-step", type)}
                    onClick={() => addStep(type)}
                    title={def.description}
                    className="mb-1 flex w-full items-center gap-1.5 rounded border border-line/60 px-1.5 py-1 text-left hover:border-ice/40"
                  >
                    <span className="text-[11px]" style={{ color: def.accent }}>
                      {def.glyph}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[9px] uppercase tracking-[0.06em] text-slate-300">{def.label}</span>
                  </button>
                );
              })}
            </div>
            <div
              ref={reactFlowRef}
              className="min-w-0 flex-1"
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const type = event.dataTransfer.getData("application/dockflow-step") as StepType;
                if (!type) return;
                const rect = reactFlowRef.current?.getBoundingClientRect();
                addStep(type, { x: event.clientX - (rect?.left ?? 0) - 90, y: event.clientY - (rect?.top ?? 0) - 30 });
              }}
            >
              <ReactFlow
                nodes={decoratedNodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={(changes) => {
                  onEdgesChange(changes);
                  setDirty(true);
                }}
                onConnect={onConnect}
                onNodeClick={(_, clicked) => setSelectedNode(clicked.id)}
                onPaneClick={() => setSelectedNode(null)}
                onNodesDelete={() => setDirty(true)}
                fitView
                minZoom={0.25}
                maxZoom={1.6}
                proOptions={{ hideAttribution: true }}
                deleteKeyCode={["Backspace", "Delete"]}
                className="[&_.react-flow\_\_pane]:bg-transparent"
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--grid-line-strong)" />
                <Controls
                  showInteractive={false}
                  className="!bottom-2 !left-2 [&>button]:!h-6 [&>button]:!w-6 [&>button]:!border-line [&>button]:!bg-ink-900/80 [&>button]:!text-slate-300"
                />
                <MiniMap
                  pannable
                  zoomable
                  className="!bottom-2 !right-2 !h-[74px] !w-[116px] !rounded-md !border !border-line !bg-ink-900/70"
                  maskColor="rgba(6,3,14,0.7)"
                  nodeColor={() => "var(--accent)"}
                />
              </ReactFlow>
            </div>
          </div>
        </Panel>

        {/* ---------------------------------------------------------- inspector */}
        <Panel title="inspector" subtitle={definition ? definition.label : "select a node"} icon="edit" className="max-h-[calc(100vh-190px)]">
          <div className="scroll-thin flex h-full flex-col gap-2 overflow-y-auto">
            {!node || !definition ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11.5px] leading-relaxed text-slate-500">
                  Pick a node on the canvas to edit its settings. Fields come straight from the step registry, so a new step type shows up here without extra UI work.
                </p>
                <div className="glass-inset rounded-md border p-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">workflow name</p>
                  <TextInput value={name} onChange={(value) => { setName(value); setDirty(true); }} className="mt-1" />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">steps ({nodes.length})</p>
                  {nodes.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelectedNode(entry.id)}
                      className="flex items-center gap-1.5 rounded border border-line/60 px-2 py-1 text-left hover:border-ice/40"
                    >
                      <span className="text-[11px]" style={{ color: definitionOf(entry.data.stepType).accent }}>
                        {definitionOf(entry.data.stepType).glyph}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{String(entry.data.label ?? entry.id)}</span>
                      <span className="font-mono text-[8.5px] text-slate-500">{stepStatuses.get(entry.id) ?? "—"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Chip tone="accent">{definition.label}</Chip>
                  <button type="button" onClick={() => setSelectedNode(null)} className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500 hover:text-ice">
                    close
                  </button>
                </div>
                <p className="text-[10.5px] leading-relaxed text-slate-500">{definition.description}</p>
                <Field label="label">
                  <TextInput value={String(node.data.label ?? "")} onChange={(value) => renameNode(node.id, value)} />
                </Field>
                {definition.fields.map((field) => {
                  const value = node.data.config[field.key];
                  if (field.kind === "boolean") {
                    return (
                      <Toggle
                        key={field.key}
                        checked={Boolean(value)}
                        onChange={(next) => updateConfig(node.id, field.key, next)}
                        label={field.label}
                        hint={field.help}
                      />
                    );
                  }
                  if (field.kind === "select") {
                    return (
                      <Field key={field.key} label={field.label} hint={field.help} required={field.required}>
                        <Select
                          value={String(value ?? "")}
                          onChange={(next) => updateConfig(node.id, field.key, next)}
                          options={field.options ?? []}
                        />
                      </Field>
                    );
                  }
                  if (field.kind === "textarea") {
                    return (
                      <Field key={field.key} label={field.label} hint={field.help} required={field.required}>
                        <TextArea value={String(value ?? "")} onChange={(next) => updateConfig(node.id, field.key, next)} placeholder={field.placeholder} rows={4} />
                      </Field>
                    );
                  }
                  return (
                    <Field key={field.key} label={field.label} hint={field.help} required={field.required}>
                      <TextInput
                        value={String(value ?? "")}
                        onChange={(next) => updateConfig(node.id, field.key, field.kind === "number" ? Number(next) || 0 : next)}
                        placeholder={field.placeholder}
                      />
                    </Field>
                  );
                })}
                <div className="rounded border border-line/60 px-2 py-1.5">
                  <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-slate-500">outputs</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {definition.outputs.map((output) => (
                      <Chip key={output} tone="muted">
                        {`{{${node.id}.${output}}}`}
                      </Chip>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNodes((existing) => existing.filter((entry) => entry.id !== node.id));
                    setEdges((existing) => existing.filter((edge) => edge.source !== node.id && edge.target !== node.id));
                    setSelectedNode(null);
                    setDirty(true);
                  }}
                  className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-rose-500/40 font-mono text-[10px] uppercase tracking-[0.1em] text-rose-300 hover:bg-rose-500/10"
                >
                  <Icon name="trash" size={11} /> delete step
                </button>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------------------- timeline */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title="run timeline"
          subtitle={activeRun ? `${activeRun.status} · ${activeRun.steps?.length ?? 0} steps` : "no run selected"}
          icon="activity"
          actions={
            activeRun && (activeRun.status === "running" || activeRun.status === "pending") ? (
              <button
                type="button"
                onClick={() => void cancelRun()}
                className="inline-flex h-6 items-center gap-1 rounded border border-rose-500/40 px-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-rose-300 hover:bg-rose-500/10"
              >
                <Icon name="stop" size={10} /> cancel
              </button>
            ) : activeRun ? (
              <Chip tone={STATUS_TONE[activeRun.status] ?? "muted"}>{activeRun.status}</Chip>
            ) : null
          }
        >
          {activeRun ? (
            <div className="flex flex-col gap-1.5">
              {activeRun.error ? <Notice tone="bad">{activeRun.error}</Notice> : null}
              {(activeRun.steps ?? []).length ? (
                (activeRun.steps ?? []).map((step, index) => <TimelineStep key={`${step.nodeId}-${index}`} step={step} index={index} />)
              ) : (
                <p className="py-3 text-center text-[11.5px] text-slate-500">pending — the runner has not persisted a step yet</p>
              )}
            </div>
          ) : (
            <p className="py-4 text-center text-[11.5px] text-slate-500">Run the workflow (or pick a previous run on the right) to see each step transition.</p>
          )}
        </Panel>

        <Panel title="history" subtitle={`${runs.length} runs`} icon="clock">
          <div className="scroll-thin flex max-h-[240px] flex-col gap-1 overflow-y-auto">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setActiveRun(run)}
                className={cn(
                  "flex items-center gap-2 rounded border px-2 py-1 text-left",
                  activeRun?.id === run.id ? "border-ice/50 bg-ice/[0.08]" : "border-line/60 hover:border-ice/35",
                )}
              >
                <Dot tone={STATUS_TONE[run.status] ?? "muted"} pulse={run.status === "running"} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[10px] text-slate-200">{run.workflowName ?? "workflow"}</p>
                  <p className="font-mono text-[8.5px] text-slate-500">
                    {timeAgo(run.startedAt)} · {run.steps?.length ?? 0} steps
                    {run.finishedAt ? ` · ${formatMs(new Date(run.finishedAt as unknown as string).getTime() - new Date(run.startedAt as unknown as string).getTime())}` : ""}
                  </p>
                </div>
                <Chip tone={STATUS_TONE[run.status] ?? "muted"}>{run.status}</Chip>
              </button>
            ))}
            {!runs.length ? <p className="py-4 text-center text-[11px] text-slate-500">no runs yet</p> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TimelineStep({ step, index }: { step: WorkflowStep; index: number }) {
  const [open, setOpen] = useState(false);
  const def = definitionOf(step.type);
  const tone = STATUS_TONE[step.status] ?? "muted";
  return (
    <div className="rounded border border-line/60">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
        <span className="w-4 shrink-0 font-mono text-[9px] text-slate-500">{index + 1}</span>
        <span className="text-[11px]" style={{ color: def.accent }}>
          {def.glyph}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-slate-200">{step.label}</span>
        <span className="shrink-0 font-mono text-[9px] text-slate-500">{formatMs(step.durationMs)}</span>
        {step.exitCode !== null ? <Chip tone={step.exitCode === 0 ? "ok" : "bad"}>exit {step.exitCode}</Chip> : null}
        <Chip tone={tone}>{step.status}</Chip>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={11} className="shrink-0 text-slate-500" />
      </button>
      {open ? (
        <div className="flex flex-col gap-1 border-t border-line-soft px-2 py-1.5">
          {step.error ? <Notice tone="bad">{step.error}</Notice> : null}
          <pre className="scroll-thin max-h-40 overflow-auto rounded bg-ink-900/60 p-2 font-mono text-[10px] leading-relaxed text-slate-300">
            {step.output || "(no output)"}
          </pre>
          <p className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-slate-500">
            {step.nodeId} · started {timeAgo(step.startedAt)} · finished {timeAgo(step.finishedAt)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function stripInternal(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith("__")));
}
