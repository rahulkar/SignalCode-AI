import type { SVGProps } from "react";

export type IconName =
  | "appearance"
  | "accepted"
  | "rejected"
  | "iterated"
  | "window"
  | "refresh"
  | "sync"
  | "server"
  | "terminal"
  | "rate"
  | "tasks"
  | "layers"
  | "edit"
  | "type"
  | "timer"
  | "chart"
  | "momentum"
  | "table"
  | "filter"
  | "search"
  | "download"
  | "trash"
  | "database"
  | "events"
  | "file";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {renderIcon(name)}
    </svg>
  );
}

function renderIcon(name: IconName) {
  switch (name) {
    case "appearance":
      return (
        <>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </>
      );
    case "accepted":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m8.6 12 2.3 2.4 4.7-4.9" />
        </>
      );
    case "rejected":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m9 9 6 6" />
          <path d="m15 9-6 6" />
        </>
      );
    case "iterated":
      return (
        <>
          <path d="M17 3v5h-5" />
          <path d="M7 21v-5h5" />
          <path d="M7.8 8.2A6.5 6.5 0 0 1 17 8" />
          <path d="M16.2 15.8A6.5 6.5 0 0 1 7 16" />
        </>
      );
    case "window":
      return (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
          <path d="M8 2.8v3.4" />
          <path d="M16 2.8v3.4" />
          <path d="M3.5 9.5h17" />
        </>
      );
    case "refresh":
      return (
        <>
          <path d="M20 11a8 8 0 0 0-14.7-4.2" />
          <path d="M4 5v4h4" />
          <path d="M4 13a8 8 0 0 0 14.7 4.2" />
          <path d="M20 19v-4h-4" />
        </>
      );
    case "sync":
      return (
        <>
          <path d="M3 12h4" />
          <path d="m5 10-2 2 2 2" />
          <path d="M21 12h-4" />
          <path d="m19 10 2 2-2 2" />
          <path d="M8 7a6 6 0 0 1 8.5 0" />
          <path d="M16 17a6 6 0 0 1-8.5 0" />
        </>
      );
    case "server":
      return (
        <>
          <rect x="4" y="4" width="16" height="6" rx="2" />
          <rect x="4" y="14" width="16" height="6" rx="2" />
          <path d="M8 7h.01" />
          <path d="M8 17h.01" />
          <path d="M12 7h4" />
          <path d="M12 17h4" />
        </>
      );
    case "terminal":
      return (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
          <path d="m7.5 9 3 3-3 3" />
          <path d="M12.5 15h4" />
        </>
      );
    case "rate":
      return (
        <>
          <path d="M5 19h14" />
          <path d="M7 16V8" />
          <path d="M12 16V5" />
          <path d="M17 16v-4" />
        </>
      );
    case "tasks":
      return (
        <>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </>
      );
    case "layers":
      return (
        <>
          <path d="m12 4 8 4-8 4-8-4 8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </>
      );
    case "edit":
      return (
        <>
          <path d="m4 20 4.5-1 9-9a2.1 2.1 0 0 0-3-3l-9 9L4 20Z" />
          <path d="m13 7 4 4" />
        </>
      );
    case "type":
      return (
        <>
          <path d="M5 6h14" />
          <path d="M12 6v12" />
          <path d="M8 18h8" />
        </>
      );
    case "timer":
      return (
        <>
          <circle cx="12" cy="13" r="7.5" />
          <path d="M12 13V9" />
          <path d="m12 13 3 2" />
          <path d="M9 3h6" />
        </>
      );
    case "chart":
      return (
        <>
          <path d="M4 19h16" />
          <path d="m6 15 3-4 3 2 5-6 1 1" />
          <circle cx="9" cy="11" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
          <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case "momentum":
      return (
        <>
          <path d="M4 19h16" />
          <path d="m5 16 3-4 3 2 4-6 4 3" />
          <path d="m18 7 1-2 2 1" />
        </>
      );
    case "table":
      return (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M3.5 10h17" />
          <path d="M10 10v9" />
          <path d="M15 10v9" />
        </>
      );
    case "filter":
      return (
        <>
          <path d="M4 6h16" />
          <path d="M7 12h10" />
          <path d="M10 18h4" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </>
      );
    case "download":
      return (
        <>
          <path d="M12 4v10" />
          <path d="m8 10 4 4 4-4" />
          <path d="M5 19h14" />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="m7 7 1 12h8l1-12" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </>
      );
    case "database":
      return (
        <>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </>
      );
    case "events":
      return (
        <>
          <path d="M4 7h4" />
          <path d="M4 12h6" />
          <path d="M4 17h8" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="18" cy="12" r="2" />
          <circle cx="14" cy="17" r="2" />
        </>
      );
    case "file":
      return (
        <>
          <path d="M8 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5Z" />
          <path d="M14 3.5V8h4" />
          <path d="M9.5 12h5" />
          <path d="M9.5 16h5" />
        </>
      );
    default:
      return null;
  }
}
