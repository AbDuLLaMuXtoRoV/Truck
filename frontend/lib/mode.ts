"use client";

/**
 * Simple vs advanced (CRM) UI, remembered per user in localStorage. Agents start in simple mode;
 * supervisors and above start in the CRM.
 */

import { useSyncExternalStore } from "react";
import { useAuth } from "./auth";

export type Mode = "simple" | "advanced";

const listeners = new Set<() => void>();
/** Fallback when storage is blocked, so the switch still works for this tab. */
const memory = new Map<string, Mode>();
const keyFor = (userId: string) => `smart-truck.mode.${userId}`;

export function defaultMode(role: string | undefined): Mode {
  return !role || role === "agent" ? "simple" : "advanced";
}

function read(userId: string | undefined, role: string | undefined): Mode {
  const fallback = defaultMode(role);
  if (!userId || typeof window === "undefined") return fallback;
  const mem = memory.get(userId);
  if (mem) return mem;
  try {
    const v = window.localStorage.getItem(keyFor(userId));
    return v === "advanced" || v === "simple" ? v : fallback;
  } catch {
    return fallback;
  }
}

export function setMode(userId: string, mode: Mode): void {
  memory.set(userId, mode);
  try {
    window.localStorage.setItem(keyFor(userId), mode);
  } catch {
    /* kept in memory only */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // another tab switched modes
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith("smart-truck.mode.")) {
      memory.clear();
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMode(): Mode {
  const { me } = useAuth();
  const userId = me?.id;
  const role = me?.role;
  return useSyncExternalStore(
    subscribe,
    () => read(userId, role),
    () => defaultMode(role),
  );
}
