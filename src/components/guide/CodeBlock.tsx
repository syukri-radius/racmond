"use client";

import { useState } from "react";

export function CodeBlock({
  title,
  language,
  code,
}: {
  title?: string;
  language?: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#05080f]">
      <div className="flex items-center gap-2 border-b border-line-soft px-3 py-1.5">
        <span className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-rose-500/70" />
          <span className="h-2 w-2 rounded-full bg-amber-400/70" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">
          {title ?? language ?? "code"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {language ? (
            <span className="rounded border border-line px-1.5 py-[1px] font-mono text-[8.5px] uppercase tracking-[0.12em] text-slate-500">
              {language}
            </span>
          ) : null}
          <button
            type="button"
            onClick={copy}
            className="rounded border border-line px-1.5 py-[2px] font-mono text-[9px] uppercase tracking-[0.12em] text-slate-400 transition hover:border-ice/50 hover:text-ice"
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        </span>
      </div>
      <pre className="max-h-[480px] overflow-auto whitespace-pre p-3 font-mono text-[11px] leading-relaxed text-slate-300">
        {code}
      </pre>
    </div>
  );
}
