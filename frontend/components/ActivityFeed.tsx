"use client";

import { ArrowRightLeft, BellRing, Bot, GitMerge, Link2, MessageSquare, Pencil, Plus, RotateCcw, Siren, Sparkles, UserPlus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { paths } from "@/lib/api";
import { taskTitle, useFmt, type Fmt } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import { useReference, type Reference } from "@/lib/reference";
import type { ActivityOut } from "@/lib/types";
import { PriorityBadge } from "./badges";
import { Empty, ErrorBanner, Skeleton, cx } from "./ui";

const ICON: Record<string, ReactNode> = {
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

const ACTOR_TONE: Record<string, string> = {
  ai: "bg-ai-soft text-ai-text",
  system: "bg-surface-3 text-fg-3",
  user: "bg-accent-soft text-accent-text",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function sentence(e: ActivityOut, f: Fmt, ref: Reference): string {
  const { t, label } = f;
  const actor =
    e.actor_kind === "ai" || e.actor_kind === "system" ? label("actor", e.actor_kind) : (e.actor_name ?? t("event.unknown_user"));
  const d = e.data ?? {};
  switch (e.type) {
    case "created":
      if (e.actor_kind === "ai") return t("act.created_ai");
      if (str(d.telegram_user)) return t("act.created_tg");
      return t("act.created_user", { actor });
    case "status_changed":
      return t("act.status", { actor, status: e.to_status ? label("status", e.to_status) : "—" });
    case "reopened":
      return t("act.reopened", { actor });
    case "assigned": {
      const id = str(d.assignee_id);
      return t("act.assigned", { actor, name: (id && ref.userById.get(id)?.full_name) || t("event.a_user") });
    }
    case "updated":
      return t("act.updated", { actor });
    case "comment":
      return t("act.comment", { actor });
    case "message_linked":
      return t("act.message_linked");
    case "ai_update":
      return t("act.ai_update", { kind: str(d.kind) ? label("updkind", String(d.kind)) : "—" });
    case "merged":
      return str(d.into) ? t("act.merged_into", { code: String(d.into) }) : t("act.merged_from", { code: str(d.from) ?? "—" });
    case "reminder":
      return t("act.reminder");
    case "escalated":
      return d.level === 2 ? t("event.escalated_managers") : t("event.escalated_lead");
    default:
      return label("evtype", e.type);
  }
}

export function ActivityFeed({ limit = 20, className }: { limit?: number; className?: string }) {
  const f = useFmt();
  const { t } = f;
  const ref = useReference();
  const now = useNow(30000);
  const feed = useApi<ActivityOut[]>(paths.activity(limit), { refreshMs: 30000 });

  return (
    <section className={cx("flex flex-col rounded-xl border border-line bg-surface shadow-card", className)}>
      <header className="flex items-center justify-between gap-2 px-4 pt-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t("act.title")}</h2>
          <p className="text-xs text-fg-3">{t("act.subtitle")}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-text">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
          {t("act.live")}
        </span>
      </header>
      <div className={cx("mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2 transition-opacity", feed.loading && feed.data && "opacity-70")}>
        {feed.error && !feed.data ? <ErrorBanner error={feed.error} onRetry={feed.reload} className="m-2" /> : null}
        {!feed.data && feed.loading ? (
          <div className="space-y-4 p-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {feed.data && feed.data.length === 0 ? (
          <Empty illustration="chart" compact>
            {t("act.empty")}
          </Empty>
        ) : null}
        <ol className="relative">
          {feed.data?.map((e, i) => (
            <li key={e.id} className="relative">
              {i < (feed.data?.length ?? 0) - 1 ? <span className="absolute bottom-0 left-[1.65rem] top-10 w-px bg-line" aria-hidden /> : null}
              <Link href={`/tasks/${e.task.id}`} className="flex gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2">
                <span className={cx("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface [&_svg]:size-4", ACTOR_TONE[e.actor_kind] ?? ACTOR_TONE.user)}>
                  {e.type === "created" && e.actor_kind === "ai" ? <Sparkles /> : (ICON[e.type] ?? <Pencil />)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-fg">{sentence(e, f, ref)}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
                    <span className="shrink-0 whitespace-nowrap font-mono text-[11px] font-medium text-fg-2">{e.task.code}</span>
                    <PriorityBadge priority={e.task.priority} />
                    <span className="truncate">{taskTitle(e.task, f.lang)}</span>
                  </span>
                  {e.type === "comment" && e.reason ? (
                    <span className="mt-1 line-clamp-2 block rounded-md bg-surface-2 px-2 py-1 text-xs text-fg-2">{e.reason}</span>
                  ) : null}
                </span>
                <span className="shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-fg-4" title={f.dateTime(e.created_at)}>
                  {f.ago(e.created_at, now)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
