"use client";

import { Check, Pause, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT, type Key } from "@/lib/i18n";
import { STAGES, stage, type Stage } from "@/lib/stage";
import type { TaskStatus } from "@/lib/types";
import { cx, focusRing } from "../ui";

const STAGE_STYLE: Record<Exclude<Stage, "hidden">, { pill: string; dot: string; ring: string }> = {
  new: { pill: "bg-blue-500/12 text-blue-700 ring-blue-500/25 dark:text-blue-300", dot: "bg-blue-500", ring: "ring-blue-500" },
  doing: { pill: "bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:text-amber-300", dot: "bg-amber-500", ring: "ring-amber-500" },
  check: { pill: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300", dot: "bg-violet-500", ring: "ring-violet-500" },
  done: { pill: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300", dot: "bg-emerald-500", ring: "ring-emerald-500" },
};

export const STAGE_KEY: Record<Exclude<Stage, "hidden">, Key> = {
  new: "s.stage_new",
  doing: "s.stage_doing",
  check: "s.stage_check",
  done: "s.stage_done",
};

export function StagePill({ status, large }: { status: TaskStatus; large?: boolean }) {
  const { t } = useT();
  const s = stage(status);
  if (s === "hidden") return <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-semibold text-fg-3">{t("s.cancelled")}</span>;
  const st = STAGE_STYLE[s];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={cx(
          "inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset",
          st.pill,
          large ? "px-3 py-1 text-[15px]" : "px-2.5 py-0.5 text-sm",
        )}
      >
        <span className={cx("size-2 rounded-full", st.dot)} aria-hidden />
        {t(STAGE_KEY[s])}
      </span>
      {status === "blocked" ? (
        <span className={cx("inline-flex items-center gap-1 rounded-full bg-rose-500/12 font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300", large ? "px-3 py-1 text-[15px]" : "px-2.5 py-0.5 text-sm")}>
          <Pause className="size-3" aria-hidden />
          {t("s.stuck_badge")}
        </span>
      ) : null}
    </span>
  );
}

/** New → In work → Checking → Done, so everyone sees where a task is. */
export function Stepper({ status }: { status: TaskStatus }) {
  const { t } = useT();
  const s = stage(status);
  if (s === "hidden") return null;
  const at = STAGES.indexOf(s);
  return (
    <ol className="flex items-start" aria-label={t("s.stepper_label")}>
      {STAGES.map((step, i) => {
        const past = i < at;
        const current = i === at;
        const st = STAGE_STYLE[step];
        return (
          <li key={step} className="flex flex-1 flex-col items-center text-center" aria-current={current ? "step" : undefined}>
            <div className="flex w-full items-center">
              <span className={cx("h-0.5 flex-1", i === 0 ? "bg-transparent" : i <= at ? "bg-emerald-500" : "bg-line")} aria-hidden />
              <span
                className={cx(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  past && "bg-emerald-500 text-white",
                  current && cx("bg-surface ring-4 ring-offset-0", st.ring, "text-fg"),
                  !past && !current && "bg-surface-3 text-fg-4",
                )}
              >
                {past ? <Check className="size-4" aria-hidden /> : current ? <span className={cx("size-3 rounded-full", st.dot)} /> : i + 1}
              </span>
              <span className={cx("h-0.5 flex-1", i === STAGES.length - 1 ? "bg-transparent" : i < at ? "bg-emerald-500" : "bg-line")} aria-hidden />
            </div>
            <span className={cx("mt-1.5 px-1 text-[13px] leading-tight sm:text-sm", current ? "font-semibold text-fg" : past ? "text-fg-2" : "text-fg-4")}>{t(STAGE_KEY[step])}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("button, textarea, select, input")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-start sm:p-4 sm:pt-[12vh]">
      <div className="fixed inset-0 animate-fade-in bg-slate-950/50" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[88vh] w-full animate-slide-up overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-pop sm:max-w-md sm:rounded-2xl sm:pb-5"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-fg">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className={cx("rounded-full p-1.5 text-fg-3 hover:bg-surface-3", focusRing)}>
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Big one-of-many choice chips (reason presets). */
export function ChoiceChips({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid gap-2" role="radiogroup">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cx(
              "flex min-h-12 items-center gap-3 rounded-xl border px-4 text-left text-[15px] font-medium transition-colors",
              focusRing,
              on ? "border-accent bg-accent-soft text-fg" : "border-line bg-surface text-fg-2 hover:bg-surface-2",
            )}
          >
            <span className={cx("flex size-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-accent" : "border-line-strong")} aria-hidden>
              {on ? <span className="size-2.5 rounded-full bg-accent" /> : null}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 44px+ full-width-on-phone action button. */
export function BigButton({
  children,
  onClick,
  variant = "secondary",
  busy,
  disabled,
  type = "button",
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "success";
  busy?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  icon?: ReactNode;
}) {
  const v = {
    primary: "bg-accent text-white hover:bg-accent-hover shadow-xs",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs",
    secondary: "border border-line bg-surface text-fg hover:bg-surface-2 shadow-xs",
    danger: "border border-line bg-surface text-danger-text hover:bg-danger-soft",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={cx(
        "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition-all active:scale-[0.98] disabled:opacity-50 sm:w-auto [&_svg]:size-5",
        focusRing,
        v,
      )}
    >
      {busy ? (
        <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
