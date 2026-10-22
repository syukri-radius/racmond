"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeLayout, type LayoutResult } from "@/lib/elk-layout";
import { useOps } from "@/store/ops";

/**
 * Runs the ELK compound layout whenever the *structure* changes
 * (collapse state, toggles, direction, spacing) — never on metric ticks.
 */
export function useTopologyLayout() {
  const nodesById = useOps((s) => s.nodesById);
  const childrenOf = useOps((s) => s.childrenOf);
  const rootIds = useOps((s) => s.rootIds);
  const collapsed = useOps((s) => s.collapsed);
  const showResourceNodes = useOps((s) => s.showResourceNodes);
  const direction = useOps((s) => s.direction);
  const spacing = useOps((s) => s.spacing);
  const layerSpacing = useOps((s) => s.layerSpacing);

  const [layout, setLayout] = useState<LayoutResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodesRef = useRef(nodesById);
  nodesRef.current = nodesById;
  const runId = useRef(0);

  const signature = useMemo(() => {
    const ids = Object.keys(nodesById);
    let hash = 0;
    for (const id of ids) {
      const node = nodesById[id];
      const value = `${id}:${node.parentId ?? "-"}:${node.type}:${node.sortOrder}`;
      for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    return `${ids.length}:${hash}`;
  }, [nodesById]);

  const collapseSignature = useMemo(() => {
    const entries = Object.entries(collapsed).filter(([, value]) => value);
    return `${entries.length}:${entries.map(([key]) => key).join(",")}`;
  }, [collapsed]);

  useEffect(() => {
    if (rootIds.length === 0) return;
    const current = ++runId.current;
    let cancelled = false;
    setComputing(true);
    computeLayout({
      nodes: nodesRef.current,
      childrenOf,
      rootIds,
      collapsed,
      showResourceNodes,
      direction,
      spacing,
      layerSpacing,
    })
      .then((result) => {
        if (cancelled || current !== runId.current) return;
        setLayout(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || current !== runId.current) return;
        setError(err instanceof Error ? err.message : "layout failed");
      })
      .finally(() => {
        if (!cancelled && current === runId.current) setComputing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, collapseSignature, childrenOf, rootIds, showResourceNodes, direction, spacing, layerSpacing]);

  return { layout, computing, error };
}
