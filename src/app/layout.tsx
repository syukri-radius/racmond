import type { Metadata } from "next";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { ThemeWatcher } from "@/components/theme/ThemeWatcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "HELIOS OPS · Hierarchical Control & Monitoring",
  description:
    "Nested sub-flow control room spanning organizations, datacenters, servers, containers, pods, services, endpoints and resource gauges.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* applies the stored / OS theme before the first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden antialiased text-slate-200">
        {/* decorative purple aurora the glass surfaces refract */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div
            className="aurora-orb absolute -left-[14%] -top-[26%] h-[52rem] w-[52rem] rounded-full blur-[90px]"
            style={{ background: "radial-gradient(circle at 40% 40%, var(--page-glow-a), transparent 64%)" }}
          />
          <div
            className="aurora-orb absolute -right-[12%] -top-[18%] h-[42rem] w-[42rem] rounded-full blur-[90px]"
            style={{ background: "radial-gradient(circle at 60% 40%, var(--page-glow-b), transparent 62%)", animationDelay: "-6s" }}
          />
          <div
            className="aurora-orb absolute -bottom-[34%] left-[24%] h-[48rem] w-[48rem] rounded-full blur-[100px]"
            style={{ background: "radial-gradient(circle at 50% 50%, var(--page-glow-c), transparent 64%)", animationDelay: "-11s" }}
          />
        </div>
        <ThemeWatcher />
        <div className="relative z-10 h-full">{children}</div>
      </body>
    </html>
  );
}
