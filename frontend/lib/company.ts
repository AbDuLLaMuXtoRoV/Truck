"use client";

/**
 * Company scope for users who can see several companies. `null` means "All companies": requests go
 * without a header (the backend answers for the home company) and owner screens add the all-company
 * overview. A company id is sent as `X-Company-Id` on every API request.
 */

import { useSyncExternalStore } from "react";

const KEY = "smart-truck.company";
const listeners = new Set<() => void>();

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
  } catch {
    return null;
  }
}

let current: string | null | undefined;

export function getCompanyScope(): string | null {
  if (current === undefined) current = readStored();
  return current;
}

export function setCompanyScope(id: string | null): void {
  current = id;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* kept for this tab only */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The selected company id, or null for "All companies" / the home company. */
export function useCompanyScope(): string | null {
  return useSyncExternalStore(subscribe, getCompanyScope, () => null);
}

// --------------------------------------------------------------------------- dashboard time range

export const RANGES = [1, 7, 30] as const;
export type RangeDays = (typeof RANGES)[number];
const RANGE_KEY = "smart-truck.range";
const rangeListeners = new Set<() => void>();
let range: RangeDays | undefined;

export function getRange(): RangeDays {
  if (range === undefined) {
    let v = 1;
    try {
      v = Number(window.localStorage.getItem(RANGE_KEY) ?? 1);
    } catch {
      /* default */
    }
    range = (RANGES as readonly number[]).includes(v) ? (v as RangeDays) : 1;
  }
  return range;
}

export function setRange(days: RangeDays): void {
  range = days;
  try {
    window.localStorage.setItem(RANGE_KEY, String(days));
  } catch {
    /* kept for this tab only */
  }
  rangeListeners.forEach((fn) => fn());
}

export function useRange(): RangeDays {
  return useSyncExternalStore(
    (fn) => {
      rangeListeners.add(fn);
      return () => rangeListeners.delete(fn);
    },
    getRange,
    () => 1 as RangeDays,
  );
}
