"use client";

import "@xyflow/react/dist/style.css";

import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
  type Edge as FlowEdge,
  type Node as FlowNode,
} from "@xyflow/react";
import { cn } from "@/lib/cn";
import { Chip, TONE_TEXT, type Tone } from "@/components/ui/primitives";
import { childCounts, defaultExpanded, layoutLayered, layoutTree, visibleIds, type HierarchyNode } from "./layout";

export interface MapCardStat {
  label: string;
  pct: number;
  value: string;
  tone?: Tone;
}

export interface MapCard extends HierarchyNode {
  title: string;
  subtitle: string;
  kind: string;
  glyph?: string;
  tone?: Tone;
  chips?: string[];
  stats?: MapCardStat[];
  badge?: string;
}

export interface MapEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  tone?: Tone;
  animated?: boolean;
}

export const CARD_WIDTH = 268;

const KIND_GLYPH: Record<string, string> = {
  host: "▣",
  project: "❒",
  service: "◆",
  container: "▢",
  image: "▤",
  volume: "◫",
  network: "⌗",
  engine: "⚙",
  group: "❐",
  port: "⇥",
  env: "≡",
  repository: "◉",
  issue: "◌",
  resource: "▧",
  module: "❖",
  variable: "λ",
  output: "⇤",
  runtime: "◈",
  database: "⛁",
  cache: "⚡",
};

const KIND_TONE: Record<string, Tone> = {
  host: "accent",
  project: "info",
  service: "ok",
  container: "info",
  network: "accent",
  volume: "warn",
  engine: "muted",
  repository: "accent",
  issue: "warn",
  resource: "info",
  module: "accent",
  variable: "muted",
  output: "ok",
};

const toneStroke: Record<Tone, string> = {
  ok: "var(--metric-ok)",
  warn: "var(--metric-warn)",
  bad: "var(--metric-danger)",
  info: "var(--sky-400)",
  muted: "var(--fg-500)",
  accent: "var(--accent)",
};

interface CardActions {
  expanded: Record<string, boolean>;
  toggle: (id: string) => void;
  select: (id: string) => void;
  selectedId: string | null;
  childCount: Map<string, number>;
  total: number;
}

const CardContext = createContext<CardActions | null>(null);

const MapNodeCard = memo(function MapNodeCard({ id, data }: NodeProps) {
  const actions = useContext(CardContext);
  const card = data as unknown as MapCard;
  const tone = card.tone ?? KIND_TONE[card.kind] ?? "muted";
  const isOpen = actions?.expanded[id] ?? false;
  const kids = actions?.childCount.get(id) ?? 0;
  const selected = actions?.selectedId === id;

  return (
    <div
      className={cn(
        "node-surface relative flex flex-col rounded-[11px] border px-3 py-2 text-left",
        selected ? "border-ice/70" : "border-line",
      )}
      style={{
        width: CARD_WIDTH,
        minHeight: 76,
        boxShadow: selected ? "0 0 0 1px var(--accent), var(--glass-node-shadow)" : undefined,
      }}
      onClick={() => actions?.select(id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") actions?.select(id);
      }}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0" style={{ background: toneStroke[tone], left: -3 }} />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0" style={{ background: toneStroke[tone], right: -3 }} />

      <div className="flex items-start gap-2">
        <span
          className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px]"
          style={{
            color: toneStroke[tone],
            borderColor: `color-mix(in srgb, ${toneStroke[tone]} 40%, transparent)`,
            background: `color-mix(in srgb, ${toneStroke[tone]} 12%, transparent)`,
          }}
        >
          {card.glyph ?? KIND_GLYPH[card.kind] ?? "•"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight text-slate-100" title={card.title}>
              {card.title}
            </p>
            {card.badge ? <Chip tone={tone}>{card.badge}</Chip> : null}
          </div>
          <p className="mt-[2px] truncate font-mono text-[9.5px] leading-tight text-slate-500" title={card.subtitle}>
            {card.subtitle}
          </p>
        </div>
        {kids > 0 || isOpen ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              actions?.toggle(id);
            }}
            className={cn(
              "ml-1 shrink-0 rounded border px-1.5 py-[1px] font-mono text-[9.5px] leading-tight transition-colors",
              isOpen ? "border-ice/45 text-ice hover:bg-ice/15" : "border-line text-slate-400 hover:border-ice/40 hover:text-ice",
            )}
            title={isOpen ? "Collapse" : `Expand ${kids} child${kids === 1 ? "" : "ren"}`}
            style={{ minWidth: 24 }}
          >
            {isOpen ? "−" : `+${kids}`}
          </button>
        ) : null}
      </div>

      {card.stats?.length ? (
        <div className="mt-2 flex flex-col gap-1">
          {card.stats.slice(0, 2).map((stat) => (
            <div key={stat.label} className="flex items-center gap-1.5">
              <span className="w-7 shrink-0 font-mono text-[8.5px] uppercase tracking-[0.08em] text-slate-500">{stat.label}</span>
              <span className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--gauge-track)" }}>
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, stat.pct))}%`,
                    background: toneStroke[stat.tone ?? tone],
                  }}
                />
              </span>
              <span className="tabular w-11 shrink-0 text-right font-mono text-[9px] text-slate-400">{stat.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {card.chips?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.chips.slice(0, 4).map((chip, index) => (
            <span
              key={`${chip}-${index}`}
              className="max-w-[120px] truncate rounded border border-line/70 px-1 py-[0.5px] font-mono text-[8.5px] leading-[1.4] text-slate-400"
              title={chip}
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
});

const nodeTypes = { mapCard: MapNodeCard };

function FitController({ signature, autoFit }: { signature: string; autoFit: boolean }) {
  const { fitView } = useReactFlow();
  const last = useRef("");
  useEffect(() => {
    if (!autoFit) return;
    if (last.current === signature) return;
    last.current = signature;
    const timer = setTimeout(() => {
      void fitView({ padding: 0.18, duration: 420 });
    }, 60);
    return () => clearTimeout(timer);
  }, [signature, autoFit, fitView]);
  return null;
}

export interface MapCanvasProps {
  cards: MapCard[];
  edges: MapEdge[];
  layout?: "tree" | "layered";
  /** how many hierarchy levels start expanded */
  initialLevels?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  emptyMessage?: string;
  toolbar?: ReactNode;
  autoFit?: boolean;
  legend?: { label: string; tone: Tone }[];
  overlay?: ReactNode;
}

function MapCanvasInner({
  cards,
  edges,
  layout = "tree",
  initialLevels = 2,
  selectedId = null,
  onSelect,
  className = "",
  emptyMessage = "Nothing to map yet.",
  toolbar,
  autoFit = true,
  legend,
  overlay,
}: MapCanvasProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => defaultExpanded(cards, initialLevels));
  const [structureKey, setStructureKey] = useState("");
  const [fitSignal, setFitSignal] = useState(0);

  useEffect(() => {
    const key = cards.map((card) => card.id).join("|");
    if (key !== structureKey) {
      setStructureKey(key);
      setExpanded((current) => (Object.keys(current).length ? current : defaultExpanded(cards, initialLevels)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const counts = useMemo(() => childCounts(cards), [cards]);
  const visible = useMemo(() => visibleIds(cards, expanded), [cards, expanded]);
  const visibleCards = useMemo(() => cards.filter((card) => visible.has(card.id)), [cards, visible]);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(Object.fromEntries(cards.filter((card) => (counts.get(card.id) ?? 0) > 0).map((card) => [card.id, true])));
    setFitSignal((value) => value + 1);
  }, [cards, counts]);

  const collapseAll = useCallback(() => {
    setExpanded(Object.fromEntries(cards.filter((card) => !card.parentId).map((card) => [card.id, false])));
    setFitSignal((value) => value + 1);
  }, [cards]);

  const positions = useMemo(() => {
    if (layout === "layered") return layoutLayered(visibleCards, edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)));
    return layoutTree(visibleCards);
  }, [layout, visibleCards, edges, visible]);

  const actions = useMemo<CardActions>(
    () => ({ expanded, toggle, select: (id: string) => onSelect?.(id), selectedId, childCount: counts, total: cards.length }),
    [expanded, toggle, onSelect, selectedId, counts, cards.length],
  );

  const flowNodes = useMemo<FlowNode[]>(
    () =>
      visibleCards.map((card) => ({
        id: card.id,
        type: "mapCard",
        position: positions.get(card.id) ?? { x: 0, y: 0 },
        data: card as unknown as Record<string, unknown>,
        draggable: false,
        selectable: true,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      })),
    [visibleCards, positions],
  );

  const flowEdges = useMemo<FlowEdge[]>(
    () =>
      edges
        .filter((edge) => visible.has(edge.source) && visible.has(edge.target) && edge.source !== edge.target)
        .map((edge, index) => ({
          id: edge.id ?? `${edge.source}->${edge.target}-${index}`,
          source: edge.source,
          target: edge.target,
          label: edge.label,
          type: "smoothstep",
          animated: edge.animated ?? false,
          style: {
            stroke: toneStroke[edge.tone ?? "accent"],
            strokeOpacity: edge.tone === "bad" ? 0.7 : 0.45,
            strokeWidth: edge.tone === "bad" ? 1.6 : 1.1,
          },
          labelStyle: { fill: "var(--fg-400)", fontSize: 8.5, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.1em" },
          labelBgStyle: { fill: "var(--ink-900)", fillOpacity: 0.85 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 3,
        })),
    [edges, visible],
  );

  const signature = `${visibleCards.length}:${layout}:${fitSignal}`;
  const parentCount = useMemo(() => cards.filter((card) => (counts.get(card.id) ?? 0) > 0).length, [cards, counts]);

  return (
    <CardContext.Provider value={actions}>
      <div className={cn("relative h-full min-h-[320px] flex-1", className)}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.18}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => onSelect?.(node.id)}
          className="[&_.react-flow\_\_pane]:bg-transparent"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--grid-line-strong)" />
          <Controls
            showInteractive={false}
            className="!bottom-3 !left-3 [&>button]:!h-6 [&>button]:!w-6 [&>button]:!border-line [&>button]:!bg-ink-900/80 [&>button]:!text-slate-300 [&>button:hover]:!text-ice"
          />
          <MiniMap
            pannable
            zoomable
            nodeColor={() => "var(--accent)"}
            maskColor="rgba(6,3,14,0.72)"
            className="!bottom-3 !right-3 !h-[92px] !w-[150px] !rounded-md !border !border-line !bg-ink-900/70"
          />
          <FitController signature={signature} autoFit={autoFit} />

          <Panel position="top-left" className="!m-2 flex flex-wrap items-center gap-1.5">
            <div className="glass-chip flex items-center gap-1 rounded-md border px-1.5 py-1">
              <button
                type="button"
                onClick={expandAll}
                className="rounded px-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-slate-300 hover:text-ice"
                title={`Expand all (${parentCount} parents)`}
              >
                expand all
              </button>
              <span className="text-slate-600">/</span>
              <button
                type="button"
                onClick={collapseAll}
                className="rounded px-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-slate-300 hover:text-ice"
                title="Collapse to roots"
              >
                collapse
              </button>
              <span className="text-slate-600">/</span>
              <button
                type="button"
                onClick={() => setFitSignal((value) => value + 1)}
                className="rounded px-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-slate-300 hover:text-ice"
                title="Fit to view"
              >
                fit
              </button>
              <span className="ml-1 border-l border-line pl-1.5 font-mono text-[9.5px] text-slate-400">
                {visibleCards.length}/{cards.length} visible
              </span>
            </div>
            {toolbar}
          </Panel>

          <Panel position="top-right" className="!m-2">
            <div className="flex flex-col items-end gap-1">
              {legend?.length ? (
                <div className="glass-chip flex items-center gap-2 rounded-md border px-2 py-1">
                  {legend.map((entry) => (
                    <span key={entry.label} className="flex items-center gap-1 font-mono text-[8.5px] uppercase tracking-[0.08em] text-slate-400">
                      <span className="h-[5px] w-[5px] rounded-full" style={{ background: toneStroke[entry.tone] }} />
                      {entry.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {overlay}
            </div>
          </Panel>
        </ReactFlow>

        {!cards.length ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="text-[12px] text-slate-500">{emptyMessage}</p>
          </div>
        ) : null}
      </div>
    </CardContext.Provider>
  );
}

export function MapCanvas(props: MapCanvasProps) {
  return (
    <ReactFlowProvider>
      <MapCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export { TONE_TEXT };
