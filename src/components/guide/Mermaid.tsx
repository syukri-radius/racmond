"use client";

import { useEffect, useId, useState } from "react";
import type { Theme } from "@/lib/theme";
import { useTheme } from "@/store/theme";

const PALETTE: Record<Theme, Record<string, string | boolean>> = {
  dark: {
    darkMode: true,
    background: "#0d0819",
    primaryColor: "#1b1236",
    primaryTextColor: "#ece4fb",
    primaryBorderColor: "#a78bfa",
    secondaryColor: "#221745",
    secondaryTextColor: "#e2d8f8",
    secondaryBorderColor: "#8b5cf6",
    tertiaryColor: "#150d28",
    tertiaryTextColor: "#c8b9e3",
    tertiaryBorderColor: "#7c3aed",
    lineColor: "#8b7ec8",
    textColor: "#c8b9e3",
    titleColor: "#f2ecfd",
    edgeLabelBackground: "#130c24",
    clusterBkg: "#140c25",
    clusterBorder: "#4c3d66",
    actorBkg: "#1b1236",
    actorBorder: "#8b5cf6",
    actorTextColor: "#ece4fb",
    actorLineColor: "#4c3d66",
    signalColor: "#c8b9e3",
    signalTextColor: "#ded3f2",
    labelBoxBkgColor: "#221745",
    labelBoxBorderColor: "#8b5cf6",
    labelTextColor: "#ece4fb",
    noteBkgColor: "#2a1b3f",
    noteTextColor: "#ece4fb",
    noteBorderColor: "#8b5cf6",
    activationBkgColor: "#3a2a5c",
    activationBorderColor: "#8b5cf6",
  },
  light: {
    darkMode: false,
    background: "#fdfbff",
    primaryColor: "#f1e9ff",
    primaryTextColor: "#241536",
    primaryBorderColor: "#7c3aed",
    secondaryColor: "#ece2fd",
    secondaryTextColor: "#33204a",
    secondaryBorderColor: "#8b5cf6",
    tertiaryColor: "#f7f3ff",
    tertiaryTextColor: "#40304f",
    tertiaryBorderColor: "#a78bfa",
    lineColor: "#7c5bb8",
    textColor: "#33204a",
    titleColor: "#1a1029",
    edgeLabelBackground: "#fdfbff",
    clusterBkg: "#f4ecff",
    clusterBorder: "#c9b6ea",
    actorBkg: "#f1e9ff",
    actorBorder: "#7c3aed",
    actorTextColor: "#241536",
    actorLineColor: "#c9b6ea",
    signalColor: "#40304f",
    signalTextColor: "#33204a",
    labelBoxBkgColor: "#ece2fd",
    labelBoxBorderColor: "#8b5cf6",
    labelTextColor: "#241536",
    noteBkgColor: "#ece2fd",
    noteTextColor: "#241536",
    noteBorderColor: "#a78bfa",
    activationBkgColor: "#e0d1fb",
    activationBorderColor: "#7c3aed",
  },
};

export function Mermaid({ chart, title }: { chart: string; title?: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const storeTheme = useTheme((s) => s.theme);
  const hydrate = useTheme((s) => s.hydrate);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSvg("");

    // read the attribute written before paint so the first render already
    // matches the active theme (the store value catches later toggles)
    const theme: Theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";

    import("mermaid")
      .then((module) => {
        const mermaid = module.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: PALETTE[theme],
          flowchart: { curve: "basis", padding: 12, nodeSpacing: 28, rankSpacing: 42 },
          sequence: { mirrorActors: false, showSequenceNumbers: false },
        });
        return mermaid.render(`mmd-${reactId}-${theme}`, chart);
      })
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "mermaid render failed");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, reactId, storeTheme]);

  return (
    <figure className="glass-card overflow-hidden rounded-xl border border-line">
      {title ? (
        <figcaption className="border-b border-line-soft px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
          {title}
        </figcaption>
      ) : null}
      <div className="overflow-x-auto p-3">
        {error ? (
          <div>
            <p className="font-mono text-[11px] text-rose-300">diagram failed: {error}</p>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] text-slate-500">{chart}</pre>
          </div>
        ) : svg ? (
          <div
            className="mermaid-svg mx-auto min-w-[520px] max-w-full [&_svg]:mx-auto [&_svg]:max-w-full [&_svg]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="flex h-28 items-center justify-center">
            <span className="relative h-[3px] w-32 overflow-hidden rounded-full bg-[var(--gauge-track)] sweep" />
          </div>
        )}
      </div>
      <details className="border-t border-line-soft">
        <summary className="cursor-pointer px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600 hover:text-slate-300">
          view mermaid source
        </summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-line-soft bg-ink-950/70 p-3 font-mono text-[10.5px] leading-relaxed text-slate-400">
          {chart}
        </pre>
      </details>
    </figure>
  );
}
