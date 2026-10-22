"use client";

import { Chip, SeverityChip } from "@/components/ui/primitives";
import type { Finding } from "@/lib/config/types";

export function FindingList({ findings, onSelect }: { findings: Finding[]; onSelect?: (target: string) => void }) {
  if (!findings.length) return <p className="py-2 text-[11.5px] text-slate-500">No findings — the checks all passed.</p>;
  return (
    <div className="flex flex-col gap-1">
      {findings.map((finding) => (
        <button
          key={finding.id}
          type="button"
          onClick={() => finding.target && onSelect?.(finding.target)}
          className="flex flex-col gap-0.5 rounded border border-line/60 px-2 py-1 text-left hover:border-ice/40"
        >
          <div className="flex items-center gap-1.5">
            <SeverityChip severity={finding.severity} />
            <Chip tone="muted">{finding.code}</Chip>
            {finding.target ? <span className="ml-auto truncate font-mono text-[8.5px] text-slate-500">{finding.target}</span> : null}
          </div>
          <p className="text-[10.5px] leading-snug text-slate-300">{finding.message}</p>
        </button>
      ))}
    </div>
  );
}
