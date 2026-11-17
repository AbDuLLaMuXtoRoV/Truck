"use client";

import { AlarmClock, Clock } from "lucide-react";
import { isOpenStatus, useFmt } from "@/lib/format";
import type { TaskStatus } from "@/lib/types";
import { cx } from "./ui";

export type DueTone = "overdue" | "soon" | "ok" | "closed" | "none";

/** Where a task stands in its SLA window: share of time elapsed and a tone for colour. */
export function dueState(createdAt: string, dueAt: string | null, status: TaskStatus, now: number) {
  if (!dueAt) return { tone: "none" as DueTone, elapsed: 0, remaining: 0 };
  const start = new Date(createdAt).getTime();
  const end = new Date(dueAt).getTime();
  const span = Math.max(1, end - start);
  const elapsed = Math.max(0, Math.min(1, (now - start) / span));
  const remaining = end - now;
  if (!isOpenStatus(status)) return { tone: "closed" as DueTone, elapsed, remaining };
  if (remaining < 0) return { tone: "overdue" as DueTone, elapsed: 1, remaining };
  if (elapsed >= 0.75) return { tone: "soon" as DueTone, elapsed, remaining };
  return { tone: "ok" as DueTone, elapsed, remaining };
}

const TONE: Record<DueTone, string> = {
  overdue: "bg-danger-soft text-danger-text ring-danger/25",
  soon: "bg-warning-soft text-warning-text ring-warning/30",
  ok: "bg-surface-3 text-fg-2 ring-line",
  closed: "bg-transparent text-fg-3 ring-transparent",
  none: "bg-transparent text-fg-4 ring-transparent",
};

/** Coloured countdown: "3h overdue" (red), "in 40m" near the deadline (amber), "in 2d" (neutral). */
export function DueChip({
  createdAt,
  dueAt,
  status,
  now,
  showDate,
}: {
  createdAt: string;
  dueAt: string | null;
  status: TaskStatus;
  now: number;
  showDate?: boolean;
}) {
  const f = useFmt();
  if (!dueAt) return <span className="text-xs text-fg-4">—</span>;
  const s = dueState(createdAt, dueAt, status, now);
  const rel = s.tone === "closed" ? null : f.relDue(dueAt, now);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {rel ? (
        <span
          className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset tabular-nums", TONE[s.tone])}
          title={f.dateTime(dueAt)}
        >
          {s.tone === "overdue" ? <AlarmClock className="size-3" aria-hidden /> : <Clock className="size-3" aria-hidden />}
          {rel.text}
        </span>
      ) : null}
      {showDate || !rel ? <span className="whitespace-nowrap text-[11px] text-fg-3">{f.dateTime(dueAt)}</span> : null}
    </span>
  );
}

const BAR: Record<DueTone, string> = {
  overdue: "bg-danger",
  soon: "bg-warning",
  ok: "bg-success",
  closed: "bg-fg-4",
  none: "bg-fg-4",
};

/** SLA progress from creation to due. */
export function SlaBar({ createdAt, dueAt, status, now }: { createdAt: string; dueAt: string | null; status: TaskStatus; now: number }) {
  const f = useFmt();
  const { t } = f;
  if (!dueAt) return <p className="text-sm text-fg-3">{t("sla.none")}</p>;
  const s = dueState(createdAt, dueAt, status, now);
  const rel = f.relDue(dueAt, now);
  const label =
    s.tone === "closed" ? t("sla.closed") : s.tone === "overdue" ? t("sla.overdue") : s.tone === "soon" ? t("sla.soon") : t("sla.on_track");
  const labelTone =
    s.tone === "overdue" ? "text-danger-text" : s.tone === "soon" ? "text-warning-text" : s.tone === "ok" ? "text-success-text" : "text-fg-3";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cx("text-sm font-semibold", labelTone)}>{label}</span>
        {rel && s.tone !== "closed" ? <span className="text-sm font-medium tabular-nums text-fg">{rel.text}</span> : null}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label={t("sla.title")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s.elapsed * 100)}
      >
        <div className={cx("h-full rounded-full transition-[width]", BAR[s.tone])} style={{ width: `${Math.max(2, s.elapsed * 100)}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-fg-3">
        <span>{f.dateTime(createdAt)}</span>
        <span>{f.dateTime(dueAt)}</span>
      </div>
    </div>
  );
}
