"use client";

import { useEffect } from "react";
import { useTheme } from "@/store/theme";
import { Icon } from "@/components/ops/icons";
import { cn } from "@/lib/cn";

/**
 * Theme switch.
 *
 * The icon + label swap is driven by CSS (`[data-theme]` on <html>) so the
 * control is correct on the very first paint — including for server-rendered
 * pages — while the click handler flips the persisted store.
 */
export function ThemeToggle({ className = "", label = true }: { className?: string; label?: boolean }) {
  const theme = useTheme((s) => s.theme);
  const hydrate = useTheme((s) => s.hydrate);
  const toggleTheme = useTheme((s) => s.toggleTheme);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        "theme-toggle group flex h-8 items-center gap-1.5 rounded-md border border-line px-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-slate-400",
        "hover:border-ice/45 hover:text-ice hover:shadow-[0_0_20px_-8px_var(--accent-strong)]",
        className,
      )}
    >
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        <Icon name="moon" size={12} className="theme-moon" />
        <Icon name="sun" size={13} className="theme-sun" />
      </span>
      {label ? (
        <span className="hidden sm:inline">
          <span className="theme-label theme-label-dark">dark</span>
          <span className="theme-label theme-label-light">light</span>
        </span>
      ) : null}
    </button>
  );
}
