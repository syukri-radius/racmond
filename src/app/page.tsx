import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { getTopologyPayload } from "@/lib/topology-service";
import type { TopologyPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Server component performs the initial fetch of the full hierarchy so the
  // first paint already contains the topology; the client then attaches to the
  // live stream for metric updates.
  let payload: TopologyPayload | null = null;
  let failure: string | null = null;
  try {
    payload = await getTopologyPayload(12);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    console.error("[ops] initial topology fetch failed", error);
  }

  if (!payload) {
    // The HELIOS dashboard is backed by its Postgres database. When that
    // database is not reachable we say so instead of spinning on an empty
    // canvas, and point at the console, which runs on its own SQLite store.
    return (
      <main className="flex h-full items-center justify-center p-6">
        <section className="glass-panel w-full max-w-xl rounded-xl border p-6">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-slate-500">helios · ops</p>
          <h1 className="mt-1 text-[18px] font-semibold text-slate-100">Topology store unavailable</h1>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
            This dashboard reads its hierarchy from Postgres. The connection failed, so the canvas would stay empty:
          </p>
          <pre className="scroll-thin mt-2 max-h-32 overflow-auto rounded border border-line bg-ink-900/60 p-2 font-mono text-[10px] leading-relaxed text-rose-300">
            {failure ?? "unknown error"}
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="/dockflow"
              className="inline-flex h-7 items-center rounded-md border border-ice/55 bg-ice/15 px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-ice hover:bg-ice/25"
            >
              open dockflow console →
            </a>
            <a
              href="/guide"
              className="inline-flex h-7 items-center rounded-md border border-line px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-300 hover:border-ice/45 hover:text-ice"
            >
              read the guide
            </a>
          </div>
          <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-slate-500">
            the dockflow console needs no postgres — it stores everything in libsql/sqlite
          </p>
        </section>
      </main>
    );
  }

  return <OpsDashboard initial={payload} />;
}
