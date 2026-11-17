"use client";

import { Camera, ChevronDown, ChevronRight, Clock, Flame, Mic, Truck as TruckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { errorMessage, paths } from "@/lib/api";
import { useFmt } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import type { I18n } from "@/lib/i18n";
import type { Reference } from "@/lib/reference";
import { plainDue } from "@/lib/stage";
import type { TaskDetailOut, TaskOut } from "@/lib/types";
import { Avatar } from "../avatars";
import { Skeleton, cx, focusRing } from "../ui";
import { SimpleActions } from "./Actions";
import { StagePill } from "./parts";

/** "125-mashina" / "Машина 125" / "Truck 125", or null when the task names no truck. */
export function truckLabel(task: Pick<TaskOut, "truck" | "truck_unit_raw">, t: I18n["t"]): string | null {
  const unit = task.truck?.unit_number ?? task.truck_unit_raw;
  return unit ? t("s.truck", { unit }) : null;
}

export function TruckTag({ task }: { task: Pick<TaskOut, "truck" | "truck_unit_raw"> }) {
  const { t } = useFmt();
  const label = truckLabel(task, t);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-3 px-2 py-1 text-sm font-semibold tabular-nums text-fg">
      <TruckIcon className="size-4 text-fg-3" aria-hidden />
      {label}
    </span>
  );
}

/** Priority is only shown when it matters: P1 gets a red "Urgent" tag, nothing else. */
export function UrgentTag() {
  const { t } = useFmt();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
      <Flame className="size-3.5" aria-hidden />
      {t("s.urgent")}
    </span>
  );
}

/** The Telegram message the task came from, quoted in one or two lines. */
export function SourceQuote({ task }: { task: TaskDetailOut }) {
  const { t } = useFmt();
  const msg = task.messages.find((m) => m.relation === "source") ?? task.messages[0];
  const text = msg?.text || msg?.transcript || task.source_text;
  const photo = msg?.attachments.some((a) => a.kind === "photo" || (a.mime_type ?? "").startsWith("image/"));
  const voice = msg && (msg.kind === "voice" || msg.kind === "audio");
  if (!msg && !text) return null;
  return (
    <figure className="rounded-xl border-l-4 border-sky-400 bg-sky-500/8 px-3 py-2">
      <blockquote className="line-clamp-2 text-[15px] leading-snug text-fg">
        {text ? `“${text}”` : <span className="text-fg-3">{t("s.msg_no_text")}</span>}
      </blockquote>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-3">
        {msg ? <span className="font-medium text-fg-2">{msg.sender_name}</span> : null}
        {msg ? <span className="truncate">{msg.group.title}</span> : null}
        {photo ? (
          <span className="inline-flex items-center gap-1">
            <Camera className="size-3.5" aria-hidden />
            {t("s.has_photo")}
          </span>
        ) : null}
        {voice ? (
          <span className="inline-flex items-center gap-1">
            <Mic className="size-3.5" aria-hidden />
            {t("s.has_voice")}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * Big task card. Collapsed it shows stage, deadline, title, truck and person; opening it loads the
 * task (quote + buttons need the detail) and shows the big buttons.
 */
export function TaskCard({
  task,
  refData,
  defaultOpen,
  readOnly,
  onChanged,
}: {
  task: TaskOut;
  refData: Reference;
  defaultOpen?: boolean;
  readOnly?: boolean;
  onChanged?: (next: TaskDetailOut) => void;
}) {
  const f = useFmt();
  const { t } = f;
  const now = useNow(60000);
  const [open, setOpen] = useState(!!defaultOpen);
  const detail = useApi<TaskDetailOut>(open ? paths.task(task.id) : null);
  const d = detail.data;
  const cur: TaskOut = d ?? task;
  const due = plainDue(cur.due_at, cur.status, now, f.tz, f.locale, t);

  return (
    <article className={cx("rounded-2xl border bg-surface shadow-card transition-colors", due.late ? "border-danger/40" : "border-line")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx("block w-full rounded-2xl p-4 text-left", focusRing)}
      >
        <span className="flex flex-wrap items-center gap-2">
          <StagePill status={cur.status} />
          {cur.priority === "P1" ? <UrgentTag /> : null}
          <span className={cx("ml-auto inline-flex items-center gap-1 text-[15px] font-semibold", due.late ? "text-danger-text" : "text-fg-2")}>
            <Clock className="size-4" aria-hidden />
            {due.text}
          </span>
        </span>
        <span className="mt-2.5 block text-lg font-semibold leading-snug text-fg">{f.title(cur)}</span>
        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-fg-2">
          <TruckTag task={cur} />
          {cur.assignee ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={cur.assignee.full_name} size="sm" />
              {cur.assignee.full_name}
            </span>
          ) : (
            <span className="text-fg-3">{t("s.nobody")}</span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-fg-4">
            {cur.code}
            <ChevronDown className={cx("size-5 transition-transform", open && "rotate-180")} aria-hidden />
          </span>
        </span>
      </button>
      {open ? (
        <div className="animate-fade-in space-y-3 border-t border-line px-4 pb-4 pt-3">
          {!d && detail.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          ) : null}
          {detail.error && !d ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">{errorMessage(detail.error)}</p> : null}
          {d ? (
            <>
              <SourceQuote task={d} />
              {d.status === "blocked" && d.blocked_reason ? (
                <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
                  <span className="font-semibold">{t("s.waiting_for")} </span>
                  {d.blocked_reason}
                </p>
              ) : null}
              {readOnly ? null : (
                <SimpleActions
                  key={d.status}
                  task={d}
                  refData={refData}
                  onChanged={(next) => {
                    detail.setData(next);
                    onChanged?.(next);
                  }}
                />
              )}
            </>
          ) : null}
          <Link
            href={`/tasks/${task.id}`}
            className={cx("inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-accent-text hover:underline", focusRing)}
          >
            {t("s.open_task")}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      ) : null}
    </article>
  );
}
