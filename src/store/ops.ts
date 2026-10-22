"use client";

import { create } from "zustand";
import type { CommandRun, EventItem, MetricSnapshot, NodeStatus, TopologyNode, TopologyPayload } from "@/lib/types";
import { buildIndexes, descendantsOf, initialCollapsed, type GraphIndexes } from "@/lib/graph";
import type { Runbook } from "@/lib/telemetry-types";

export interface Series {
  cpu: number[];
  memory: number[];
  disk: number[];
}

export type InspectorTab = "overview" | "metrics" | "children" | "console";
export type DockTab = "events" | "runs";

const SERIES_LENGTH = 30;
const DEFAULT_EXPAND_DEPTH = 6;

interface OpsState extends GraphIndexes {
  phase: "idle" | "loading" | "ready" | "error";
  error: string | null;
  metrics: Record<string, MetricSnapshot>;
  series: Record<string, Series>;
  events: EventItem[];
  runs: CommandRun[];
  runbooks: Runbook[];
  list: TopologyNode[];

  collapsed: Record<string, boolean>;
  overrides: Record<string, { x: number; y: number }>;
  expandDepth: number;
  showResourceNodes: boolean;
  direction: "DOWN" | "RIGHT";
  spacing: number;
  layerSpacing: number;

  selectedId: string | null;
  hoveredId: string | null;
  query: string;
  statusFilter: NodeStatus[];
  inspectorTab: InspectorTab;
  dockTab: DockTab;
  dockOpen: boolean;

  zoom: number;
  pan: { x: number; y: number };
  fitToken: number;
  focusRequest: { id: string; token: number } | null;

  live: boolean;
  streamState: "idle" | "connecting" | "open" | "closed";
  lastTickAt: string | null;
  ticks: number;
  generatedAt: string | null;

  hydrate: (payload: TopologyPayload) => void;
  bootstrap: () => Promise<void>;
  setLive: (live: boolean) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  toggleCollapse: (id: string) => void;
  expandToDepth: (depth: number) => void;
  expandBranch: (id: string) => void;
  collapseBranch: (id: string) => void;
  setOverride: (id: string, x: number, y: number) => void;
  persistOverride: (id: string) => void;
  resetLayout: () => void;
  setQuery: (query: string) => void;
  toggleStatusFilter: (status: NodeStatus) => void;
  setShowResourceNodes: (value: boolean) => void;
  setDirection: (direction: "DOWN" | "RIGHT") => void;
  setSpacing: (spacing: number, layerSpacing: number) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  setDockTab: (tab: DockTab) => void;
  toggleDock: () => void;
  setView: (zoom: number, pan: { x: number; y: number }) => void;
  requestFit: () => void;
  requestFocus: (id: string) => void;
  ackEvent: (id: number) => void;
  ackAllEvents: () => void;
  executeRunbook: (nodeId: string, runbookId: string) => Promise<void>;
  setNodeStatus: (nodeId: string, status: NodeStatus) => void;
  reseed: () => Promise<void>;
}

let stream: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function applyIndexes(list: TopologyNode[]): GraphIndexes {
  return buildIndexes(list);
}

async function loadRunbooks(set: SetState) {
  try {
    const response = await fetch("/api/cli/execute", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { runbooks: Runbook[] };
    if (payload.runbooks) set({ runbooks: payload.runbooks });
  } catch {
    /* runbooks are optional */
  }
}

export const useOps = create<OpsState>((set, get) => ({
  phase: "idle",
  error: null,
  nodesById: {},
  childrenOf: {},
  rootIds: [],
  depthOf: {},
  descendantCount: {},
  leafCount: {},
  list: [],
  metrics: {},
  series: {},
  events: [],
  runs: [],
  runbooks: [],
  collapsed: {},
  overrides: {},
  expandDepth: DEFAULT_EXPAND_DEPTH,
  showResourceNodes: false,
  direction: "DOWN",
  spacing: 18,
  layerSpacing: 26,
  selectedId: null,
  hoveredId: null,
  query: "",
  statusFilter: [],
  inspectorTab: "overview",
  dockTab: "events",
  dockOpen: true,
  zoom: 1,
  pan: { x: 0, y: 0 },
  fitToken: 0,
  focusRequest: null,
  live: true,
  streamState: "idle",
  lastTickAt: null,
  ticks: 0,
  generatedAt: null,

  hydrate: (payload) => {
    const indexes = applyIndexes(payload.nodes);
    const collapsed = initialCollapsed(indexes.nodesById, indexes.depthOf, DEFAULT_EXPAND_DEPTH);
    const overrides: Record<string, { x: number; y: number }> = {};
    for (const node of payload.nodes) {
      if (node.collapsed) collapsed[node.id] = true;
      if (node.x !== null && node.y !== null) overrides[node.id] = { x: node.x, y: node.y };
    }
    set({
      phase: "ready",
      error: null,
      list: payload.nodes,
      ...indexes,
      metrics: payload.metrics,
      series: payload.series,
      events: payload.events,
      runs: payload.runs,
      collapsed,
      overrides,
      generatedAt: payload.generatedAt,
      selectedId: get().selectedId ?? indexes.rootIds[0] ?? null,
      fitToken: get().fitToken + 1,
    });
    void loadRunbooks(set);
    connectStream(set, get);
  },

  bootstrap: async () => {
    if (get().phase === "loading" || get().phase === "ready") return;
    set({ phase: "loading", error: null });
    try {
      const response = await fetch("/api/topology", { cache: "no-store" });
      if (!response.ok) throw new Error(`topology request failed (${response.status})`);
      const payload = (await response.json()) as TopologyPayload;
      get().hydrate(payload);
    } catch (error) {
      set({ phase: "error", error: error instanceof Error ? error.message : "unknown error" });
    }
  },

  setLive: (live) => {
    set({ live });
    if (live) {
      connectStream(set, get);
    } else if (stream) {
      stream.close();
      stream = null;
      set({ streamState: "closed" });
    }
  },

  select: (id) => set({ selectedId: id, inspectorTab: get().selectedId === id ? get().inspectorTab : "overview" }),
  hover: (id) => set({ hoveredId: id }),

  toggleCollapse: (id) => {
    const next = !get().collapsed[id];
    set({ collapsed: { ...get().collapsed, [id]: next } });
    void fetch(`/api/nodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collapsed: next }),
    }).catch(() => undefined);
  },

  expandToDepth: (depth) => {
    const { nodesById, depthOf } = get();
    set({ collapsed: initialCollapsed(nodesById, depthOf, depth), expandDepth: depth, fitToken: get().fitToken + 1 });
  },

  expandBranch: (id) => {
    const collapsed = { ...get().collapsed };
    for (const target of [id, ...descendantsOf(id, get().childrenOf)]) collapsed[target] = false;
    set({ collapsed, fitToken: get().fitToken + 1 });
  },

  collapseBranch: (id) => {
    const collapsed = { ...get().collapsed };
    for (const child of descendantsOf(id, get().childrenOf)) collapsed[child] = true;
    set({ collapsed, fitToken: get().fitToken + 1 });
  },

  setOverride: (id, x, y) => set({ overrides: { ...get().overrides, [id]: { x, y } } }),

  persistOverride: (id) => {
    const override = get().overrides[id];
    if (!override) return;
    void fetch(`/api/nodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: override.x, y: override.y }),
    }).catch(() => undefined);
  },

  resetLayout: () => set({ overrides: {}, fitToken: get().fitToken + 1 }),

  setQuery: (query) => set({ query }),

  toggleStatusFilter: (status) => {
    const current = get().statusFilter;
    set({ statusFilter: current.includes(status) ? current.filter((s) => s !== status) : [...current, status] });
  },

  setShowResourceNodes: (value) => set({ showResourceNodes: value }),
  setDirection: (direction) => set({ direction, fitToken: get().fitToken + 1 }),
  setSpacing: (spacing, layerSpacing) => set({ spacing, layerSpacing, fitToken: get().fitToken + 1 }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setDockTab: (tab) => set({ dockTab: tab }),
  toggleDock: () => set({ dockOpen: !get().dockOpen }),
  setView: (zoom, pan) => set({ zoom, pan }),
  requestFit: () => set({ fitToken: get().fitToken + 1 }),

  /** Select + centre a node, revealing it first if an ancestor sub-flow is collapsed. */
  requestFocus: (id) => {
    const { nodesById, collapsed } = get();
    const next = { ...collapsed };
    let changed = false;
    let cursor = nodesById[id]?.parentId ?? null;
    while (cursor) {
      if (next[cursor]) {
        next[cursor] = false;
        changed = true;
      }
      cursor = nodesById[cursor]?.parentId ?? null;
    }
    set({
      collapsed: changed ? next : collapsed,
      selectedId: id,
      inspectorTab: "overview",
      focusRequest: { id, token: Date.now() },
    });
  },

  ackEvent: (id) => {
    set({ events: get().events.map((event) => (event.id === id ? { ...event, acknowledged: true } : event)) });
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  },

  ackAllEvents: () => {
    set({ events: get().events.map((event) => ({ ...event, acknowledged: true })) });
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => undefined);
  },

  executeRunbook: async (nodeId, runbookId) => {
    set({ dockTab: "runs", dockOpen: true, inspectorTab: "console" });
    try {
      const response = await fetch("/api/cli/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, runbookId }),
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { run: CommandRun };
      set({ runs: [payload.run, ...get().runs.filter((r) => r.id !== payload.run.id)].slice(0, 40) });
    } catch {
      /* surfaced through the stream */
    }
  },

  setNodeStatus: (nodeId, status) => {
    const node = get().nodesById[nodeId];
    if (!node) return;
    const updated = { ...node, status };
    set({
      nodesById: { ...get().nodesById, [nodeId]: updated },
      list: get().list.map((n) => (n.id === nodeId ? updated : n)),
    });
    void fetch(`/api/nodes/${encodeURIComponent(nodeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => undefined);
  },

  reseed: async () => {
    set({ phase: "loading", selectedId: null, overrides: {} });
    await fetch("/api/admin/reseed", { method: "POST" }).catch(() => undefined);
    const response = await fetch("/api/topology", { cache: "no-store" });
    if (!response.ok) {
      set({ phase: "error", error: `reseed failed (${response.status})` });
      return;
    }
    const payload = (await response.json()) as TopologyPayload;
    get().hydrate(payload);
  },
}));

type SetState = (partial: Partial<OpsState> | ((state: OpsState) => Partial<OpsState>)) => void;
type GetState = () => OpsState;

interface StreamMetricsMessage {
  type: "metrics";
  at: string;
  updates: (MetricSnapshot & { nodeId: string; status?: NodeStatus })[];
}
interface StreamEventMessage {
  type: "event";
  event: EventItem;
}
interface StreamCliMessage {
  type: "cli";
  run: CommandRun;
}
interface StreamHelloMessage {
  type: "hello";
  at: string;
  tick: number;
  nodeCount: number;
}

function pushSeries(series: Series, metric: MetricSnapshot): Series {
  return {
    cpu: [...series.cpu, metric.cpu].slice(-SERIES_LENGTH),
    memory: [...series.memory, metric.memory].slice(-SERIES_LENGTH),
    disk: [...series.disk, metric.disk].slice(-SERIES_LENGTH),
  };
}

function connectStream(set: SetState, get: GetState) {
  if (typeof window === "undefined") return;
  if (stream) return;
  if (!get().live) return;
  set({ streamState: "connecting" });
  const source = new EventSource("/api/stream");
  stream = source;

  source.onopen = () => set({ streamState: "open" });

  source.onmessage = (raw) => {
    if (!raw.data) return;
    let message: StreamMetricsMessage | StreamEventMessage | StreamCliMessage | StreamHelloMessage;
    try {
      message = JSON.parse(raw.data) as typeof message;
    } catch {
      return;
    }

    if (message.type === "metrics") {
      const state = get();
      const metrics: Record<string, MetricSnapshot> = { ...state.metrics };
      const series: Record<string, Series> = { ...state.series };
      const nodesById = { ...state.nodesById };
      let statusChanged = false;

      for (const update of message.updates) {
        const { nodeId, status, ...snapshot } = update;
        const previous = metrics[nodeId];
        metrics[nodeId] = snapshot;
        if (previous) {
          series[nodeId] = pushSeries(series[nodeId] ?? { cpu: [], memory: [], disk: [] }, snapshot);
        } else {
          series[nodeId] = { cpu: [snapshot.cpu], memory: [snapshot.memory], disk: [snapshot.disk] };
        }
        if (status && nodesById[nodeId] && nodesById[nodeId].status !== status) {
          nodesById[nodeId] = { ...nodesById[nodeId], status };
          statusChanged = true;
        }
      }

      set({
        metrics,
        series,
        nodesById: statusChanged ? nodesById : state.nodesById,
        list: statusChanged ? state.list.map((n) => (nodesById[n.id] ? nodesById[n.id] : n)) : state.list,
        lastTickAt: message.at,
        ticks: state.ticks + 1,
      });
      return;
    }

    if (message.type === "event") {
      set({ events: [message.event, ...get().events].slice(0, 120) });
      return;
    }

    if (message.type === "cli") {
      const runs = get().runs.filter((run) => run.id !== message.run.id);
      set({ runs: [message.run, ...runs].slice(0, 40) });
      return;
    }
  };

  source.onerror = () => {
    set({ streamState: "closed" });
    source.close();
    stream = null;
    if (!get().live) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectStream(set, get);
    }, 3000);
  };
}
