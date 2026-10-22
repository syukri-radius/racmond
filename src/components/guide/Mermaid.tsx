"use client";

import { useEffect, useId, useState } from "react";

let initialized = false;

async function ensureInit() {
  const mermaid = (await import("mermaid")).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      themeVariables: {
        darkMode: true,
        background: "#0a101b",
        primaryColor: "#0f1725",
        primaryTextColor: "#dbe4f0",
        primaryBorderColor: "#7dd3fc",
        lineColor: "#38bdf8",
        secondaryColor: "#14202f",
        tertiaryColor: "#1b2939",
        fontFamily: "ui-monospace, JetBrains Mono, Menlo, monospace",
      },
      flowchart: { curve: "basis", padding: 12, nodeSpacing: 28, rankSpacing: 42 },
      sequence: { mirrorActors: false, showSequenceNumbers: false },
    });
    initialized = true;
  }
  return mermaid;
}

export function Mermaid({ chart, title }: { chart: string; title?: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    ensureInit()
      .then((mermaid) => mermaid.render(`mmd-${reactId}`, chart))
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "mermaid render failed");
      });
    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  return (
    <figure className="overflow-hidden rounded-lg border border-line bg-ink-900/70">
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
            <span className="relative h-[3px] w-32 overflow-hidden rounded-full bg-ink-800 sweep" />
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
