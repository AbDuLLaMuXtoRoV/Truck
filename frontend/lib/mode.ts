"use client";

/** Simple (default) vs advanced UI, remembered per user in localStorage. */

import { useSyncExternalStore } from "react";
import { useAuth } from "./auth";

export type Mode = "simple" | "advanced";

const listeners = new Set<() => void>();
/** Fallback when storage is blocked, so the switch still works for this tab. */
const memory = new Map<string, Mode>();
const keyFor = (userId: string) => `smart-truck.mode.${userId}`;

function read(userId: string | undefined): Mode {
  if (!userId || typeof window === "undefined") return "simple";
  const mem = memory.get(userId);
  if (mem) return mem;
  try {
    return window.localStorage.getItem(keyFor(userId)) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
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
  return useSyncExternalStore(
    subscribe,
    () => read(userId),
    () => "simple",
  );
}
