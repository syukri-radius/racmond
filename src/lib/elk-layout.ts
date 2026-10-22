import type { ElkNode } from "elkjs/lib/elk.bundled.js";
import {
  COLLAPSED_SIZE,
  GROUP_PADDING,
  GROUP_TYPES,
  HEADER_HEIGHT,
  LEAF_SIZE,
  MIN_GROUP_SIZE,
  type NodeType,
  type TopologyNode,
} from "@/lib/types";

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** height of the fixed header strip; children are laid out below it */
  header: number;
  isGroup: boolean;
}

export interface LayoutResult {
  boxes: Record<string, LayoutBox>;
  /** absolute canvas coordinates, used for focus / fit-view */
  abs: Record<string, { x: number; y: number; width: number; height: number }>;
  width: number;
  height: number;
  visibleCount: number;
  elapsedMs: number;
}

export interface LayoutInput {
  nodes: Record<string, TopologyNode>;
  childrenOf: Record<string, string[]>;
  rootIds: string[];
  collapsed: Record<string, boolean>;
  showResourceNodes: boolean;
  direction: "DOWN" | "RIGHT";
  spacing: number;
  layerSpacing: number;
}

interface BuildNode {
  id: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  layoutOptions?: Record<string, string>;
  children?: BuildNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
  header?: number;
}

type ElkCtor = typeof import("elkjs/lib/elk.bundled.js").default;
let elkPromise: Promise<InstanceType<ElkCtor>> | null = null;

async function getElk(): Promise<InstanceType<ElkCtor>> {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then((mod) => {
      const Ctor = (mod.default ?? (mod as unknown as ElkCtor)) as ElkCtor;
      return new Ctor();
    });
  }
  return elkPromise;
}

export function headerHeight(type: NodeType): number {
  return HEADER_HEIGHT[type] ?? 46;
}

export function leafSize(type: NodeType) {
  return LEAF_SIZE[type] ?? { width: 224, height: 72 };
}

export function collapsedSize(type: NodeType) {
  return COLLAPSED_SIZE[type] ?? COLLAPSED_SIZE.default;
}

/** Children that are actually rendered inside a container node (honours collapse + toggles). */
export function visibleChildren(
  id: string,
  input: Pick<LayoutInput, "childrenOf" | "nodes" | "collapsed" | "showResourceNodes">,
): string[] {
  if (input.collapsed[id]) return [];
  const kids = input.childrenOf[id] ?? [];
  if (input.showResourceNodes) return kids;
  return kids.filter((kid) => input.nodes[kid]?.type !== "resource");
}

interface ElkOptions {
  direction: "DOWN" | "RIGHT";
  spacing: number;
  layerSpacing: number;
}

function baseOptions({ direction, spacing, layerSpacing }: ElkOptions): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": direction,
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.spacing.nodeNode": String(spacing),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(layerSpacing),
    "elk.layered.nodePlacement.strategy": "SIMPLE",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.compaction.postCompaction.strategy": "NODE_SIZE",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.separateConnectedComponents": "TRUE",
  };
}

function buildElkNode(id: string, input: LayoutInput, options: ElkOptions): BuildNode {
  const node = input.nodes[id];
  const type = node?.type ?? "service";
  const kids = visibleChildren(id, input);
  const isGroup = GROUP_TYPES.has(type);

  if (kids.length === 0) {
    const size = isGroup ? collapsedSize(type) : leafSize(type);
    return { id, width: size.width, height: size.height, header: isGroup ? headerHeight(type) : 0 };
  }

  const header = headerHeight(type);
  const min = MIN_GROUP_SIZE[type] ?? { width: 240, height: 100 };
  const layoutOptions = baseOptions(options);
  layoutOptions["elk.padding"] = `[top=${header},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`;

  return {
    id,
    layoutOptions,
    minWidth: min.width,
    minHeight: min.height,
    header,
    children: kids.map((kid) => buildElkNode(kid, input, options)),
    edges: kids.map((kid) => ({ id: `${id}->${kid}`, sources: [id], targets: [kid] })),
  };
}

/**
 * Runs the ELK layered algorithm over the compound graph. Every container node
 * becomes an ELK parent whose `elk.padding` reserves room for its header, so
 * children come back positioned relative to the parent (extent: 'parent').
 */
export async function computeLayout(input: LayoutInput): Promise<LayoutResult> {
  const started = performance.now();
  const elk = await getElk();
  const options: ElkOptions = {
    direction: input.direction,
    spacing: input.spacing,
    layerSpacing: input.layerSpacing,
  };

  const graph: BuildNode = {
    id: "__root__",
    layoutOptions: { ...baseOptions(options), "elk.padding": "[top=0,left=0,bottom=0,right=0]" },
    header: 0,
    children: input.rootIds.map((id) => buildElkNode(id, input, options)),
  };

  const result = (await elk.layout(graph as unknown as ElkNode)) as ElkNode & {
    children?: (ElkNode & { header?: number })[];
  };

  const headers = new Map<string, number>();
  const collectHeaders = (node: BuildNode) => {
    headers.set(node.id, node.header ?? 0);
    node.children?.forEach(collectHeaders);
  };
  collectHeaders(graph);

  const boxes: Record<string, LayoutBox> = {};
  const abs: Record<string, { x: number; y: number; width: number; height: number }> = {};
  let visibleCount = 0;

  const walk = (node: ElkNode & { header?: number }, offsetX: number, offsetY: number) => {
    if (node.id !== "__root__") {
      const type = input.nodes[node.id]?.type ?? "service";
      const isGroup = GROUP_TYPES.has(type) && visibleChildren(node.id, input).length > 0;
      boxes[node.id] = {
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? 0,
        height: node.height ?? 0,
        header: headers.get(node.id) ?? 0,
        isGroup,
      };
      abs[node.id] = {
        x: offsetX + (node.x ?? 0),
        y: offsetY + (node.y ?? 0),
        width: node.width ?? 0,
        height: node.height ?? 0,
      };
      visibleCount += 1;
    }
    const baseX = node.id === "__root__" ? 0 : offsetX + (node.x ?? 0);
    const baseY = node.id === "__root__" ? 0 : offsetY + (node.y ?? 0);
    node.children?.forEach((child) => walk(child as ElkNode & { header?: number }, baseX, baseY));
  };

  walk(result, 0, 0);

  return {
    boxes,
    abs,
    width: Math.max(result.width ?? 0, 1),
    height: Math.max(result.height ?? 0, 1),
    visibleCount,
    elapsedMs: Math.round(performance.now() - started),
  };
}
