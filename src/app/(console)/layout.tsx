import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";

/**
 * The console lives under /dockflow so the original HELIOS dashboard keeps the
 * site root. This layout adds the operator rail + engine header around every
 * console page.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 h-full">
      <AppShell>{children}</AppShell>
    </div>
  );
}
