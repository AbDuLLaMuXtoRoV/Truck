"use client";

import {
  ArrowRightLeft,
  BellRing,
  Bot,
  ExternalLink,
  GitMerge,
  Link2,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  Siren,
  Sparkles,
  UserPlus,
} from "lucide-react";
import type { ReactNode } from "react";
import { useFmt, type Fmt } from "@/lib/format";
import type { Reference } from "@/lib/reference";
import type { LinkedMessageOut, MessageOut, TaskEventOut, TaskStatus } from "@/lib/types";
import { AttachmentItem } from "./Attachment";
import { Avatar, hashOf } from "./avatars";
import { RelationBadge, StatusBadge } from "./badges";
import { cx } from "./ui";

// --------------------------------------------------------------------------- Telegram chat bubbles

/** Telegram-like sender name colours (readable in both themes). */
const NAME_COLOR = [
  "text-rose-600 dark:text-rose-400",
  "text-orange-600 dark:text-orange-400",
  "text-violet-600 dark:text-violet-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-cyan-700 dark:text-cyan-400",
  "text-blue-600 dark:text-blue-400",
  "text-fuchsia-600 dark:text-fuchsia-400",
];

export function MessageCard({ message, compact }: { message: MessageOut | LinkedMessageOut; compact?: boolean }) {
  const f = useFmt();
  const { t, label } = f;
  const relation = "relation" in message ? message.relation : null;
  const isAudio = message.kind === "voice" || message.kind === "audio";
  const nameColor = NAME_COLOR[hashOf(message.sender_name) % NAME_COLOR.length];
  return (
    <article className="flex items-end gap-2">
      <Avatar name={message.sender_name} size={compact ? "sm" : "md"} />
      <div className="min-w-0 max-w-full flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 text-[11px] text-fg-3">
          <span className="truncate">{message.group.title}</span>
          {message.kind !== "text" ? <span className="rounded bg-surface-3 px-1 py-px text-fg-2">{label("msgkind", message.kind)}</span> : null}
          {relation ? <RelationBadge relation={relation} /> : null}
        </div>
        <div
          className={cx(
            "relative w-fit max-w-full rounded-2xl rounded-bl-md border border-line bg-surface-2 shadow-xs",
            compact ? "px-3 py-2" : "px-3.5 py-2.5",
          )}
        >
          <div className={cx("text-[13px] font-semibold", nameColor)}>{message.sender_name}</div>
          {message.text ? <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">{message.text}</p> : null}
          {isAudio || message.transcript ? (
            <div className="mt-1.5 rounded-lg border-l-2 border-ai bg-ai-soft px-2.5 py-1.5 text-sm">
              <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ai-text">
                <Mic className="size-3" aria-hidden />
                {t("msg.transcript")}
              </span>
              {message.transcript ? (
                <span className="whitespace-pre-wrap break-words text-fg">{message.transcript}</span>
              ) : (
                <span className="text-fg-3">{label("transcript", message.transcript_status)}</span>
              )}
            </div>
          ) : null}
          {!message.text && !message.transcript && !isAudio && message.attachments.length === 0 ? (
            <p className="mt-0.5 text-sm text-fg-4">{t("msg.no_text")}</p>
          ) : null}
          {message.attachments.length ? (
            <div className="mt-2 flex flex-wrap items-start gap-1.5">
              {message.attachments.map((a) => (
                <AttachmentItem key={a.id} attachment={a} telegramLink={message.telegram_link} />
              ))}
            </div>
          ) : null}
          <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-fg-4">
            {message.edited_at ? <span>{t("msg.edited")}</span> : null}
            <span title={message.sent_at}>{f.dateTime(message.sent_at)}</span>
            {message.telegram_link ? (
              <a
                href={message.telegram_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-accent-text hover:underline"
              >
                {t("msg.open_in_telegram")}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

// --------------------------------------------------------------------------- timeline

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}

function describeChange(field: string, value: unknown, refData: Reference, f: Fmt): string {
  if (value === null || value === undefined || value === "") return f.t("event.value_none");
  const s = String(value);
  if (field === "department_id") return refData.departmentById.get(s)?.name ?? f.t("event.unknown_department");
  if (field === "truck_id") return refData.truckById.get(s)?.unit_number ?? f.t("event.unknown_truck");
  if (field === "category") return f.category(s);
  if (field === "priority") return f.priority(s);
  if (field === "due_at") return f.dateTime(s);
  if (s.length > 80) return `${s.slice(0, 77)}…`;
  return s;
}

function Transition({ from, to }: { from: TaskStatus | null; to: TaskStatus | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {from ? <StatusBadge status={from} /> : null}
      {from ? <span className="text-fg-4">→</span> : null}
      {to ? <StatusBadge status={to} /> : null}
    </span>
  );
}

function Quote({ children, plain }: { children: ReactNode; plain?: boolean }) {
  return (
    <p
      className={cx(
        "whitespace-pre-wrap break-words text-[13px]",
        plain ? "rounded-lg border border-line bg-surface px-3 py-2 text-fg shadow-xs" : "border-l-2 border-line-strong pl-2.5 text-fg-2",
      )}
    >
      {children}
    </p>
  );
}

function EventBody({ e, refData, f }: { e: TaskEventOut; refData: Reference; f: Fmt }): ReactNode {
  const { t, label } = f;
  const d = e.data ?? {};
  const conf = typeof d.confidence === "number" ? t("event.confidence", { pct: f.percent(d.confidence) }) : null;
  switch (e.type) {
    case "created": {
      const why = str(d.why);
      const hint = str(d.assignee_hint);
      const tgUser = str(d.telegram_user);
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span>{t("event.created_as")}</span>
            {e.to_status ? <StatusBadge status={e.to_status} /> : null}
            {tgUser ? <span className="text-fg-3">{t("event.via_command", { user: tgUser })}</span> : null}
          </div>
          {why ? (
            <div className="rounded-lg border border-ai/20 bg-ai-soft px-2.5 py-1.5 text-[13px] text-fg">
              <span className="font-semibold text-ai-text">{t("event.why")} </span>
              {why}
            </div>
          ) : null}
          {hint ? (
            <div className="text-[13px] text-fg-2">
              <span className="font-medium">{t("event.assignee_hint")} </span>
              {hint}
            </div>
          ) : null}
        </div>
      );
    }
    case "status_changed":
    case "reopened": {
      const routing = str(d.routing);
      const merged = str(d.merged_into);
      return (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {e.type === "reopened" ? <span className="font-medium">{t("event.reopened_label")}</span> : null}
            <Transition from={e.from_status} to={e.to_status} />
            {routing ? (
              <span className="text-fg-3">
                {routing === "auto" ? t("event.routing_auto") : t("event.routing_review")}
                {conf ? ` · ${conf}` : ""}
              </span>
            ) : null}
            {merged ? <span className="text-fg-3">{t("event.merged_into", { code: merged })}</span> : null}
          </div>
          {e.reason ? <Quote>{e.reason}</Quote> : null}
        </div>
      );
    }
    case "assigned": {
      const uid = str(d.assignee_id);
      const name = uid ? (refData.userById.get(uid)?.full_name ?? t("event.a_user")) : t("event.a_user");
      return (
        <span className="inline-flex items-center gap-1.5">
          {t("event.assigned_to", { name: "" }).replace(/\s*$/, "")}
          <Avatar name={name} size="xs" />
          <span className="font-medium">{name}</span>
        </span>
      );
    }
    case "updated": {
      const changes = (d.changes ?? {}) as Record<string, { from?: unknown; to?: unknown }>;
      return (
        <ul className="space-y-0.5">
          {Object.entries(changes).map(([field, c]) => (
            <li key={field}>
              <span className="text-fg-3">{label("field", field)}:</span>{" "}
              <span className="text-fg-3 line-through decoration-fg-4">{describeChange(field, c?.from, refData, f)}</span>{" "}
              <span className="text-fg-4">→</span> <span className="font-medium">{describeChange(field, c?.to, refData, f)}</span>
            </li>
          ))}
          {Object.keys(changes).length === 0 ? <li>{t("event.updated_plain")}</li> : null}
        </ul>
      );
    }
    case "comment":
      return <Quote plain>{e.reason ?? ""}</Quote>;
    case "message_linked": {
      const rel = str(d.relation);
      return (
        <div className="space-y-1.5">
          <span>{rel ? t("event.message_linked_as", { relation: label("relation", rel) }) : t("event.message_linked_plain")}</span>
          {e.reason ? <Quote>{e.reason}</Quote> : null}
        </div>
      );
    }
    case "ai_update": {
      const kind = str(d.kind);
      return (
        <div className="space-y-1.5">
          <span>
            {kind ? t("event.ai_update_kind", { kind: label("updkind", kind) }) : t("event.ai_update_plain")}
            {conf ? <span className="text-fg-3"> · {conf}</span> : null}
          </span>
          {e.reason ? <Quote>{e.reason}</Quote> : null}
        </div>
      );
    }
    case "merged": {
      const into = str(d.into);
      const fromCode = str(d.from);
      return <span>{into ? t("event.merged_out", { code: into }) : fromCode ? t("event.merged_in", { code: fromCode }) : t("event.merged_plain")}</span>;
    }
    case "reminder": {
      const due = str(d.due_at);
      return <span>{due ? t("event.reminder_due", { when: f.dateTime(due) }) : t("event.reminder_sent")}</span>;
    }
    case "escalated": {
      const level = typeof d.level === "number" ? d.level : null;
      return (
        <span>
          {level === 1
            ? t("event.escalated_lead")
            : level === 2
              ? t("event.escalated_managers")
              : level
                ? t("event.escalated_level", { level })
                : t("event.escalated_plain")}
        </span>
      );
    }
    default:
      return (
        <div className="space-y-1.5">
          <span>{label("evtype", e.type)}</span>
          {e.from_status || e.to_status ? <Transition from={e.from_status} to={e.to_status} /> : null}
          {e.reason ? <Quote>{e.reason}</Quote> : null}
        </div>
      );
  }
}

const EVENT_ICON: Record<string, ReactNode> = {
  created: <Plus />,
  status_changed: <ArrowRightLeft />,
  reopened: <RotateCcw />,
  assigned: <UserPlus />,
  updated: <Pencil />,
  comment: <MessageSquare />,
  message_linked: <Link2 />,
  ai_update: <Bot />,
  merged: <GitMerge />,
  reminder: <BellRing />,
  escalated: <Siren />,
};

const ACTOR_RING: Record<string, string> = {
  ai: "bg-ai-soft text-ai-text ring-ai/25",
  system: "bg-surface-3 text-fg-3 ring-line",
  user: "bg-accent-soft text-accent-text ring-accent/25",
};

function actorName(e: TaskEventOut, f: Fmt): string {
  if (e.actor_kind === "ai" || e.actor_kind === "system") return f.label("actor", e.actor_kind);
  return e.actor?.full_name ?? f.t("event.unknown_user");
}

export function Timeline({ events, refData, now }: { events: TaskEventOut[]; refData: Reference; now: number }) {
  const f = useFmt();
  const ordered = [...events].reverse(); // newest first, right under the comment box
  if (ordered.length === 0) return <p className="text-sm text-fg-3">{f.t("event.none")}</p>;
  return (
    <ol className="relative">
      {ordered.map((e, i) => {
        const icon = e.type === "created" && e.actor_kind === "ai" ? <Sparkles /> : (EVENT_ICON[e.type] ?? <Pencil />);
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < ordered.length - 1 ? <span className="absolute bottom-0 left-4 top-9 w-px bg-line" aria-hidden /> : null}
            <span
              className={cx(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:size-4",
                ACTOR_RING[e.actor_kind] ?? ACTOR_RING.user,
              )}
              title={f.label("actor", e.actor_kind)}
            >
              {icon}
            </span>
            <div
              className={cx(
                "min-w-0 flex-1 rounded-xl px-3.5 py-2.5 text-sm",
                e.actor_kind === "ai" && "border border-ai/15 bg-ai-soft/60",
                e.actor_kind === "system" && "border border-line bg-surface-2",
                e.actor_kind === "user" && (e.type === "comment" ? "border border-accent/20 bg-accent-soft/50" : "border border-line bg-surface"),
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                {e.actor_kind === "user" && e.actor ? <Avatar name={e.actor.full_name} size="xs" /> : null}
                <span
                  className={cx(
                    "font-semibold",
                    e.actor_kind === "ai" ? "text-ai-text" : e.actor_kind === "system" ? "text-fg-2" : "text-fg",
                  )}
                >
                  {actorName(e, f)}
                </span>
                <span className="text-fg-3">{f.label("evtype", e.type)}</span>
                <span className="ml-auto whitespace-nowrap text-fg-4" title={f.dateTime(e.created_at)}>
                  {f.ago(e.created_at, now)} · {f.dateTime(e.created_at)}
                </span>
              </div>
              <div className="text-fg">
                <EventBody e={e} refData={refData} f={f} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
