"use client";

/**
 * Simple-mode vocabulary: the 8 API statuses collapse into 4 plain stages. API values never change;
 * this is only how the simple UI talks about them.
 */

import { formatDuration, isoToZonedInput } from "./format";
import type { I18n } from "./i18n";
import type { TaskStatus } from "./types";

export type Stage = "new" | "doing" | "check" | "done" | "hidden";

export const STAGES: Exclude<Stage, "hidden">[] = ["new", "doing", "check", "done"];

export function stage(status: TaskStatus): Stage {
  switch (status) {
    case "detected":
    case "needs_review":
      return "new";
    case "assigned":
    case "in_progress":
    case "blocked":
      return "doing";
    case "pending_verification":
      return "check";
    case "completed":
      return "done";
    default:
      return "hidden";
  }
}

/** Deadline in plain words: "Today by 16:00", "Tomorrow by 09:00", "2h late", "by 20 Nov, 14:00". */
export function plainDue(
  dueAt: string | null,
  status: TaskStatus,
  now: number,
  tz: string,
  locale: string,
  t: I18n["t"],
): { text: string; late: boolean } {
  const s = stage(status);
  if (!dueAt || s === "done" || s === "hidden") return { text: t("s.due_none"), late: false };
  const left = new Date(dueAt).getTime() - now;
  if (left < 0) return { text: t("s.due_late", { d: formatDuration(-left, t) }), late: true };
  const day = (iso: string) => isoToZonedInput(iso, tz).slice(0, 10);
  const today = day(new Date(now).toISOString());
  const tomorrow = day(new Date(now + 86400000).toISOString());
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(dueAt));
  const d = day(dueAt);
  if (d === today) return { text: t("s.due_today", { time }), late: false };
  if (d === tomorrow) return { text: t("s.due_tomorrow", { time }), late: false };
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: tz }).format(new Date(dueAt));
  return { text: t("s.due_date", { date, time }), late: false };
}

/** Plain-language buttons the simple UI offers, in priority order (first allowed = primary). */
export type SimpleAction = "start" | "done" | "stuck" | "continue" | "assign" | "not_task" | "confirm" | "send_back";

export function simpleActions(status: TaskStatus, allowed: TaskStatus[]): SimpleAction[] {
  const can = (s: TaskStatus) => allowed.includes(s);
  const out: SimpleAction[] = [];
  switch (status) {
    case "detected":
    case "needs_review":
      if (can("assigned")) out.push("assign");
      if (can("cancelled")) out.push("not_task");
      break;
    case "assigned":
      if (can("in_progress")) out.push("start");
      if (can("pending_verification")) out.push("done");
      if (can("blocked")) out.push("stuck");
      break;
    case "in_progress":
      if (can("pending_verification")) out.push("done");
      if (can("blocked")) out.push("stuck");
      break;
    case "blocked":
      if (can("in_progress")) out.push("continue");
      break;
    case "pending_verification":
      if (can("completed")) out.push("confirm");
      if (can("in_progress")) out.push("send_back");
      break;
    default:
      break;
  }
  return out;
}
