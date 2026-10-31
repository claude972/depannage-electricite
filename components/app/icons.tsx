import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
  home: (
    <>
      <path d="m3 10 9-7 9 7v10H3Z" />
      <path d="M9 20v-7h6v7" />
    </>
  ),
  list: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plug: <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v5" />,
  panel: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7v4m4-4v4m4-4v4M8 16h8" />
    </>
  ),
  power: <path d="M12 2v10M6 5a9 9 0 1 0 12 0" />,
  bulb: <path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 3H9Z" />,
  message: <path d="M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0Z" />,
  document: <path d="M14 2H5v20h14V7ZM14 2v6h5M8 12h8M8 16h8" />,
  building: (
    <path d="M4 22V4h12v18M16 10h4v12M8 8h4m-4 4h4m-4 4h4m-4 4h4" />
  ),
  person: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20v-2a6 6 0 0 1 12 0v2M16 4.5a3.5 3.5 0 0 1 0 7M22 20v-2a5 5 0 0 0-4-4.9" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10h.01" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z" />
      <path d="m8 11 3 3 5-6" />
    </>
  ),
  location: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  navigate: <path d="m3 11 18-8-8 18-2-8Z" />,
  logout: <path d="M9 3H3v18h6M12 12h10m-4-4 4 4-4 4" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  download: <path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" />,
  upload: <path d="M12 21V9m-4 4 4-4 4 4M4 3h16" />,
  send: <path d="m22 2-7 20-4-9-9-4ZM11 13 22 2" />,
  wrench: (
    <path d="M21 5a6 6 0 0 1-8 8l-8 8-3-3 8-8a6 6 0 0 1 8-8l-4 4 4 3Z" />
  ),
  euro: <path d="M19 5a7 7 0 0 0-11 5v4a7 7 0 0 0 11 5M4 10h11M4 14h9" />,
  star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" />,
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 5 10 8L22 5" />
    </>
  ),
  phone: (
    <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2Z" />
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="12" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </>
  ),
  warning: (
    <>
      <path d="m12 2 10 19H2Z" />
      <path d="M12 8v5m0 4h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 2v6m10-6v6M3 11h18" />
    </>
  ),
  bell: <path d="M5 16V9a7 7 0 0 1 14 0v7l2 3H3ZM9 22h6" />,
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  trend: <path d="m3 17 6-6 4 4 8-8M15 7h6v6" />,
  chart: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8Z" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v12H4Z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  receipt: (
    <path d="M6 2h12v20l-3-2-3 2-3-2-3 2ZM9 8h6M9 12h6M9 16h4" />
  ),
  truck: (
    <>
      <path d="M2 7h11v9H2ZM13 10h5l3 3v3h-8" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  flag: <path d="M5 22V4h12l-2 4 2 4H5" />,
  pause: <path d="M8 5v14M16 5v14" />,
  edit: <path d="M4 20h4l11-11-4-4L4 16Zm11-15 4 4" />,
  badge: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="m8 14-2 8 6-3 6 3-2-8" />
    </>
  ),
  stopwatch: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2M9 2h6" />
    </>
  ),
  offline: (
    <path d="m2 2 20 20M5 12a10 10 0 0 1 4-3M2 8a14 14 0 0 1 3-2m14 2a14 14 0 0 0-5-3M12 20h.01M8.5 16a5 5 0 0 1 6-1" />
  ),
  box: (
    <>
      <path d="m12 2 9 5v10l-9 5-9-5V7Z" />
      <path d="M3 7l9 5 9-5M12 12v10" />
    </>
  ),
  layers: <path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5" />,
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] || PATHS.bolt}
    </svg>
  );
}
export const ICON_NAMES = Object.keys(PATHS);
