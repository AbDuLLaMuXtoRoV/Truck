/** Small inline illustrations for empty states. Colours come from theme variables (light + dark). */

import type { ReactNode } from "react";

export type IllustrationName = "inbox" | "search" | "truck" | "chat" | "check" | "bell" | "lock" | "board" | "chart";

const S = { stroke: "var(--fg-4)", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return (
    <svg viewBox="0 0 112 80" className={className} aria-hidden>
      <ellipse cx="56" cy="72" rx="38" ry="4" fill="var(--surface-3)" />
      <circle cx="56" cy="38" r="30" fill="var(--accent-soft)" />
      {SHAPES[name]}
    </svg>
  );
}

const SHAPES: Record<IllustrationName, ReactNode> = {
  inbox: (
    <g>
      <rect x="34" y="22" width="44" height="34" rx="5" {...S} fill="var(--surface)" />
      <path d="M34 42h12l3 5h14l3-5h12" {...S} />
      <path d="M48 30h16M48 35h10" {...S} stroke="var(--accent)" />
    </g>
  ),
  search: (
    <g>
      <rect x="30" y="20" width="40" height="40" rx="6" {...S} fill="var(--surface)" />
      <path d="M38 30h24M38 36h16M38 42h20" {...S} />
      <circle cx="70" cy="50" r="9" {...S} fill="var(--surface)" stroke="var(--accent)" />
      <path d="M76.5 56.5l6 6" {...S} stroke="var(--accent)" strokeWidth={2.4} />
    </g>
  ),
  truck: (
    <g>
      <rect x="28" y="28" width="34" height="22" rx="3" {...S} fill="var(--surface)" />
      <path d="M62 34h10l8 8v8H62z" {...S} fill="var(--surface)" />
      <circle cx="40" cy="52" r="5" {...S} fill="var(--surface)" stroke="var(--accent)" />
      <circle cx="72" cy="52" r="5" {...S} fill="var(--surface)" stroke="var(--accent)" />
      <path d="M66 38h5l4 4h-9z" {...S} fill="var(--accent-soft)" />
    </g>
  ),
  chat: (
    <g>
      <rect x="28" y="20" width="40" height="26" rx="8" {...S} fill="var(--surface)" />
      <path d="M36 46l-4 7 9-7" {...S} fill="var(--surface)" />
      <rect x="50" y="36" width="34" height="22" rx="8" fill="var(--accent)" />
      <path d="M58 44h18M58 50h11" stroke="white" strokeWidth={1.8} strokeLinecap="round" />
      <path d="M36 30h24M36 36h14" {...S} />
    </g>
  ),
  check: (
    <g>
      <circle cx="56" cy="38" r="16" {...S} fill="var(--surface)" stroke="var(--success)" />
      <path d="M48.5 38.5l5 5 10-10" {...S} stroke="var(--success)" strokeWidth={2.4} />
    </g>
  ),
  bell: (
    <g>
      <path d="M44 48V36a12 12 0 0 1 24 0v12l4 4H40z" {...S} fill="var(--surface)" />
      <path d="M52 56a4 4 0 0 0 8 0" {...S} stroke="var(--accent)" />
    </g>
  ),
  lock: (
    <g>
      <rect x="40" y="34" width="32" height="24" rx="5" {...S} fill="var(--surface)" />
      <path d="M46 34v-6a10 10 0 0 1 20 0v6" {...S} />
      <circle cx="56" cy="45" r="3" fill="var(--accent)" />
      <path d="M56 48v4" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
    </g>
  ),
  board: (
    <g>
      <rect x="26" y="22" width="18" height="34" rx="4" {...S} fill="var(--surface)" />
      <rect x="47" y="22" width="18" height="26" rx="4" {...S} fill="var(--surface)" />
      <rect x="68" y="22" width="18" height="30" rx="4" {...S} fill="var(--surface)" />
      <rect x="30" y="27" width="10" height="5" rx="1.5" fill="var(--accent)" />
      <rect x="51" y="27" width="10" height="5" rx="1.5" fill="var(--accent-soft)" stroke="var(--fg-4)" strokeWidth={1} />
      <rect x="72" y="27" width="10" height="5" rx="1.5" fill="var(--accent-soft)" stroke="var(--fg-4)" strokeWidth={1} />
    </g>
  ),
  chart: (
    <g>
      <path d="M32 58h50" {...S} />
      <rect x="36" y="42" width="7" height="16" rx="2" {...S} fill="var(--accent-soft)" />
      <rect x="49" y="32" width="7" height="26" rx="2" fill="var(--accent)" />
      <rect x="62" y="38" width="7" height="20" rx="2" {...S} fill="var(--accent-soft)" />
    </g>
  ),
};
