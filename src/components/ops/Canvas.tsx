"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeStatus } from "@/lib/types";
import { matchesQuery } from "@/lib/graph";
import type { LayoutBox } from "@/lib/elk-layout";
import { useTopologyLayout } from "@/hooks/useTopologyLayout";
import { useOps } from "@/store/ops";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ops/icons";
import { NodeCard } from "@/components/ops/NodeCard";

interface Highlight {
  matched: Set<string>;
  keep: Set<string>;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function Canvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { layout, computing, error } = useTopologyLayout();
  const rootIds = useOps((s) => s.rootIds);
  const direction = useOps((s) => s.direction);
  const zoom = useOps((s) => s.zoom);
  const pan = useOps((s) => s.pan);
  const fitToken = useOps((s) => s.fitToken);
  const focusRequest = useOps((s) => s.focusRequest);
  const setView = useOps((s) => s.setView);
  const phase = useOps((s) => s.phase);
  const select = useOps((s) => s.select);

  const nodesById = useOps((s) => s.nodesById);
  const list = useOps((s) => s.list);
  const query = useOps((s) => s.query);
  const statusFilter = useOps((s) => s.statusFilter);

  const highlight = useMemo<Highlight | null>(() => {
    const hasQuery = query.trim().length > 0;
    if (!hasQuery && statusFilter.length === 0) return null;
    const matched = new Set<string>();
    for (const node of list) {
      const byQuery = hasQuery ? matchesQuery(node, query) : true;
      const byStatus = statusFilter.length === 0 ? true : statusFilter.includes(node.status);
      if (byQuery && byStatus && node.type !== "resource") matched.add(node.id);
    }
    const keep = new Set(matched);
    for (const id of matched) {
      let parent = nodesById[id]?.parentId ?? null;
      while (parent) {
        keep.add(parent);
        parent = nodesById[parent]?.parentId ?? null;
      }
    }
    return { matched, keep };
  }, [query, statusFilter, list, nodesById]);

  /* ---------------- wheel zoom / pan (native, non-passive) ---------------- */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = useOps.getState();
      const rect = element.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey) {
        const nextZoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.0016), 0.06, 2.4);
        const scale = nextZoom / state.zoom;
        state.setView(nextZoom, {
          x: cursorX - (cursorX - state.pan.x) * scale,
          y: cursorY - (cursorY - state.pan.y) * scale,
        });
      } else {
        state.setView(state.zoom, { x: state.pan.x - event.deltaX, y: state.pan.y - event.deltaY });
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  /* ---------------- fit to view ----------------
   * Runs once for the first computed layout and afterwards only on an explicit
   * fit request (fit button, depth change, direction change, auto-layout) so
   * collapsing a branch never yanks the viewport away from the operator. */
  const lastFitToken = useRef(-1);
  const fittedOnce = useRef(false);
  useEffect(() => {
    if (!layout) return;
    const explicit = lastFitToken.current !== fitToken;
    if (!explicit && fittedOnce.current) return;
    const firstPaint = !fittedOnce.current;
    lastFitToken.current = fitToken;
    fittedOnce.current = true;

    const element = containerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    const fitAll = clamp(Math.min((rect.width - 96) / layout.width, (rect.height - 96) / layout.height), 0.06, 1.15);
    // wide estates: on first paint prefer a legible zoom, operators pan sideways
    const zoom = firstPaint && fitAll < 0.42 ? clamp((rect.height - 96) / layout.height, 0.34, 0.78) : fitAll;
    setView(zoom, {
      x: (rect.width - layout.width * zoom) / 2,
      y: (rect.height - layout.height * zoom) / 2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, fitToken, setView]);

  /* ---------------- focus a node ---------------- */
  useEffect(() => {
    if (!focusRequest || !layout) return;
    const box = layout.abs[focusRequest.id];
    const element = containerRef.current;
    if (!box || !element) return;
    const rect = element.getBoundingClientRect();
    const state = useOps.getState();
    const nextZoom = clamp(Math.max(state.zoom, Math.min(0.9, (rect.width * 0.5) / Math.max(box.width, 1))), 0.06, 1.6);
    state.setView(nextZoom, {
      x: rect.width / 2 - (box.x + box.width / 2) * nextZoom,
      y: rect.height / 2 - (box.y + box.height / 2) * nextZoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.token, layout]);

  /* ---------------- backdrop drag to pan ---------------- */
  const panState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 14000);
    return () => clearTimeout(timer);
  }, []);

  const onBackdropPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const state = useOps.getState();
    panState.current = { x: event.clientX, y: event.clientY, panX: state.pan.x, panY: state.pan.y };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    select(null);
  }, [select]);

  const onBackdropPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = panState.current;
    if (!start) return;
    useOps.getState().setView(useOps.getState().zoom, {
      x: start.panX + (event.clientX - start.x),
      y: start.panY + (event.clientY - start.y),
    });
  }, []);

  const onBackdropPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panState.current) return;
    panState.current = null;
    setPanning(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const element = containerRef.current;
    const state = useOps.getState();
    const rect = element?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    const nextZoom = clamp(state.zoom * factor, 0.06, 2.4);
    const scale = nextZoom / state.zoom;
    state.setView(nextZoom, { x: cx - (cx - state.pan.x) * scale, y: cy - (cy - state.pan.y) * scale });
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("canvas-grid relative h-full w-full overflow-hidden", panning ? "cursor-grabbing" : "cursor-grab")}
      onPointerDown={onBackdropPointerDown}
      onPointerMove={onBackdropPointerMove}
      onPointerUp={onBackdropPointerUp}
      onPointerCancel={onBackdropPointerUp}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}
      >
        {layout
          ? rootIds.map((id) => (
              <SubFlowNode key={id} id={id} boxes={layout.boxes} depth={0} parentBox={null} highlight={highlight} />
            ))
          : null}
      </div>

      {/* canvas chrome */}
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <span className="glass-chip pointer-events-auto flex items-center gap-1.5 rounded border border-line px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-400">
          <Icon name="network" size={11} className="text-ice" />
          elk layered · {direction}
          <span className="text-slate-600">|</span>
          {layout ? `${layout.visibleCount} nodes · ${layout.elapsedMs}ms` : computing ? "computing…" : "idle"}
        </span>
        {computing ? (
          <span className="relative h-[3px] w-24 overflow-hidden rounded-full bg-[var(--gauge-track)] sweep" />
        ) : null}
      </div>

      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
        <div className="glass-chip flex overflow-hidden rounded-md border border-line">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.25)}
            className="flex h-7 w-7 items-center justify-center text-slate-400 transition hover:bg-slate-100/[0.07] hover:text-ice"
            title="Zoom out"
          >
            <Icon name="zoomOut" size={13} />
          </button>
          <span className="tabular flex h-7 items-center border-x border-line px-2 font-mono text-[9.5px] text-slate-400">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(1.25)}
            className="flex h-7 w-7 items-center justify-center text-slate-400 transition hover:bg-slate-100/[0.07] hover:text-ice"
            title="Zoom in"
          >
            <Icon name="zoomIn" size={13} />
          </button>
          <button
            type="button"
            onClick={() => useOps.getState().requestFit()}
            className="flex h-7 w-7 items-center justify-center border-l border-line text-slate-400 transition hover:bg-slate-100/[0.07] hover:text-ice"
            title="Fit hierarchy to view"
          >
            <Icon name="fit" size={13} />
          </button>
        </div>
        {error ? (
          <span className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono text-[9px] text-rose-300">
            layout error: {error}
          </span>
        ) : null}
      </div>

      {phase !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-2">
            <span className="relative h-[3px] w-40 overflow-hidden rounded-full bg-[var(--gauge-track)] sweep" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              {phase === "error" ? "topology unavailable" : "loading topology"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface SubFlowProps {
  id: string;
  boxes: Record<string, LayoutBox>;
  depth: number;
  parentBox: LayoutBox | null;
  highlight: Highlight | null;
}

/**
 * One node of the nested sub-flow. Children are positioned relative to this
 * container and dragging is clamped to the parent bounds (extent: 'parent').
 */
const SubFlowNode = memo(function SubFlowNode({ id, boxes, depth, parentBox, highlight }: SubFlowProps) {
  const node = useOps((s) => s.nodesById[id]);
  const metric = useOps((s) => s.metrics[id]);
  const series = useOps((s) => s.series[id]);
  const isCollapsed = useOps((s) => Boolean(s.collapsed[id]));
  const override = useOps((s) => s.overrides[id]);
  const childrenOf = useOps((s) => s.childrenOf);
  const nodesById = useOps((s) => s.nodesById);
  const showResourceNodes = useOps((s) => s.showResourceNodes);
  const selectedId = useOps((s) => s.selectedId);
  const descendantCount = useOps((s) => s.descendantCount[id] ?? 0);
  const select = useOps((s) => s.select);
  const toggleCollapse = useOps((s) => s.toggleCollapse);
  const setOverride = useOps((s) => s.setOverride);
  const persistOverride = useOps((s) => s.persistOverride);

  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number; moved: boolean } | null>(null);

  const children = useMemo(() => {
    if (isCollapsed) return [] as string[];
    const kids = childrenOf[id] ?? [];
    return showResourceNodes ? kids : kids.filter((kid) => nodesById[kid]?.type !== "resource");
  }, [childrenOf, nodesById, id, isCollapsed, showResourceNodes]);

  const box = boxes[id];

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !box) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const current = override ?? { x: box.x, y: box.y };
      drag.current = { pointerX: event.clientX, pointerY: event.clientY, originX: current.x, originY: current.y, moved: false };
      setDragging(true);
    },
    [box, override],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (!start || !box) return;
      const zoomLevel = useOps.getState().zoom;
      const deltaX = (event.clientX - start.pointerX) / zoomLevel;
      const deltaY = (event.clientY - start.pointerY) / zoomLevel;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) start.moved = true;
      // extent: 'parent' — never allow the node to leave its container
      const maxX = parentBox ? Math.max(0, parentBox.width - box.width) : start.originX;
      const maxY = parentBox ? Math.max(0, parentBox.height - box.height) : start.originY;
      setOverride(id, clamp(start.originX + deltaX, 0, maxX), clamp(start.originY + deltaY, 0, maxY));
    },
    [box, id, parentBox, setOverride],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      drag.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (!start) return;
      if (!start.moved) select(id);
      else persistOverride(id);
    },
    [id, persistOverride, select],
  );

  if (!node || !box) return null;

  const x = override?.x ?? box.x;
  const y = override?.y ?? box.y;
  const selected = selectedId === id;
  const matched = highlight?.matched.has(id) ?? false;
  const dimmed = highlight ? !highlight.keep.has(id) : false;

  return (
    <div className="absolute" style={{ left: x, top: y, width: box.width, height: box.height }} data-node-id={id}>
      {parentBox ? <ParentLink parentBox={parentBox} selfX={x} selfY={y} width={box.width} status={node.status} /> : null}

      <div
        className={cn("absolute inset-0 touch-none", dragging ? "cursor-grabbing" : box.isGroup ? "cursor-grab" : "cursor-pointer")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => {
          if (childrenOf[id]?.length) {
            event.stopPropagation();
            toggleCollapse(id);
          }
        }}
      >
        <NodeCard
          node={node}
          metric={metric}
          series={series}
          box={box}
          collapsed={isCollapsed}
          childCount={childrenOf[id]?.length ?? 0}
          descendantCount={descendantCount}
          selected={selected}
          matched={matched}
          dimmed={dimmed}
          dragging={dragging}
        />
      </div>

      {children.map((childId) => (
        <SubFlowNode
          key={childId}
          id={childId}
          boxes={boxes}
          depth={depth + 1}
          parentBox={box}
          highlight={highlight}
        />
      ))}
    </div>
  );
});

/** Orthogonal connector drawn by each child towards its parent's header anchor. */
const ParentLink = memo(function ParentLink({
  parentBox,
  selfX,
  selfY,
  width,
  status,
}: {
  parentBox: LayoutBox;
  selfX: number;
  selfY: number;
  width: number;
  status: NodeStatus;
}) {
  const anchorX = parentBox.width / 2 - selfX;
  const anchorY = parentBox.header - 6 - selfY;
  const midY = anchorY / 2;
  const targetX = width / 2;
  const stroke =
    status === "critical" ? "var(--link-critical)" : status === "degraded" ? "var(--link-degraded)" : "var(--link-default)";
  return (
    <svg className="pointer-events-none absolute left-0 top-0 h-full w-full overflow-visible">
      <path d={`M ${anchorX} ${anchorY} L ${anchorX} ${midY} L ${targetX} ${midY} L ${targetX} 0`} fill="none" style={{ stroke }} strokeWidth="1" />
      <circle cx={targetX} cy={0} r="1.8" style={{ fill: stroke }} />
    </svg>
  );
});
