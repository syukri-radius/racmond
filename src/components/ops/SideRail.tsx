"use client";

import { memo, useMemo } from "react";
import type { NodeStatus, TopologyNode } from "@/lib/types";
import { NODE_LABEL, STATUS_LABEL } from "@/lib/types";
import { ancestorsOf, matchesQuery, NODE_TYPE_ABBREV, STATUS_TONE } from "@/lib/graph";
import { useOps } from "@/store/ops";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ops/icons";
import { StatusDot } from "@/components/ops/primitives";

const TYPE_ICON: Record<string, IconName> = {
  organization: "org",
  sub_org: "division",
  project: "project",
  sub_project: "tree",
  datacenter: "datacenter",
  namespace: "namespace",
  server: "server",
  container: "container",
  pod: "pod",
  service_group: "group",
  service_sub_group: "group",
  service: "service",
  endpoint: "endpoint",
  resource: "cpu",
};

const FILTER_STATUSES: NodeStatus[] = ["critical", "degraded", "offline", "maintenance", "healthy"];

export const SideRail = memo(function SideRail() {
  const rootIds = useOps((s) => s.rootIds);
  const list = useOps((s) => s.list);
  const nodesById = useOps((s) => s.nodesById);
  const query = useOps((s) => s.query);
  const statusFilter = useOps((s) => s.statusFilter);
  const toggleStatusFilter = useOps((s) => s.toggleStatusFilter);
  const requestFocus = useOps((s) => s.requestFocus);

  const results = useMemo(() => {
    if (!query.trim()) return null;
    return list
      .filter((node) => node.type !== "resource" && matchesQuery(node, query))
      .filter((node) => (statusFilter.length === 0 ? true : statusFilter.includes(node.status)))
      .slice(0, 80);
  }, [query, list, statusFilter]);

  return (
    <aside className="glass-panel flex w-[272px] shrink-0 flex-col border-r border-line">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line-soft px-2.5">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
          <Icon name="tree" size={12} className="text-ice" />
          {results ? `${results.length} matches` : "hierarchy navigator"}
        </span>
        <span className="font-mono text-[9px] text-slate-600">{list.length} nodes</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin py-1">
        {results
          ? results.map((node) => (
              <SearchRow key={node.id} node={node} path={ancestorsOf(node.id, nodesById).map((n) => n.name)} />
            ))
          : rootIds.map((id) => <TreeRow key={id} id={id} depth={0} />)}
        {!results && rootIds.length === 0 ? (
          <p className="px-3 py-6 text-center font-mono text-[10px] text-slate-600">loading topology…</p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <p className="mb-1.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-slate-600">status filter (dims canvas)</p>
        <div className="flex flex-wrap gap-1">
          {FILTER_STATUSES.map((status) => {
            const active = statusFilter.includes(status);
            const tone = STATUS_TONE[status];
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatusFilter(status)}
                className={cn(
                  "flex items-center gap-1 rounded border px-1.5 py-[2px] font-mono text-[8.5px] uppercase tracking-[0.1em] transition",
                  active ? cn("border-current", tone.text) : "border-line text-slate-600 hover:text-slate-400",
                )}
              >
                <StatusDot status={status} size={5} pulse={false} />
                {STATUS_LABEL[status]}
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-[3px] border-t border-line-soft pt-2">
          {(Object.keys(NODE_LABEL) as (keyof typeof NODE_LABEL)[]).map((type) => (
            <span key={type} className="flex items-center gap-1 font-mono text-[8px] uppercase tracking-[0.08em] text-slate-600">
              <Icon name={TYPE_ICON[type]} size={9} className="text-slate-500" />
              {NODE_TYPE_ABBREV[type]} · {NODE_LABEL[type]}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
});

const SearchRow = memo(function SearchRow({ node, path }: { node: TopologyNode; path: string[] }) {
  const requestFocus = useOps((s) => s.requestFocus);
  const metric = useOps((s) => s.metrics[node.id]);
  return (
    <button
      type="button"
      onClick={() => requestFocus(node.id)}
      className="flex w-full flex-col items-start gap-[1px] border-b border-line-soft/60 px-2.5 py-1.5 text-left transition hover:bg-slate-100/[0.04]"
    >
      <span className="flex w-full items-center gap-1.5">
        <Icon name={TYPE_ICON[node.type]} size={11} className="text-slate-500" />
        <span className="truncate text-[11px] text-slate-200">{node.name}</span>
        <StatusDot status={node.status} size={6} />
        {metric ? <span className="tabular ml-auto font-mono text-[9px] text-slate-500">{metric.cpu.toFixed(0)}%</span> : null}
      </span>
      <span className="truncate font-mono text-[8px] uppercase tracking-[0.1em] text-slate-600">
        {NODE_TYPE_ABBREV[node.type]} · {path.slice(-3).join(" / ")}
      </span>
    </button>
  );
});

const TreeRow = memo(function TreeRow({ id, depth }: { id: string; depth: number }) {
  const node = useOps((s) => s.nodesById[id]);
  const childrenOf = useOps((s) => s.childrenOf);
  const nodesById = useOps((s) => s.nodesById);
  const isCollapsed = useOps((s) => Boolean(s.collapsed[id]));
  const showResourceNodes = useOps((s) => s.showResourceNodes);
  const selectedId = useOps((s) => s.selectedId);
  const toggleCollapse = useOps((s) => s.toggleCollapse);
  const requestFocus = useOps((s) => s.requestFocus);
  const metric = useOps((s) => s.metrics[id]);

  const children = useMemo(() => {
    if (isCollapsed) return [] as string[];
    const kids = childrenOf[id] ?? [];
    return showResourceNodes ? kids : kids.filter((kid) => nodesById[kid]?.type !== "resource");
  }, [childrenOf, nodesById, id, isCollapsed, showResourceNodes]);

  if (!node) return null;
  const hasChildren = (childrenOf[id]?.length ?? 0) > 0;
  const selected = selectedId === id;
  const tone = STATUS_TONE[node.status];

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-1 border-l-2 py-[3px] pr-1.5 transition",
          selected ? "border-ice bg-ice/[0.07]" : "border-transparent hover:bg-ink-850",
        )}
        style={{ paddingLeft: 6 + depth * 10 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && toggleCollapse(id)}
          className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center text-slate-600", hasChildren && "hover:text-ice")}
          title={hasChildren ? (isCollapsed ? "Expand sub-flow" : "Collapse sub-flow") : "leaf node"}
        >
          {hasChildren ? (
            <Icon name="chevron" size={9} className={cn("transition-transform", !isCollapsed && "rotate-90")} />
          ) : (
            <span className="h-[3px] w-[3px] rounded-full bg-slate-700" />
          )}
        </button>
        <button
          type="button"
          onClick={() => requestFocus(id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={`${NODE_LABEL[node.type]} · ${node.name}`}
        >
          <Icon name={TYPE_ICON[node.type]} size={11} className="shrink-0 text-slate-500" />
          <span className={cn("truncate text-[10.5px]", selected ? "text-slate-100" : "text-slate-300")}>{node.name}</span>
          <span className={cn("ml-auto shrink-0 h-1.5 w-1.5 rounded-full", tone.dot)} />
          <span className="tabular w-8 shrink-0 text-right font-mono text-[8.5px] text-slate-600">
            {metric ? `${metric.cpu.toFixed(0)}%` : ""}
          </span>
        </button>
      </div>
      {children.map((childId) => (
        <TreeRow key={childId} id={childId} depth={depth + 1} />
      ))}
    </>
  );
});
