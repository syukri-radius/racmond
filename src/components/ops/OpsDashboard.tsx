"use client";

import { useEffect } from "react";
import type { TopologyPayload } from "@/lib/types";
import { useOps } from "@/store/ops";
import { Canvas } from "@/components/ops/Canvas";
import { EventDock } from "@/components/ops/EventDock";
import { Inspector } from "@/components/ops/Inspector";
import { SideRail } from "@/components/ops/SideRail";
import { TopBar } from "@/components/ops/TopBar";

export function OpsDashboard({ initial }: { initial?: TopologyPayload | null }) {
  const hydrate = useOps((s) => s.hydrate);
  const bootstrap = useOps((s) => s.bootstrap);
  const phase = useOps((s) => s.phase);
  const error = useOps((s) => s.error);

  useEffect(() => {
    if (initial) hydrate(initial);
    else void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useOps.getState().select(null);
      if (event.key === "f" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        useOps.getState().requestFit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-ink-950">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <SideRail />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Canvas />
            {phase === "error" ? (
              <div className="absolute inset-x-0 top-3 z-20 mx-auto w-fit rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 font-mono text-[10px] text-rose-200">
                {error ?? "topology unavailable"} — retry with the reseed control
              </div>
            ) : null}
          </div>
          <EventDock />
        </main>
        <Inspector />
      </div>
    </div>
  );
}
