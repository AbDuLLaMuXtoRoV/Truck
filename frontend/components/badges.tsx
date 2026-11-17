"use client";

import { Bot, Clock, Flag, Pencil, Send, Sparkles, TriangleAlert, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { formatPercent } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { BotMembership, Priority, TaskSource, TaskStatus } from "@/lib/types";
import { cx } from "./ui";

const pill = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

const STATUS_STYLE: Record<TaskStatus, { pill: string; dot: string }> = {
  detected: { pill: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300", dot: "bg-violet-500" },
  needs_review: { pill: "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300", dot: "bg-amber-500" },
  assigned: { pill: "bg-sky-500/10 text-sky-800 ring-sky-500/25 dark:text-sky-300", dot: "bg-sky-500" },
  in_progress: { pill: "bg-blue-500/10 text-blue-700 ring-blue-500/25 dark:text-blue-300", dot: "bg-blue-500" },
  blocked: { pill: "bg-fuchsia-500/10 text-fuchsia-800 ring-fuchsia-500/25 dark:text-fuchsia-300", dot: "bg-fuchsia-600" },
  pending_verification: { pill: "bg-teal-500/10 text-teal-800 ring-teal-500/25 dark:text-teal-300", dot: "bg-teal-500" },
  completed: { pill: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300", dot: "bg-emerald-500" },
  cancelled: { pill: "bg-surface-3 text-fg-3 ring-line", dot: "bg-fg-4" },
};

export function statusDot(status: TaskStatus): string {
  return STATUS_STYLE[status]?.dot ?? "bg-fg-4";
}

export function StatusBadge({ status, size = "sm" }: { status: TaskStatus; size?: "sm" | "md" }) {
  const { label } = useT();
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.cancelled;
  return (
    <span className={cx(pill, s.pill, size === "md" && "px-2.5 py-1 text-[13px]")}>
      <span className={cx("size-1.5 rounded-full", s.dot)} aria-hidden />
      {label("status", status)}
    </span>
  );
}

/** Overdue is a derived flag shown next to the status, never a status of its own. */
export function OverdueBadge({ detail }: { detail?: string }) {
  const { t } = useT();
  return (
    <span
      className={cx(pill, "bg-danger text-white ring-danger")}
      title={detail ? `${t("badge.overdue")} · ${detail}` : t("badge.overdue")}
    >
      <Clock className="size-3" aria-hidden />
      {t("badge.overdue")}
    </span>
  );
}

export function StatusWithOverdue({ status, overdue }: { status: TaskStatus; overdue: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge status={status} />
      {overdue ? <OverdueBadge /> : null}
    </span>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  P1: "bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-300",
  P2: "bg-orange-500/10 text-orange-700 ring-orange-500/25 dark:text-orange-300",
  P3: "bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300",
  P4: "bg-surface-3 text-fg-3 ring-line",
};

/** Priority flag: P1 red with a pulse, P2 orange, P3 blue, P4 grey. */
export function PriorityBadge({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  const { label } = useT();
  const full = label("priority", priority);
  return (
    <span className={cx(pill, "gap-1 rounded-md px-1.5 tabular-nums", PRIORITY_STYLE[priority])} title={full}>
      {priority === "P1" ? (
        <span className="relative flex size-3 items-center justify-center" aria-hidden>
          <span className="absolute size-1.5 animate-pulse-ring rounded-full bg-red-500" />
          <Flag className="size-3" />
        </span>
      ) : (
        <Flag className="size-3" aria-hidden />
      )}
      {withLabel ? full : priority}
    </span>
  );
}

/** Truck unit with a truck icon; an unmatched number (not in the fleet list) is dashed. */
export function TruckChip({ unit, unmatched, title }: { unit: string; unmatched?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
        unmatched ? "border border-dashed border-line-strong text-fg-3" : "bg-surface-3 text-fg-2",
      )}
    >
      <Truck className="size-3.5 text-fg-3" aria-hidden />
      {unit}
      {unmatched ? "?" : null}
    </span>
  );
}

const SOURCE_STYLE: Record<TaskSource, string> = {
  ai: "bg-ai-soft text-ai-text ring-ai/20",
  manual: "bg-surface-3 text-fg-2 ring-line",
  telegram_command: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
};
const SOURCE_ICON: Record<TaskSource, ReactNode> = {
  ai: <Sparkles className="size-3" aria-hidden />,
  manual: <Pencil className="size-3" aria-hidden />,
  telegram_command: <Send className="size-3" aria-hidden />,
};

export function SourceBadge({ source, iconOnly }: { source: TaskSource; iconOnly?: boolean }) {
  const { label } = useT();
  const text = label("source", source);
  return (
    <span className={cx(pill, "relative gap-1 rounded-md px-1.5", SOURCE_STYLE[source] ?? SOURCE_STYLE.manual)} title={iconOnly ? text : undefined}>
      {SOURCE_ICON[source]}
      {iconOnly ? <span className="sr-only">{text}</span> : text}
    </span>
  );
}

/** AI confidence: a thin meter on a same-hue track plus the figure. */
export function Confidence({ value, compact, wide }: { value: number | null; compact?: boolean; wide?: boolean }) {
  const { t, locale } = useT();
  if (value === null || value === undefined) return <span className="text-xs text-fg-4">—</span>;
  const pct = Math.max(0, Math.min(1, value));
  const text = formatPercent(value, locale);
  return (
    <span className="inline-flex items-center gap-1.5" title={t("badge.confidence_title", { pct: text })}>
      {!compact ? <span className="text-xs text-fg-3">{t("badge.confidence")}</span> : null}
      <span className={cx("relative inline-block h-1.5 overflow-hidden rounded-full bg-viz-1-soft/35", wide ? "w-24" : "w-10")} aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-viz-1" style={{ width: `${pct * 100}%` }} />
      </span>
      <span className="text-xs font-medium tabular-nums text-fg">{text}</span>
    </span>
  );
}

export function RelationBadge({ relation }: { relation: string }) {
  const { label } = useT();
  return (
    <span
      className={cx(
        pill,
        "rounded-md px-1.5 py-px text-[11px]",
        relation === "source" ? "bg-accent-soft text-accent-text ring-accent/20" : "bg-surface-3 text-fg-3 ring-line",
      )}
    >
      {label("relation", relation)}
    </span>
  );
}

export function BotStatusBadge({ status }: { status: BotMembership }) {
  const { t, label } = useT();
  const gone = status === "left" || status === "kicked";
  return (
    <span className={cx(pill, "gap-1 rounded-md px-1.5", gone ? "bg-warning-soft text-warning-text ring-warning/30" : "bg-surface-3 text-fg-3 ring-line")}>
      {gone ? <TriangleAlert className="size-3" aria-hidden /> : <Bot className="size-3" aria-hidden />}
      {t("badge.bot", { status: label("bot", status) })}
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-fg-4">{children}</span>;
}
