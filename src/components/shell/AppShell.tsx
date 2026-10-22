"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, Logo, type IconName } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { getJson } from "@/lib/client";
import type { EngineStatus } from "@/lib/docker/types";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  hint: string;
}

const NAV: NavItem[] = [
  { href: "/dockflow", label: "Overview", icon: "home", hint: "engine · projects · recent runs" },
  { href: "/dockflow/containers", label: "Containers", icon: "box", hint: "containers · images · volumes · networks" },
  { href: "/dockflow/graph", label: "Topology", icon: "map", hint: "hierarchical estate map" },
  { href: "/dockflow/apm", label: "APM", icon: "activity", hint: "service map · traces · apdex" },
  { href: "/dockflow/workflows", label: "Workflows", icon: "workflow", hint: "automation builder" },
  { href: "/dockflow/jvm", label: "JVM", icon: "cpu", hint: "monitor · gc · threads · dumps" },
  { href: "/dockflow/config", label: "Config", icon: "file", hint: "compose · terraform · github" },
  { href: "/dockflow/cli", label: "CLI", icon: "terminal", hint: "local tooling" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await getJson<{ status: EngineStatus }>("/api/engine/status");
        if (!cancelled) {
          setStatus(payload.status);
          setStatusError(null);
        }
      } catch (error) {
        if (!cancelled) setStatusError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  useEffect(() => setOpen(false), [pathname]);

  const mode = status?.mode ?? (statusError ? "offline" : "…");
  const modeTone = mode === "live" ? "ok" : mode === "demo" ? "warn" : mode === "offline" ? "bad" : "muted";

  return (
    <div className="flex h-full w-full">
      {/* ------------------------------------------------------------ rail */}
      <aside
        className={cn(
          "z-30 flex h-full shrink-0 flex-col border-r border-line-soft bg-[var(--glass-bg-strong)] backdrop-blur-xl transition-[width] duration-200",
          open ? "w-[218px]" : "w-[62px]",
        )}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-line-soft px-3.5">
          <Logo size={26} />
          {open ? (
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold tracking-[0.14em] text-slate-100">DOCKFLOW</p>
              <p className="truncate font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-500">ops console</p>
            </div>
          ) : null}
        </div>

        <nav className="scroll-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {NAV.map((item) => {
            const active = item.href === "/dockflow" ? pathname === "/dockflow" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={`${item.label} — ${item.hint}`}
                className={cn(
                  "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 transition-colors",
                  active ? "bg-ice/12 text-ice" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100",
                )}
              >
                {active ? <span className="absolute left-0 top-1.5 h-6 w-[2px] rounded-full bg-ice" /> : null}
                <Icon name={item.icon} size={15} className="shrink-0" />
                {open ? <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em]">{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-line-soft p-2">
          <div className={cn("flex items-center gap-2 rounded-md px-1.5 py-1.5", open ? "" : "justify-center")}>
            <span
              className="h-[6px] w-[6px] shrink-0 rounded-full"
              style={{
                background:
                  modeTone === "ok" ? "var(--metric-ok)" : modeTone === "warn" ? "var(--metric-warn)" : modeTone === "bad" ? "var(--metric-danger)" : "var(--fg-500)",
              }}
            />
            {open ? (
              <div className="min-w-0">
                <p className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-slate-300">{mode} engine</p>
                <p className="truncate font-mono text-[8.5px] text-slate-500">{status?.engine?.serverVersion ?? statusError?.slice(0, 24) ?? "probing"}</p>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------------------ main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-line-soft bg-[var(--glass-bg)] px-4 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-slate-500">racmond /</span>
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-slate-300">
              {NAV.find((item) => (item.href === "/dockflow" ? pathname === "/dockflow" : pathname.startsWith(item.href)))?.label ?? "console"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded border px-1.5 py-[2px] font-mono text-[9px] uppercase tracking-[0.14em]",
                modeTone === "ok" && "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
                modeTone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-300",
                modeTone === "bad" && "border-rose-500/40 bg-rose-500/10 text-rose-300",
                modeTone === "muted" && "border-line bg-slate-500/10 text-slate-400",
              )}
              title={status?.error ?? (status ? `${status.mode} · ${status.endpoint ?? "no endpoint"}` : "probing the engine")}
            >
              <span className="h-[5px] w-[5px] rounded-full" style={{ background: "currentColor" }} />
              {mode}
              {status?.engine ? <span className="hidden text-slate-500 sm:inline">· {status.engine.serverVersion}</span> : null}
            </span>
            <span className="hidden font-mono text-[9px] text-slate-500 lg:inline">
              {status?.engine ? `${status.engine.cpus} cpu · ${status.engine.arch}` : statusError ? "engine unreachable" : "…"}
            </span>
            <ThemeToggle />
          </div>
        </header>

        <main className="scroll-thin min-h-0 flex-1 overflow-auto p-4">{children}</main>
      </div>
    </div>
  );
}
