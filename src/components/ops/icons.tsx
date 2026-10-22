import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "org"
  | "division"
  | "project"
  | "datacenter"
  | "server"
  | "container"
  | "pod"
  | "namespace"
  | "group"
  | "service"
  | "endpoint"
  | "cpu"
  | "memory"
  | "disk"
  | "activity"
  | "alert"
  | "check"
  | "chevron"
  | "search"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "play"
  | "pause"
  | "terminal"
  | "refresh"
  | "target"
  | "network"
  | "clock"
  | "sliders"
  | "tree"
  | "grip"
  | "radio"
  | "shield"
  | "arrowRight";

const PATHS: Record<IconName, ReactElement> = {
  org: (
    <>
      <path d="M4 20V8l8-4 8 4v12" />
      <path d="M9 20v-5h6v5" />
      <path d="M4 20h16" />
      <path d="M9.5 10.5h5" />
    </>
  ),
  division: (
    <>
      <rect x="3" y="4" width="7" height="6" rx="1.5" />
      <rect x="14" y="14" width="7" height="6" rx="1.5" />
      <rect x="3" y="14" width="7" height="6" rx="1.5" />
      <path d="M6.5 10v2.5h11V14M6.5 12.5V14" />
    </>
  ),
  project: (
    <>
      <path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" />
      <path d="M4 12.5l8 4.5 8-4.5" />
      <path d="M4 17l8 4.5 8-4.5" />
    </>
  ),
  datacenter: (
    <>
      <rect x="3.5" y="4" width="17" height="6" rx="1.4" />
      <rect x="3.5" y="14" width="17" height="6" rx="1.4" />
      <path d="M7 7h.01M7 17h.01M10.5 7h5M10.5 17h5" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="5" width="18" height="6" rx="1.4" />
      <rect x="3" y="13" width="18" height="6" rx="1.4" />
      <path d="M6.5 8h.01M6.5 16h.01M17 8h1.5M17 16h1.5" />
    </>
  ),
  container: (
    <>
      <path d="M12 3l7.5 4v10L12 21l-7.5-4V7L12 3z" />
      <path d="M4.5 7L12 11l7.5-4M12 11v10" />
    </>
  ),
  pod: (
    <>
      <path d="M12 3l6.5 3.6v7.8L12 21l-6.5-6.6V6.6L12 3z" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  namespace: (
    <>
      <path d="M8 4H5.5A1.5 1.5 0 004 5.5v13A1.5 1.5 0 005.5 20H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H16" />
      <path d="M10 9l-2 3 2 3M14 9l2 3-2 3" />
    </>
  ),
  group: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
    </>
  ),
  service: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4M5.6 5.6l2.4 2.4M16 16l2.4 2.4M18.4 5.6L16 8M8 16l-2.4 2.4" />
    </>
  ),
  endpoint: (
    <>
      <path d="M9 3v6M15 3v6" />
      <path d="M6 9h12v3a6 6 0 01-6 6 6 6 0 01-6-6V9z" />
      <path d="M12 18v3" />
    </>
  ),
  cpu: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1" />
      <path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" />
    </>
  ),
  memory: (
    <>
      <rect x="3" y="7" width="18" height="9" rx="1.6" />
      <path d="M6.5 16v3M10 16v3M14 16v3M17.5 16v3M6.5 10.5h2.5v2.5h-2.5zM11.5 10.5H14v2.5h-2.5z" />
    </>
  ),
  disk: (
    <>
      <ellipse cx="12" cy="6.5" rx="8" ry="3" />
      <path d="M4 6.5v11c0 1.7 3.6 3 8 3s8-1.3 8-3v-11" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  activity: <path d="M3 12h3.5L9 5l3.5 14L15.5 12H21" />,
  alert: (
    <>
      <path d="M12 4.5l8.5 15h-17l8.5-15z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5M10.5 8v5" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </>
  ),
  play: <path d="M7 4.5l12 7.5-12 7.5v-15z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M7 10l2.5 2.5L7 15M12.5 15.5H17" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 10-3 6.2" />
      <path d="M20 6v6h-6" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="19" r="2.2" />
      <circle cx="19" cy="19" r="2.2" />
      <path d="M12 7.2v5.3M12 12.5L6.3 17M12 12.5L17.7 17" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.5 2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  tree: (
    <>
      <path d="M6 4v16M6 8h6M6 14h6" />
      <rect x="12" y="5.5" width="7" height="5" rx="1.2" />
      <rect x="12" y="11.5" width="7" height="5" rx="1.2" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.2" />
      <circle cx="15" cy="6" r="1.2" />
      <circle cx="9" cy="12" r="1.2" />
      <circle cx="15" cy="12" r="1.2" />
      <circle cx="9" cy="18" r="1.2" />
      <circle cx="15" cy="18" r="1.2" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M7.8 7.8a6 6 0 000 8.4M16.2 16.2a6 6 0 000-8.4M4.9 4.9a10 10 0 000 14.2M19.1 19.1a10 10 0 000-14.2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  arrowRight: <path d="M4 12h15M13 6l6 6-6 6" />,
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.6, ...rest }: IconProps) {
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
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
