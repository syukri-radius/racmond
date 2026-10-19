import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "HELIOS OPS · Hierarchical Control & Monitoring",
  description:
    "Nested sub-flow control room spanning organizations, datacenters, servers, containers, pods, services, endpoints and resource gauges.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full overflow-hidden bg-ink-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}
