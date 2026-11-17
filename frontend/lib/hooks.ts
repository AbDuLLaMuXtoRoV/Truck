"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ApiError, apiGet } from "./api";

/** Last successful response per GET path: lets revisited screens render instantly, then revalidate. */
const responseCache = new Map<string, unknown>();

/** Event fired when task / dashboard data changed locally (the shell refreshes its counts). */
export const DATA_CHANGED = "smart-truck:data-changed";

export function invalidateCache(prefix: string): void {
  for (const key of [...responseCache.keys()]) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
  if (typeof window !== "undefined" && prefix.startsWith("/api/dashboard")) window.dispatchEvent(new Event(DATA_CHANGED));
}

export interface UseApiResult<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  /** A request is in flight (initial load or refetch). Previous data stays available meanwhile. */
  loading: boolean;
  /** `data` belongs to a different path than the current one (filters changed, refetch pending). */
  stale: boolean;
  reload: () => void;
  /** Replace the local data (e.g. with a mutation response) without refetching. */
  setData: (next: T | ((prev: T | undefined) => T)) => void;
}

interface State<T> {
  key: string | null;
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
}

/**
 * Tiny data hook: GETs `path` (null = skip), keeps the previous data while refetching,
 * optionally polls every `refreshMs`.
 */
export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}): UseApiResult<T> {
  const [state, setState] = useState<State<T>>(() => ({
    key: path,
    data: path ? (responseCache.get(path) as T | undefined) : undefined,
    error: undefined,
    loading: path !== null,
  }));
  const [nonce, setNonce] = useState(0);
  const { refreshMs } = opts;

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    let active = true;
    const run = () => {
      setState((s) => {
        const cached = responseCache.get(path) as T | undefined;
        return { ...s, loading: true, ...(s.key !== path && cached !== undefined ? { key: path, data: cached } : {}) };
      });
      apiGet<T>(path, ctrl.signal)
        .then((data) => {
          if (!active) return;
          responseCache.set(path, data);
          setState({ key: path, data, error: undefined, loading: false });
        })
        .catch((error: unknown) => {
          if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
          setState((s) => ({ ...s, error: error as Error, loading: false }));
        });
    };
    run();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [path, nonce]);

  useEffect(() => {
    if (!refreshMs || path === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, path]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (next: T | ((prev: T | undefined) => T)) => {
      setState((s) => {
        const data = typeof next === "function" ? (next as (prev: T | undefined) => T)(s.data) : next;
        if (s.key) responseCache.set(s.key, data);
        return { ...s, data };
      });
    },
    [],
  );

  return {
    data: state.data,
    error: state.error,
    loading: state.loading,
    stale: state.key !== path,
    reload,
    setData,
  };
}

/** Current time, re-rendered every `intervalMs` (for relative due times). */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return v;
}

/** Calls `onOutside` on a pointer-down outside `ref` or on Escape, while `active`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onOutside: () => void): void {
  const cb = useRef(onOutside);
  useEffect(() => {
    cb.current = onOutside;
  });
  useEffect(() => {
    if (!active) return;
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, active]);
}
