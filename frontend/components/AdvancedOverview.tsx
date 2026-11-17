"use client";

import { AlarmClock, ArrowRight, CircleCheck, Inbox, ListTodo, Send, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ActivityFeed } from "@/components/ActivityFeed";
import { Avatar } from "@/components/avatars";
import { Confidence, PriorityBadge, TruckChip } from "@/components/badges";
import { DepartmentLoadChart, KpiCard, Meter, PriorityMix, TrendChart } from "@/components/charts";
import { DueChip } from "@/components/due";
import { Empty, ErrorBanner, NoAccess, PageHeader, Skeleton, cx } from "@/components/ui";
import { paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { useApi, useNow, type UseApiResult } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { AIStatsOut, DashboardSummary, TaskListOut, TaskOut, TrendOut } from "@/lib/types";

const REFRESH = 60000;

/** The full (advanced-mode) overview. */
export function AdvancedOverview() {
  const { can } = useMe();
  const { t } = useT();
  if (!can("dashboard.read")) return <NoAccess message={t("access.overview")} />;
  return <Overview />;
}

function ChartSkeleton({ h = 260 }: { h?: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-56" />
      <Skeleton className="mt-4 w-full" />
      <div className="mt-4 flex items-end gap-2" style={{ height: h - 90 }}>
        {Array.from({ length: 14 }, (_, i) => (
          <Skeleton key={i} className="flex-1" />
        ))}
      </div>
    </div>
  );
}

function Overview() {
  const { can, me } = useMe();
  const f = useFmt();
  const { t, percent } = f;
  const summary = useApi<DashboardSummary>(paths.summary(), { refreshMs: REFRESH });
  const trend = useApi<TrendOut>(paths.trend(14), { refreshMs: REFRESH * 5 });
  const ai = useApi<AIStatsOut>(paths.aiStats(), { refreshMs: REFRESH * 5 });
  const overdue = useApi<TaskListOut>(paths.tasks({ overdue: true, sort: "due_asc", limit: 8 }), { refreshMs: REFRESH });
  const review = useApi<TaskListOut>(paths.tasks({ status: ["detected", "needs_review"], sort: "created_asc", limit: 8 }), { refreshMs: REFRESH });
  const s = summary.data;
  const reviewHref = can("tasks.review") ? "/review" : "/tasks?status=detected&status=needs_review";
  const firstName = me.full_name.split(/\s+/)[0];

  return (
    <>
      <PageHeader
        title={t("overview.greeting", { name: firstName })}
        subtitle={t("overview.subtitle")}
        actions={
          can("tasks.review") && s && s.needs_review > 0 ? (
            <Link
              href="/review"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent-hover"
            >
              <Inbox className="size-4" aria-hidden />
              {t("overview.start_review", { n: s.needs_review })}
            </Link>
          ) : null
        }
      />
      <ErrorBanner error={summary.error} onRetry={summary.reload} className="mb-4" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={<Send />}
          tone="accent"
          label={t("kpi.connected_groups")}
          value={s?.connected_groups}
          caption={s ? t("kpi.groups_caption", { enabled: s.enabled_groups, pending: s.pending_groups }) : undefined}
          href={can("groups.read") ? "/groups" : undefined}
        />
        <KpiCard
          icon={<ListTodo />}
          label={t("kpi.open")}
          value={s?.open_tasks}
          caption={s ? t("kpi.created_today", { n: s.created_today }) : undefined}
          href="/tasks?open=true"
        />
        <KpiCard
          icon={<AlarmClock />}
          tone={s && s.overdue > 0 ? "danger" : "default"}
          label={t("kpi.overdue")}
          value={s?.overdue}
          caption={s && s.open_tasks ? t("kpi.overdue_share", { pct: percent(s.overdue / s.open_tasks) }) : undefined}
          alert={s && s.overdue > 0 ? t("kpi.past_due") : undefined}
          href="/tasks?overdue=true&sort=due_asc"
        />
        <KpiCard icon={<Inbox />} tone="warning" label={t("kpi.needs_review")} value={s?.needs_review} caption={t("kpi.needs_review_caption")} href={reviewHref} />
        <KpiCard
          icon={<ShieldCheck />}
          tone="ai"
          label={t("kpi.pending_verification")}
          value={s?.pending_verification}
          caption={t("kpi.pending_verification_caption")}
          href="/tasks?status=pending_verification&sort=updated_desc"
        />
        <KpiCard
          icon={<CircleCheck />}
          tone="success"
          label={t("kpi.completed_today")}
          value={s?.completed_today}
          caption={t("kpi.completed_today_caption")}
          href="/tasks?status=completed&sort=updated_desc"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {trend.data ? (
            <TrendChart days={trend.data.days} dim={trend.loading} />
          ) : trend.error ? (
            <div className="rounded-xl border border-line bg-surface shadow-card">
              <ErrorBanner error={trend.error} onRetry={trend.reload} className="m-4" />
            </div>
          ) : (
            <ChartSkeleton />
          )}
        </div>
        <AiPanel result={ai} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {s ? <DepartmentLoadChart rows={s.by_department} dim={summary.loading} className="h-full" /> : <ChartSkeleton h={220} />}
        </div>
        <div className="min-w-0">{s ? <PriorityMix byPriority={s.by_priority} dim={summary.loading} className="h-full" /> : <ChartSkeleton h={200} />}</div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TaskListCard
              title={t("overview.overdue_now")}
              icon={<AlarmClock className="text-danger" />}
              href="/tasks?overdue=true&sort=due_asc"
              linkLabel={t("overview.all_overdue")}
              result={overdue}
              empty={t("overview.nothing_overdue")}
              emptyArt="check"
            />
            <TaskListCard
              title={t("kpi.needs_review")}
              icon={<Inbox className="text-warning" />}
              href={reviewHref}
              linkLabel={can("tasks.review") ? t("overview.open_review_queue") : t("overview.all_candidates")}
              result={review}
              empty={t("overview.queue_empty")}
              emptyArt="inbox"
              showConfidence
            />
        <ActivityFeed className="h-[34rem] md:col-span-2 xl:col-span-1" />
      </div>
    </>
  );
}

// --------------------------------------------------------------------------- AI performance

function AiPanel({ result }: { result: UseApiResult<AIStatsOut> }) {
  const f = useFmt();
  const { t, count } = f;
  const d = result.data;
  const judged = d ? d.approved + d.rejected : 0;
  const approval = d && judged > 0 ? d.approved / judged : null;
  const failRate = d && d.model_calls > 0 ? d.failed_calls / d.model_calls : null;
  const latency =
    d?.avg_latency_ms === null || d?.avg_latency_ms === undefined
      ? "—"
      : d.avg_latency_ms >= 1000
        ? t("ai.seconds", { n: (d.avg_latency_ms / 1000).toLocaleString(f.locale, { maximumFractionDigits: 1 }) })
        : t("ai.ms", { n: d.avg_latency_ms });

  return (
    <section className="relative overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-ai/10 blur-3xl" aria-hidden />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-ai-soft text-ai-text">
            <Sparkles className="size-[18px]" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-fg">{t("ai.title")}</h2>
            <p className="text-xs text-fg-3">{t("ai.window", { n: d?.window_days ?? 7 })}</p>
          </div>
        </div>
        {failRate !== null && d && d.failed_calls > 0 ? (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning-text">
            {t("ai.failed_badge", { n: d.failed_calls })}
          </span>
        ) : null}
      </div>
      {result.error && !d ? <ErrorBanner error={result.error} onRetry={result.reload} className="mt-3" /> : null}
      {!d && result.loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : null}
      {d ? (
        <div className={cx("relative transition-opacity", result.loading && "opacity-70")}>
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <Stat label={t("ai.messages")} value={count(d.messages_analyzed)} />
            <Stat label={t("ai.tasks")} value={count(d.ai_tasks)} />
            <Stat label={t("ai.calls")} value={count(d.model_calls)} hint={failRate !== null ? t("ai.fail_rate", { pct: f.percent(failRate) }) : undefined} />
            <Stat label={t("ai.latency")} value={latency} />
          </dl>
          <div className="mt-4 space-y-3">
            <Meter label={t("ai.approval")} value={approval} figure={approval === null ? "—" : f.percent(approval)} />
            <Meter label={t("ai.avg_confidence")} value={d.avg_confidence} figure={d.avg_confidence === null ? "—" : f.percent(d.avg_confidence)} />
          </div>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-3">
            <span>{t("ai.approved", { n: d.approved })}</span>
            <span>{t("ai.rejected", { n: d.rejected })}</span>
            <Link href="/review" className="font-medium text-accent-text hover:underline">
              {t("ai.pending", { n: d.pending_review })}
            </Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <dt className="truncate text-[11px] font-medium text-fg-3">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-fg">{value}</dd>
      {hint ? <dd className="truncate text-[11px] text-fg-3">{hint}</dd> : null}
    </div>
  );
}

// --------------------------------------------------------------------------- task lists

function TaskListCard({
  title,
  icon,
  href,
  linkLabel,
  result,
  empty,
  emptyArt,
  showConfidence,
}: {
  title: string;
  icon: ReactNode;
  href: string;
  linkLabel: string;
  result: UseApiResult<TaskListOut>;
  empty: string;
  emptyArt: "check" | "inbox";
  showConfidence?: boolean;
}) {
  const f = useFmt();
  const { t } = f;
  const now = useNow();
  return (
    <section className="flex h-[34rem] flex-col rounded-xl border border-line bg-surface shadow-card">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-fg [&_svg]:size-4 [&_svg]:shrink-0">
          {icon}
          <span className="truncate">{title}</span>
          {result.data ? <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold tabular-nums text-fg-2">{result.data.total}</span> : null}
        </h2>
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-accent-text hover:underline">
          {linkLabel}
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </header>
      {result.error && !result.data ? <ErrorBanner error={result.error} onRetry={result.reload} className="m-3" /> : null}
      {!result.data && result.loading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : null}
      {result.data && result.data.items.length === 0 ? (
        <Empty illustration={emptyArt} compact>
          {empty}
        </Empty>
      ) : null}
      <ul className={cx("min-h-0 flex-1 divide-y divide-line overflow-y-auto", result.loading && result.data && "opacity-70")}>
        {result.data?.items.map((task: TaskOut) => {
          const title = f.title(task);
          return (
            <li key={task.id}>
              <Link href={`/tasks/${task.id}`} className="block px-4 py-2.5 transition-colors hover:bg-surface-2">
                <span className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[11px] font-medium text-fg-3">{task.code}</span>
                  <PriorityBadge priority={task.priority} />
                  <span className="ml-auto shrink-0">
                    {showConfidence ? (
                      <span className="text-[11px] text-fg-4">{f.ago(task.created_at, now)}</span>
                    ) : (
                      <DueChip createdAt={task.created_at} dueAt={task.due_at} status={task.status} now={now} />
                    )}
                  </span>
                </span>
                <span className="mt-1 block truncate text-sm font-medium text-fg" title={title}>
                  {title}
                </span>
                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
                  {task.truck ? <TruckChip unit={task.truck.unit_number} /> : null}
                  {task.assignee ? (
                    <span className="flex min-w-0 items-center gap-1">
                      <Avatar name={task.assignee.full_name} size="xs" />
                      <span className="truncate">{task.assignee.full_name}</span>
                    </span>
                  ) : (
                    <span className="truncate">{task.department?.name ?? t("dept.unrouted")}</span>
                  )}
                  {showConfidence && task.confidence !== null ? (
                    <span className="ml-auto shrink-0">
                      <Confidence value={task.confidence} compact />
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {result.data && result.data.total > result.data.items.length ? (
        <p className="border-t border-line px-4 py-2 text-xs text-fg-3">{t("common.showing_of", { n: result.data.items.length, total: result.data.total })}</p>
      ) : null}
    </section>
  );
}
