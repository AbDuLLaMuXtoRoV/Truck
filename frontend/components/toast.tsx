"use client";

import { CircleCheck, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { cx } from "./ui";

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
  href?: string;
}

type Push = (text: string, opts?: { kind?: Toast["kind"]; href?: string }) => void;

const ToastContext = createContext<Push>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const { t: tr } = useT();

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  const push = useCallback<Push>(
    (text, opts) => {
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-3), { id, text, kind: opts?.kind ?? "ok", href: opts?.href }]);
      window.setTimeout(() => dismiss(id), opts?.kind === "error" ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              "pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-3 text-sm shadow-pop",
              toast.kind === "error" ? "border-danger/30" : "border-line",
            )}
          >
            {toast.kind === "error" ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-fg">
              {toast.text}
              {toast.href ? (
                <Link href={toast.href} className="ml-2 font-medium text-accent-text hover:underline">
                  {tr("common.open")}
                </Link>
              ) : null}
            </span>
            <button type="button" className="rounded p-0.5 text-fg-4 hover:bg-surface-3 hover:text-fg" onClick={() => dismiss(toast.id)} aria-label={tr("common.dismiss")}>
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Push {
  return useContext(ToastContext);
}
