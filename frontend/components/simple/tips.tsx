"use client";

import { Lightbulb, X } from "lucide-react";
import { createContext, useContext, useEffect, useId, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import { cx, focusRing } from "../ui";

// --------------------------------------------------------------------------- page title (simple shell top bar)

export const TitleContext = createContext<(title: string | null) => void>(() => {});

/** Sets the simple shell's top-bar title for the current page. */
export function usePageTitle(title: string | null): void {
  const set = useContext(TitleContext);
  useEffect(() => {
    set(title);
    return () => set(null);
  }, [title, set]);
}

// --------------------------------------------------------------------------- one-time tips

const PREFIX = "smart-truck.tip.";
const listeners = new Set<() => void>();
/** Only one card shows a given tip at a time: the first one mounted owns it. */
const owners = new Map<string, string>();
const dismissedMem = new Set<string>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isDismissed(key: string): boolean {
  if (dismissedMem.has(key)) return true;
  try {
    return window.localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

export function dismissTip(key: string): void {
  dismissedMem.add(key);
  try {
    window.localStorage.setItem(PREFIX + key, "1");
  } catch {
    /* remembered for this tab only */
  }
  emit();
}

export function useOneTimeTip(key: string | null): { show: boolean; dismiss: () => void } {
  const id = useId();
  useEffect(() => {
    if (!key) return;
    if (!owners.has(key)) {
      owners.set(key, id);
      emit();
    }
    return () => {
      if (owners.get(key) === id) {
        owners.delete(key);
        emit();
      }
    };
  }, [key, id]);
  const show = useSyncExternalStore(
    subscribe,
    () => !!key && owners.get(key) === id && !isDismissed(key),
    () => false,
  );
  return { show, dismiss: () => (key ? dismissTip(key) : undefined) };
}

/** Small speech bubble pointing at the button below it. */
export function TipBubble({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { t } = useT();
  return (
    <div role="note" className="relative mb-2.5 flex animate-pop-in items-start gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm text-white shadow-pop dark:bg-slate-100 dark:text-slate-900">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-300 dark:text-amber-600" aria-hidden />
      <span className="flex-1 leading-snug">{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className={cx("-my-1 -mr-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/10 dark:text-slate-700 dark:hover:bg-slate-900/10", focusRing)}
      >
        {t("s.tip_ok")}
        <X className="size-3.5" aria-hidden />
      </button>
      <span className="absolute -bottom-1.5 left-8 size-3 rotate-45 bg-slate-900 dark:bg-slate-100" aria-hidden />
    </div>
  );
}
