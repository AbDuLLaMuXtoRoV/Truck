"use client";

/** Shared CRM helpers: department names, live response clocks, issue sources. */

import { formatDuration } from "./format";
import type { I18n, Key } from "./i18n";
import type { ClockOut, TaskCategory, TaskOut, TaskStatus } from "./types";

/** Department names as the blueprint writes them ("ELD / Compliance"); unknown codes keep their own name. */
const DEPT_KEY: Record<string, Key> = {
  DISPATCH: "crm.dept.DISPATCH",
  ACCOUNTING: "crm.dept.ACCOUNTING",
  ELD: "crm.dept.ELD",
  FLEET: "crm.dept.FLEET",
  TRAILER: "crm.dept.TRAILER",
  SAFETY: "crm.dept.SAFETY",
  HR: "crm.dept.HR",
};

export function deptLabel(dept: { code: string; name: string } | null | undefined, t: I18n["t"]): string {
  if (!dept) return t("dept.unrouted");
  const key = DEPT_KEY[dept.code.toUpperCase()];
  return key ? t(key) : dept.name;
}

/** Seconds left on a reply clock at `now` (negative once overdue). */
export function clockSecondsLeft(clock: Pick<ClockOut, "due_at">, now: number): number {
  return Math.round((Date.parse(clock.due_at) - now) / 1000);
}

/** 04:59, 00:07, -01:12 → "+01:12" (overdue), 1:02:03 for an hour or more. */
export function formatCountdown(seconds: number): string {
  const over = seconds < 0;
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  const body = h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  return over ? `+${body}` : body;
}

/** Response time in words: "45 s", "4m", "1h 10m". */
export function formatResponse(seconds: number | null | undefined, t: I18n["t"]): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return t("crm.secs", { n: Math.max(0, Math.round(seconds)) });
  return formatDuration(seconds * 1000, t);
}

/** "Telegram – Dispatch Group" or the mailbox address. */
export function issueSource(task: Pick<TaskOut, "source_channel" | "mailbox" | "group">, t: I18n["t"]): string | null {
  if (task.source_channel === "email" && task.mailbox) return t("crm.source_gmail", { name: task.mailbox.email_address });
  if (task.group) return t("crm.source_telegram", { name: task.group.title });
  if (task.source_channel === "email") return t("crm.channel_email");
  if (task.source_channel === "telegram") return t("crm.channel_telegram");
  return null;
}

/** The transition behind "Mark as resolved": straight to Resolved, or to "pending approval". */
export function resolveTarget(allowed: TaskStatus[]): TaskStatus | null {
  if (allowed.includes("completed")) return "completed";
  if (allowed.includes("pending_verification")) return "pending_verification";
  return null;
}

export const OPEN_STATUSES: TaskStatus[] = ["detected", "needs_review", "assigned", "in_progress", "blocked", "pending_verification"];

export function isReopened(task: Pick<TaskOut, "reopen_count" | "status">): boolean {
  return task.reopen_count > 0 && OPEN_STATUSES.includes(task.status);
}

/** Readable issue type: the free-text issue_type ("lumper_fee" → "Lumper fee") or the category label. */
export function issueTypeLabel(task: Pick<TaskOut, "issue_type" | "category">, label: I18n["label"]): string {
  if (task.issue_type) {
    const s = task.issue_type.replace(/[_-]+/g, " ").trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return label("category", task.category);
}

export const CATEGORY_TONE: Record<TaskCategory, string> = {
  eld: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  dispatch: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
  fleet_maintenance: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
  accounting: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  documents: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
  safety_compliance: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  hr: "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300",
  trailer: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  other: "bg-surface-3 text-fg-2",
};
