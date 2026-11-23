"use client";

/** The whole UI kit: a few plain building blocks with ordinary colours. */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { LANGS, LANG_NAMES, isLang, type Lang } from "@/lib/i18n";
import type { TaskOut, TaskStatus } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// --------------------------------------------------------------------------- buttons

type Variant = "blue" | "green" | "red" | "white";

const VARIANTS: Record<Variant, string> = {
  blue: "bg-blue-600 text-white hover:bg-blue-700",
  green: "bg-green-600 text-white hover:bg-green-700",
  red: "bg-white text-red-700 border border-red-300 hover:bg-red-50",
  white: "bg-white text-gray-800 border border-gray-300 hover:bg-gray-50",
};

export function Button({
  variant = "blue",
  big = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; big?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-semibold transition-colors disabled:opacity-50",
        big ? "min-h-12 px-5 text-base" : "min-h-10 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200";

// --------------------------------------------------------------------------- blocks

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-gray-200 bg-white", className)}>{children}</div>;
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      {subtitle && <p className="mt-1 text-gray-600">{subtitle}</p>}
    </div>
  );
}

export function Loading({ text }: { text: string }) {
  return <p className="py-10 text-center text-gray-500">{text}</p>;
}

export function Empty({ text }: { text: string }) {
  return (
    <Card className="px-4 py-12 text-center text-lg text-gray-500">
      <p>{text}</p>
    </Card>
  );
}

export function ErrorBox({ error, onRetry, retryLabel }: { error: unknown; onRetry?: () => void; retryLabel?: string }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
      <span className="flex-1">{errorMessage(error)}</span>
      {onRetry && retryLabel && (
        <Button variant="white" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- tags

type TagColor = "blue" | "yellow" | "purple" | "green" | "gray" | "red";

const TAGS: Record<TagColor, string> = {
  blue: "bg-blue-100 text-blue-800",
  yellow: "bg-yellow-100 text-yellow-800",
  purple: "bg-purple-100 text-purple-800",
  green: "bg-green-100 text-green-800",
  gray: "bg-gray-100 text-gray-700",
  red: "bg-red-100 text-red-800",
};

export function Tag({ color, children }: { color: TagColor; children: ReactNode }) {
  return <span className={cx("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", TAGS[color])}>{children}</span>;
}

// --------------------------------------------------------------------------- stages

/** The four simple steps an issue goes through (plus closed). */
export type Stage = "new" | "doing" | "check" | "done" | "cancelled";

export const STAGE_STATUSES: Record<Exclude<Stage, "cancelled">, TaskStatus[]> = {
  new: ["detected", "needs_review"],
  doing: ["assigned", "in_progress", "blocked"],
  check: ["pending_verification"],
  done: ["completed"],
};

export function stageOf(status: TaskStatus): Stage {
  if (status === "cancelled") return "cancelled";
  for (const [stage, list] of Object.entries(STAGE_STATUSES)) {
    if (list.includes(status)) return stage as Stage;
  }
  return "new";
}

export const STAGE_COLOR: Record<Stage, TagColor> = {
  new: "blue",
  doing: "yellow",
  check: "purple",
  done: "green",
  cancelled: "gray",
};

// --------------------------------------------------------------------------- formatting

/** Title in the reader's language when the AI translated it. */
export function taskTitle(task: Pick<TaskOut, "title" | "i18n">, lang: Lang): string {
  return task.i18n?.[lang]?.title || task.title;
}

/** "5 minutes ago" / "in 2 hours". */
export function timeAgo(iso: string, locale: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

/** "12 Nov, 14:05" in the company time zone. */
export function dateTime(iso: string, locale: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString(locale);
  }
}

/** "7 minutes" / "1 hour". */
export function duration(seconds: number, locale: string): string {
  const s = Math.max(0, seconds);
  const [value, unit] = s < 3600 ? [Math.max(1, Math.floor(s / 60)), "minute"] : s < 86400 ? [Math.floor(s / 3600), "hour"] : [Math.floor(s / 86400), "day"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
}

// --------------------------------------------------------------------------- language select

export function LanguageSelect({ value, onChange, className }: { value: Lang; onChange: (lang: Lang) => void; className?: string }) {
  return (
    <select
      aria-label="Language / Til / Язык"
      value={value}
      onChange={(e) => isLang(e.target.value) && onChange(e.target.value)}
      className={cx("rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800", className)}
    >
      {LANGS.map((l) => (
        <option key={l} value={l}>
          {LANG_NAMES[l]}
        </option>
      ))}
    </select>
  );
}
