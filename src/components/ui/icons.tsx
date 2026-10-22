"use client";

import type { SVGProps } from "react";

/**
 * Icon set — one small stroke-based family (1.6px, 24×24) so every glyph on the
 * console shares the same optical weight. Paths live in one map: adding an icon
 * is one entry, and nothing needs an external font or sprite request.
 */
const PATHS: Record<string, string[]> = {
  home: ["M3 10.6 12 3l9 7.6", "M5.5 9.4V21h13V9.4", "M10 21v-5.5h4V21"],
  map: ["M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z", "M9 4v14", "M15 6v14"],
  box: ["m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z", "m4 7.5 8 4.5 8-4.5", "M12 12v9"],
  activity: ["M3 12h4l2.5-7 4 14 2.5-7h5"],
  workflow: ["M4 4.5h6v5H4z", "M14 14.5h6v5h-6z", "M10 7h3.5a1.5 1.5 0 0 1 1.5 1.5V14", "M14 17H8a1.5 1.5 0 0 1-1.5-1.5V13"],
  cpu: ["M6.5 6.5h11v11h-11z", "M9.5 9.5h5v5h-5z", "M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21", "M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 13h6M9 17h4"],
  terminal: ["m4 7 5 5-5 5", "M12.5 17H20"],
  sun: ["M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z", "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22", "m5 5 1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"],
  moon: ["M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5 8.8 8.8 0 1 0 20.5 14.4Z"],
  refresh: ["M20 12a8 8 0 1 1-2.4-5.7", "M20 3.5V8h-4.5"],
  play: ["M8 4.8v14.4L19.5 12z"],
  pause: ["M9 5v14M15 5v14"],
  stop: ["M6.5 6.5h11v11h-11z"],
  trash: ["M4 7h16", "M9 7V4.5h6V7", "M6.5 7l1 13h9l1-13", "M10 11v5M14 11v5"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m16.2 16.2 4.3 4.3"],
  chevronRight: ["m9 5 7 7-7 7"],
  chevronDown: ["m5 9 7 7 7-7"],
  chevronLeft: ["m15 5-7 7 7 7"],
  plus: ["M12 5v14M5 12h14"],
  minus: ["M5 12h14"],
  maximize: ["M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"],
  x: ["m6 6 12 12M18 6 6 18"],
  external: ["M14 4h6v6", "M20 4l-8.5 8.5", "M18 14v5.5H4.5V6H10"],
  alert: ["M12 4 2.8 20h18.4L12 4Z", "M12 10v4.2", "M12 17.2h.01"],
  check: ["m4.5 12.5 5 5 10-11"],
  clock: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z", "M12 7.5V12l3.2 2"],
  layers: ["m12 3 9 4.8-9 4.8-9-4.8L12 3Z", "m21 12.6-9 4.8-9-4.8", "m21 17.1-9 4.8-9-4.8"],
  database: ["M4.5 6.5c0-1.7 3.4-3 7.5-3s7.5 1.3 7.5 3-3.4 3-7.5 3-7.5-1.3-7.5-3Z", "M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11", "M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"],
  network: ["M4 4h5v5H4zM15 4h5v5h-5zM9.5 15h5v5h-5z", "M6.5 9v3.5h11V9", "M12 12.5V15"],
  disk: ["M4 6.5h16v11H4z", "M7 12h2M7 15h6", "M16.5 12.5h.01"],
  image: ["M4 5h16v14H4z", "m5.5 16.5 4.5-5 3.5 4 2.5-2.8 4 4.3", "M15.5 9h.01"],
  server: ["M3.5 4.5h17v6h-17zM3.5 13.5h17v6h-17z", "M7 7.5h.01M7 16.5h.01", "M11 7.5h6M11 16.5h6"],
  branch: ["M6 4v11", "M6 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", "M18 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", "M18 8v3a4 4 0 0 1-4 4H9"],
  github: ["M9 20.5c-4 1-4-2.2-5.5-2.7", "M14.5 22v-3.4c0-1 .1-1.5-.5-2 2.3-.3 4.6-1.2 4.6-5.2a4 4 0 0 0-1.1-2.8 3.7 3.7 0 0 0-.1-2.8s-1.2-.3-3.6 1.3a12 12 0 0 0-6 0C5.4 5.5 4.2 5.8 4.2 5.8a3.7 3.7 0 0 0-.1 2.8A4 4 0 0 0 3 11.4c0 4 2.3 4.9 4.6 5.2-.6.5-.6 1-.5 2V22"],
  lock: ["M6.5 10.5h11V21h-11z", "M9 10.5V7.8a3 3 0 0 1 6 0v2.7", "M12 14.5v2.5"],
  zap: ["M13.5 2 4 14h6l-1.5 8L19 10h-6l.5-8Z"],
  download: ["M12 4v11", "m7.5 11 4.5 4.5L16.5 11", "M4.5 20h15"],
  copy: ["M8 8h11v12H8z", "M16 8V4H5v12h3"],
  edit: ["M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z", "M14.5 6.5 17.5 9.5"],
  arrowRight: ["M4 12h15", "m13.5 6 6 6-6 6"],
  filter: ["M3.5 5.5h17l-6.5 7.5V20l-4-2v-5L3.5 5.5Z"],
  gauge: ["M12 4a8.5 8.5 0 0 0-8.5 8.5h17A8.5 8.5 0 0 0 12 4Z", "M12 12.5 16 9", "M12 15.5h.01"],
  code: ["m8.5 8-4.5 4 4.5 4", "m15.5 8 4.5 4-4.5 4"],
  eye: ["M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z", "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"],
  dot: ["M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Z"],
  folder: ["M3 6.5h6l2 2.5h10V20H3z"],
  save: ["M5 4h11l3 3v13H5z", "M8 4v5h7V4", "M8 20v-6h8v6"],
  rotate: ["M4 5.5v5h5", "M4.6 10.5A8 8 0 1 1 12 20"],
  send: ["M21 3 10.5 13.5", "M21 3 14.5 21l-4-7.5L3 9.5 21 3Z"],
  shield: ["m12 3 8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z", "m9 12 2 2 4-4"],
  bell: ["M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z", "M10 19a2 2 0 0 0 4 0"],
  threads: ["M4 5h16M4 12h16M4 19h10", "M18 17v4"],
  memory: ["M5 7h14v10H5z", "M8 7V4.5M12 7V4.5M16 7V4.5", "M8 17v2.5M12 17v2.5M16 17v2.5"],
  docker: ["m4 11h3v3H4zM8 11h3v3H8zM12 11h3v3h-3zM8 7.5h3v3H8zM12 7.5h3v3h-3z", "M3 15c.8 3 3.3 4.5 6.5 4.5h4c3.6 0 6-1.8 7-5.5", "M16 11.2c1.4-.4 2.6.2 3 1.3"],
  stack: ["m12 3 8.5 4.5L12 12 3.5 7.5 12 3Z", "M3.5 12 12 16.5 20.5 12", "M3.5 16.5 12 21l8.5-4.5"],
  compass: ["M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Z", "m15 9-2 5-4 1 2-4.5 4-1.5Z"],
};

export type IconName = keyof typeof PATHS | (string & {});

export function Icon({
  name,
  size = 16,
  className = "",
  strokeWidth = 1.6,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  const paths = PATHS[name] ?? PATHS.dot;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="dockflow-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--logo-primary)" />
          <stop offset="55%" stopColor="var(--logo-tertiary)" />
          <stop offset="100%" stopColor="var(--logo-secondary)" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 29 9.6v12.8L16 29.5 3 22.4V9.6L16 2.5Z"
        fill="none"
        stroke="url(#dockflow-logo)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M16 9.4l6.4 3.5v7l-6.4 3.5-6.4-3.5v-7L16 9.4Z" fill="url(#dockflow-logo)" opacity="0.22" />
      <circle cx="16" cy="16" r="2.6" fill="url(#dockflow-logo)" />
    </svg>
  );
}
