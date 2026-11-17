"use client";

/** Locale-aware formatting (dates in the company time zone, numbers, relative times) and task text helpers. */

import { useMemo } from "react";
import { useAuth } from "./auth";
import { useT, type I18n, type Key, type Lang } from "./i18n";
import type { TaskOut, TaskStatus } from "./types";
import { OPEN_STATUSES } from "./types";

// --------------------------------------------------------------------------- task status helpers

export function isOpenStatus(s: TaskStatus): boolean {
  return OPEN_STATUSES.includes(s);
}

/** Mirrors domain/task_state.reason_required. */
export function reasonRequired(from: TaskStatus, to: TaskStatus): boolean {
  return (
    to === "blocked" ||
    to === "cancelled" ||
    (from === "completed" && to === "in_progress") ||
    (from === "pending_verification" && to === "in_progress")
  );
}

/** Dictionary key of the button label for a status change, depending on where the task comes from. */
export function transitionKey(from: TaskStatus, to: TaskStatus): Key {
  switch (to) {
    case "needs_review":
      if (from === "cancelled") return "tr.restore";
      if (from === "detected") return "tr.send_to_review";
      return "tr.return_to_review";
    case "assigned":
      return from === "detected" || from === "needs_review" ? "tr.approve_assign" : "tr.back_to_assigned";
    case "in_progress":
      if (from === "blocked") return "tr.unblock";
      if (from === "pending_verification") return "tr.reject_verification";
      if (from === "completed") return "tr.reopen";
      return "tr.start";
    case "blocked":
      return "tr.block";
    case "pending_verification":
      return "tr.submit_verification";
    case "completed":
      return "tr.complete";
    case "cancelled":
      return "tr.cancel";
    default:
      return "tr.move";
  }
}

/** Display order for transition buttons: forward progress first, exits last. */
const TRANSITION_ORDER: TaskStatus[] = [
  "assigned",
  "in_progress",
  "pending_verification",
  "completed",
  "needs_review",
  "blocked",
  "detected",
  "cancelled",
];

export function sortTransitions(from: TaskStatus, list: TaskStatus[]): TaskStatus[] {
  const rank = (s: TaskStatus) => {
    // a rejection / reopen is not "forward progress"
    if (s === "in_progress" && (from === "pending_verification" || from === "completed")) return 50;
    return TRANSITION_ORDER.indexOf(s);
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

// --------------------------------------------------------------------------- task text (AI translations)

/** Title in the user's language when the AI provided one, else the original. */
export function taskTitle(task: Pick<TaskOut, "title" | "i18n">, lang: Lang): string {
  return task.i18n?.[lang]?.title?.trim() || task.title;
}

/** Summary in the user's language when available, else the original description. */
export function taskSummary(task: Pick<TaskOut, "description" | "i18n">, lang: Lang): string | null {
  return task.i18n?.[lang]?.summary?.trim() || task.description;
}

// --------------------------------------------------------------------------- numbers

export function formatCount(n: number, locale: string): string {
  if (Math.abs(n) < 10000) return n.toLocaleString(locale);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatPercent(fraction: number | null | undefined, locale: string): string {
  if (fraction === null || fraction === undefined) return "—";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(fraction);
}

export function formatBytes(n: number | null | undefined, t: I18n["t"], locale: string): string {
  if (!n && n !== 0) return "";
  const num = (v: number, d = 0) => v.toLocaleString(locale, { maximumFractionDigits: d });
  if (n < 1024) return t("unit.bytes", { n: num(n) });
  if (n < 1024 * 1024) return t("unit.kb", { n: num(n / 1024) });
  return t("unit.mb", { n: num(n / 1024 / 1024, 1) });
}

export function formatSeconds(s: number | null | undefined): string {
  if (!s && s !== 0) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// --------------------------------------------------------------------------- dates (company time zone)

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${tz}|${JSON.stringify(opts)}`;
  let f = formatterCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz });
    } catch {
      f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" });
    }
    formatterCache.set(key, f);
  }
  return f;
}

const DATE_TIME: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
};
const DATE_TIME_YEAR: Intl.DateTimeFormatOptions = { ...DATE_TIME, year: "numeric" };
const TIME_ONLY: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const DATE_ONLY: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
const YMD: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
};

/** Numeric date parts in `tz` (always computed with en-US so the digits are ASCII). */
function parts(date: Date, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of formatter("en-US", tz, YMD).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** "Nov 15, 14:05" (or "15-noy, 14:05" / "15 нояб., 14:05") in the company time zone; year added when not the current year. */
export function formatDateTime(iso: string | null | undefined, tz: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = parts(d, tz).year === parts(new Date(), tz).year;
  return formatter(locale, tz, sameYear ? DATE_TIME : DATE_TIME_YEAR).format(d);
}

export function formatTime(iso: string | null | undefined, tz: string, locale: string): string {
  if (!iso) return "—";
  return formatter(locale, tz, TIME_ONLY).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, tz: string, locale: string): string {
  if (!iso) return "—";
  return formatter(locale, tz, DATE_ONLY).format(new Date(iso));
}

/** Short time-zone name such as "CST" (US abbreviations are what the team uses). */
export function tzAbbreviation(tz: string): string {
  const p = formatter("en-US", tz, { timeZoneName: "short", hour: "numeric" })
    .formatToParts(new Date())
    .find((x) => x.type === "timeZoneName");
  return p?.value ?? tz;
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** ISO instant -> "YYYY-MM-DDTHH:mm" wall time in `tz` (value for <input type="datetime-local">). */
export function isoToZonedInput(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = parts(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour === 24 ? 0 : p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:mm" wall time in `tz` -> ISO instant (UTC). */
export function zonedInputToIso(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let ts = guess - off1;
  const off2 = tzOffsetMs(new Date(ts), tz);
  if (off2 !== off1) ts = guess - off2;
  return new Date(ts).toISOString();
}

// --------------------------------------------------------------------------- relative times

/** Compact duration: "45m", "2h 10m", "5h", "1d 4h", "6d" (units translated). */
export function formatDuration(ms: number, t: I18n["t"]): string {
  const totalMin = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (totalMin < 1) return t("dur.lt_minute");
  if (totalMin < 60) return t("dur.m", { m: totalMin });
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return h < 6 && m ? t("dur.hm", { h, m }) : t("dur.h", { h });
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d < 3 && rh ? t("dur.dh", { d, h: rh }) : t("dur.d", { d });
}

export interface RelativeDue {
  text: string;
  overdue: boolean;
}

/** "in 2h" / "3h overdue" relative to `now`. */
export function relativeDue(iso: string | null | undefined, now: number, t: I18n["t"]): RelativeDue | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return null;
  if (Math.abs(diff) < 60000) return { text: t("rel.due_now"), overdue: diff < 0 };
  return diff > 0
    ? { text: t("rel.in", { d: formatDuration(diff, t) }), overdue: false }
    : { text: t("rel.overdue", { d: formatDuration(diff, t) }), overdue: true };
}

/** "5m ago", "just now". */
export function timeAgo(iso: string | null | undefined, now: number, t: I18n["t"]): string {
  if (!iso) return "—";
  const diff = now - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  if (diff < 60000) return t("rel.just_now");
  return t("rel.ago", { d: formatDuration(diff, t) });
}

/** "Akmal Karimov (@akmal_125)" -> "AK": letters only, handles and brackets ignored. */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)|@\S+/g, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  const letter = (w?: string) => w?.match(/\p{L}/u)?.[0] ?? "";
  return (letter(words[0]) + (words.length > 1 ? letter(words[words.length - 1]) : "")).toUpperCase() || "?";
}

// --------------------------------------------------------------------------- hook

/** Everything a screen needs to print text: translations, enum labels, dates in the company zone, numbers. */
export function useFmt() {
  const i18n = useT();
  const { tz } = useAuth();
  return useMemo(() => {
    const { t, locale, lang, label } = i18n;
    return {
      ...i18n,
      tz,
      dateTime: (iso: string | null | undefined) => formatDateTime(iso, tz, locale),
      time: (iso: string | null | undefined) => formatTime(iso, tz, locale),
      date: (iso: string | null | undefined) => formatDate(iso, tz, locale),
      relDue: (iso: string | null | undefined, now: number) => relativeDue(iso, now, t),
      ago: (iso: string | null | undefined, now: number) => timeAgo(iso, now, t),
      count: (n: number) => formatCount(n, locale),
      percent: (x: number | null | undefined) => formatPercent(x, locale),
      bytes: (n: number | null | undefined) => formatBytes(n, t, locale),
      status: (s: string) => label("status", s),
      category: (c: string) => label("category", c),
      priority: (p: string) => label("priority", p),
      role: (r: string) => label("role", r),
      source: (s: string) => label("source", s),
      title: (task: Pick<TaskOut, "title" | "i18n">) => taskTitle(task, lang),
      summary: (task: Pick<TaskOut, "description" | "i18n">) => taskSummary(task, lang),
    };
  }, [i18n, tz]);
}

export type Fmt = ReturnType<typeof useFmt>;
