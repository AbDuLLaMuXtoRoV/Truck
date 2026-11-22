"use client";

import {
  AlertOctagon,
  CircleDot,
  Container,
  DollarSign,
  FileText,
  Hand,
  Mail,
  MonitorSmartphone,
  RotateCcw,
  Route,
  Send,
  ShieldAlert,
  Timer,
  UserRound,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { CATEGORY_TONE, clockSecondsLeft, deptLabel, formatCountdown, formatResponse } from "@/lib/crm";
import { useFmt } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import type { ClockOut, DepartmentRef, EscalationKind, Source, TaskCategory, TaskOut } from "@/lib/types";
import { cx } from "../ui";

// --------------------------------------------------------------------------- live reply clock

/** Live mm:ss until the 5-minute reply deadline (red), "+mm:ss" once overdue; answered / not needed otherwise. */
export function CountdownPill({ clock, size = "sm" }: { clock: ClockOut; size?: "sm" | "md" }) {
  const { t } = useFmt();
  const now = useNow(1000);
  const pad = size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  if (clock.status === "answered") {
    return (
      <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-success-soft font-medium text-success-text", pad)}>
        {t("crm.answered_in", { d: formatResponse(clock.response_seconds, t) })}
      </span>
    );
  }
  if (clock.status === "not_needed") {
    return (
      <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-3 font-medium text-fg-3", pad)} title={clock.closed_reason ?? undefined}>
        {t("crm.no_reply_needed")}
      </span>
    );
  }
  const left = clockSecondsLeft(clock, now);
  const over = left < 0;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold tabular-nums",
        pad,
        over ? "bg-red-600 text-white" : "bg-red-500/12 text-red-700 ring-1 ring-inset ring-red-500/30 dark:text-red-300",
        clock.critical && "outline outline-2 outline-offset-1 outline-red-500",
      )}
      title={over ? t("crm.reply_overdue_by", { d: formatCountdown(-left) }) : t("crm.reply_due_in", { d: formatCountdown(left) })}
    >
      {over ? <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> : <Timer className="size-3.5" aria-hidden />}
      {formatCountdown(left)}
      <span className="sr-only">{over ? t("crm.overdue") : t("crm.left")}</span>
    </span>
  );
}

/** Response column: live countdown when we know the clock, otherwise the plain state; "—" once answered. */
export function ResponseCell({
  task,
  clock,
}: {
  task: Pick<TaskOut, "response_status"> & Partial<Pick<TaskOut, "response_due_at" | "response_critical">>;
  clock?: ClockOut | null;
}) {
  const { t } = useFmt();
  if (clock && clock.status === "pending") return <CountdownPill clock={clock} />;
  if (task.response_due_at && (task.response_status === "unanswered" || task.response_status === "overdue")) {
    // The issue carries its own earliest reply deadline, so every row can count down live.
    return (
      <CountdownPill
        clock={{
          id: "",
          status: "pending",
          started_at: task.response_due_at,
          due_at: task.response_due_at,
          seconds_left: 0,
          level: 0,
          critical: Boolean(task.response_critical),
          answered_at: null,
          answered_by_name: null,
          response_seconds: null,
          closed_reason: null,
        }}
      />
    );
  }
  if (task.response_status === "overdue") {
    return <span className="inline-flex whitespace-nowrap rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{t("crm.resp_overdue")}</span>;
  }
  if (task.response_status === "unanswered") {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-red-500/12 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-500/30 dark:text-red-300">
        {t("crm.resp_waiting")}
      </span>
    );
  }
  return (
    <span className="text-fg-4" aria-label={task.response_status === "answered" ? t("crm.resp_answered") : t("crm.resp_none")}>
      —
    </span>
  );
}

// --------------------------------------------------------------------------- icons and pills

export function ChannelIcon({ source, className }: { source: Source; className?: string }) {
  const { t } = useFmt();
  return source === "email" ? (
    <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-300", className)} title={t("crm.channel_email")}>
      <Mail className="size-4" aria-hidden />
      <span className="sr-only">{t("crm.channel_email")}</span>
    </span>
  ) : (
    <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-500/12 text-sky-600 dark:text-sky-300", className)} title={t("crm.channel_telegram")}>
      <Send className="size-4" aria-hidden />
      <span className="sr-only">{t("crm.channel_telegram")}</span>
    </span>
  );
}

const CATEGORY_ICON: Record<TaskCategory, ReactNode> = {
  eld: <MonitorSmartphone />,
  dispatch: <Route />,
  fleet_maintenance: <Wrench />,
  accounting: <DollarSign />,
  documents: <FileText />,
  safety_compliance: <ShieldAlert />,
  hr: <UserRound />,
  trailer: <Container />,
  other: <CircleDot />,
};

export function IssueIcon({ category, className }: { category: TaskCategory; className?: string }) {
  return (
    <span className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", CATEGORY_TONE[category] ?? CATEGORY_TONE.other, className)} aria-hidden>
      {CATEGORY_ICON[category] ?? CATEGORY_ICON.other}
    </span>
  );
}

export function DeptPill({ dept }: { dept: DepartmentRef | null }) {
  const { t } = useFmt();
  return (
    <span className="inline-flex max-w-full items-center truncate whitespace-nowrap rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-fg-2">
      {deptLabel(dept, t)}
    </span>
  );
}

export function ReopenedBadge() {
  const { t } = useFmt();
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-orange-500/12 px-2 py-0.5 text-xs font-semibold text-orange-700 ring-1 ring-inset ring-orange-500/25 dark:text-orange-300">
      <RotateCcw className="size-3" aria-hidden />
      {t("crm.reopened")}
    </span>
  );
}

// --------------------------------------------------------------------------- escalation level

const LEVEL: Record<EscalationKind, { key: Key; cls: string; icon: ReactNode }> = {
  reminder: { key: "crm.lvl.reminder", cls: "bg-amber-500/15 text-amber-800 ring-amber-500/30 dark:text-amber-300", icon: <Timer /> },
  overdue: { key: "crm.lvl.overdue", cls: "bg-orange-500/15 text-orange-800 ring-orange-500/30 dark:text-orange-300", icon: <Timer /> },
  escalated: { key: "crm.lvl.escalated", cls: "bg-red-500/12 text-red-700 ring-red-500/30 dark:text-red-300", icon: <AlertOctagon /> },
  critical: { key: "crm.lvl.critical", cls: "bg-red-600 text-white ring-red-700", icon: <AlertOctagon /> },
  manual: { key: "crm.lvl.manual", cls: "bg-violet-500/12 text-violet-700 ring-violet-500/30 dark:text-violet-300", icon: <Hand /> },
};

export function LevelBadge({ kind }: { kind: EscalationKind }) {
  const { t } = useFmt();
  const l = LEVEL[kind] ?? LEVEL.manual;
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset [&_svg]:size-3.5", l.cls)}>
      {l.icon}
      {t(l.key)}
    </span>
  );
}

/** Small "Telegram" / "Gmail" text tag. */
export function SourceTag({ source }: { source: Source }) {
  const { t } = useFmt();
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-semibold",
        source === "email" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-sky-500/10 text-sky-700 dark:text-sky-300",
      )}
    >
      {source === "email" ? t("crm.channel_email") : t("crm.channel_telegram")}
    </span>
  );
}
