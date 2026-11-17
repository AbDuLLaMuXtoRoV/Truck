"use client";

/** Light / dark / system theme, persisted in localStorage and applied as a class on <html>. */

import { useSyncExternalStore } from "react";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "smart-truck.theme";
const listeners = new Set<() => void>();
let current: Theme | null = null;

function read(): Theme {
  if (typeof window === "undefined") return "system";
  if (current) return current;
  try {
    const v = window.localStorage.getItem(KEY);
    current = v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    current = "system";
  }
  return current;
}

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && systemDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* not persisted */
  }
  apply(theme);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // follow the OS while in "system" mode
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (read() === "system") {
      apply("system");
      fn();
    }
  };
  mq.addEventListener("change", onChange);
  return () => {
    listeners.delete(fn);
    mq.removeEventListener("change", onChange);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => "system");
}

/** Whether dark is actually showing (resolves "system"). */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}
