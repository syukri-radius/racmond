export interface HierarchyNode {
  id: string;
  parentId: string | null;
}

export interface Position {
  x: number;
  y: number;
}

export const TREE_GEOMETRY = { xGap: 340, yGap: 132, nodeHeight: 96, startX: 0, startY: 0 };
export const LAYERED_GEOMETRY = { columnGap: 300, rowGap: 130, startX: 0, startY: 0 };

function childrenMap<T extends HierarchyNode>(nodes: T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    // a dangling parent (or a self-reference) is treated as a root so the graph
    // stays renderable when data is half-broken
    const parent = node.parentId && node.parentId !== node.id && ids.has(node.parentId) ? node.parentId : null;
    const bucket = map.get(parent) ?? [];
    bucket.push(node);
    map.set(parent, bucket);
  }
  return map;
}

/**
 * Vertical tidy tree: each subtree reserves a contiguous y band, children are
 * stacked under their parent and centred on it. Cycles are cut after one visit.
 */
export function layoutTree<T extends HierarchyNode>(
  nodes: T[],
  options: { xGap?: number; yGap?: number; nodeHeight?: number } = {},
): Map<string, Position> {
  const xGap = options.xGap ?? TREE_GEOMETRY.xGap;
  const yGap = options.yGap ?? TREE_GEOMETRY.yGap;
  const nodeHeight = options.nodeHeight ?? TREE_GEOMETRY.nodeHeight;
  const children = childrenMap(nodes);
  const positions = new Map<string, Position>();
  const visited = new Set<string>();
  let cursorY = 0;

  const place = (node: T, depth: number): { top: number; bottom: number } => {
    visited.add(node.id);
    const kids = (children.get(node.id) ?? []).filter((kid) => !visited.has(kid.id));
    if (!kids.length) {
      const y = cursorY;
      cursorY += yGap;
      positions.set(node.id, { x: depth * xGap, y });
      return { top: y, bottom: y + nodeHeight };
    }
    const bands = kids.map((kid) => place(kid, depth + 1));
    const top = bands[0].top;
    const bottom = bands[bands.length - 1].bottom;
    const y = (top + bottom) / 2 - nodeHeight / 2;
    positions.set(node.id, { x: depth * xGap, y });
    return { top: Math.min(top, y), bottom: Math.max(bottom, y + nodeHeight) };
  };

  for (const root of children.get(null) ?? []) {
    if (visited.has(root.id)) continue;
    place(root, 0);
    cursorY += 24; // breathing room between separate root trees
  }
  // anything still unvisited belongs to a cycle: park it in a fresh column band
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    positions.set(node.id, { x: 0, y: cursorY });
    cursorY += yGap;
    visited.add(node.id);
  }
  return positions;
}

/**
 * Layered (Sugiyama-lite) layout: rank nodes by longest path from a source,
 * then stack each rank vertically. Cycles fall back to insertion order.
 */
export function layoutLayered<T extends HierarchyNode>(
  nodes: T[],
  edges: { source: string; target: string }[],
  options: { columnGap?: number; rowGap?: number } = {},
): Map<string, Position> {
  const columnGap = options.columnGap ?? LAYERED_GEOMETRY.columnGap;
  const rowGap = options.rowGap ?? LAYERED_GEOMETRY.rowGap;
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }

  const rank = new Map<string, number>();
  const queue = nodes.filter((node) => !(incoming.get(node.id) ?? []).length).map((node) => node.id);
  for (const id of queue) rank.set(id, 0);
  let guard = 0;
  while (queue.length && guard < nodes.length * 12) {
    guard += 1;
    const id = queue.shift() as string;
    const current = rank.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      const candidate = current + 1;
      if (candidate > (rank.get(next) ?? -1) && candidate < nodes.length) {
        rank.set(next, candidate);
        queue.push(next);
      }
    }
  }
  for (const node of nodes) if (!rank.has(node.id)) rank.set(node.id, 0);

  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const column = rank.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node.id]);
  }

  const positions = new Map<string, Position>();
  for (const [column, list] of Array.from(columns.entries()).sort((a, b) => a[0] - b[0])) {
    list.forEach((id, index) => {
      positions.set(id, { x: column * columnGap, y: index * rowGap });
    });
  }
  return positions;
}

/** Parent chain visibility: a node shows when every ancestor is expanded. */
export function visibleIds<T extends HierarchyNode>(nodes: T[], expanded: Record<string, boolean>): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visible = new Set<string>();
  for (const node of nodes) {
    let current: T | undefined = node;
    let hops = 0;
    let ok = true;
    while (current && hops < 64) {
      hops += 1;
      const parentId: string | null = current.parentId;
      if (!parentId) break;
      const parent = byId.get(parentId);
      if (!parent) break;
      if (!expanded[parent.id]) {
        ok = false;
        break;
      }
      current = parent;
    }
    if (ok) visible.add(node.id);
  }
  return visible;
}

/** Direct child counts, used by the "+N" pill on a collapsed node. */
export function childCounts<T extends HierarchyNode>(nodes: T[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
  }
  return counts;
}

export function descendantCount<T extends HierarchyNode>(nodes: T[], id: string): number {
  const children = childrenMap(nodes);
  let total = 0;
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop() as string;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      total += 1;
      stack.push(child.id);
    }
  }
  return total;
}

export function defaultExpanded<T extends HierarchyNode>(nodes: T[], levels: number): Record<string, boolean> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const expanded: Record<string, boolean> = {};
  for (const node of nodes) {
    let depth = 0;
    let current = node;
    const seen = new Set<string>();
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id);
      depth += 1;
      current = byId.get(current.parentId) as T;
    }
    if (depth < levels) expanded[node.id] = true;
  }
  return expanded;
}
