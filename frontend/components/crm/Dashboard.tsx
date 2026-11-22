"use client";

import { AlarmClock, ArrowRight, Building2, CheckCircle2, CircleAlert, Inbox, Layers, Mail, MessagesSquare, Send, TimerOff } from "lucide-react";
import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useRange, type RangeDays } from "@/lib/company";
import { useFmt } from "@/lib/format";
import { useApi, useMediaQuery } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import type { DashboardSummary, OwnerOverviewOut, ResponseStatsOut, TaskOut, TrendOut } from "@/lib/types";
import { KpiCard } from "../charts";
import { RangeSelect } from "../Shell";
import { cx } from "../ui";
import { InboxPane } from "./Inbox";
import { IssuePanel, IssuesPane, useClocksByTask } from "./Issues";

const RANGE_WORD: Record<RangeDays, Key> = { 1: "crm.range_today", 7: "crm.range_7", 30: "crm.range_30" };

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Supervisor / manager / owner home: KPIs, inbox, active issues and the issue panel side by side. */
export function CrmDashboard() {
  const { me } = useMe();
  const f = useFmt();
  const { t } = f;
  const range = useRange();
  const wide = useMediaQuery("(min-width: 1280px)");
  const summary = useApi<DashboardSummary>(paths.summary(), { refreshMs: 15000 });
  const stats = useApi<ResponseStatsOut>(paths.responseStats(range), { refreshMs: 15000 });
  const trend = useApi<TrendOut>(paths.trend(30), { refreshMs: 60000 });
  const clocks = useClocksByTask();
  const [selected, setSelected] = useState<string | null>(null);
  const select = useCallback((task: TaskOut) => setSelected(task.id), []);

  const s = summary.data;
  const by = (keys: string[]) => (s ? sum(keys.map((k) => s.by_status[k] ?? 0)) : undefined);
  const inbound = stats.data ? sum(stats.data.trend.slice(-range).map((d) => d.inbound)) : undefined;
  const resolved = trend.data ? sum(trend.data.days.slice(-range).map((d) => d.completed)) : undefined;
  const rangeWord = t(RANGE_WORD[range]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">{t("crm.dashboard_title")}</h1>
          <p className="text-sm text-fg-3">{t("crm.dashboard_sub", { company: me.company_name })}</p>
        </div>
        <RangeSelect className="lg:hidden" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          icon={<MessagesSquare />}
          tone="accent"
          label={t("crm.kpi.messages", { range: rangeWord })}
          value={inbound}
          caption={stats.data ? t("crm.kpi.messages_cap", { n: stats.data.answered_today }) : undefined}
          href="/inbox"
        />
        <KpiCard
          icon={<Layers />}
          label={t("crm.kpi.active")}
          value={by(["assigned", "in_progress", "blocked", "pending_verification"])}
          caption={s ? t("crm.kpi.active_cap", { n: s.by_status.blocked ?? 0 }) : undefined}
          href="/tasks?open=true"
        />
        <KpiCard
          icon={<TimerOff />}
          tone="danger"
          label={t("crm.kpi.overdue_resp")}
          value={stats.data?.overdue_5_plus}
          alert={stats.data && stats.data.overdue_5_plus > 0 ? t("crm.kpi.overdue_alert") : undefined}
          caption={stats.data ? t("crm.kpi.overdue_cap", { n: stats.data.escalated_10_plus }) : undefined}
          href="/inbox?state=overdue"
        />
        <KpiCard
          icon={<CircleAlert />}
          tone="warning"
          label={t("crm.kpi.unresolved")}
          value={s?.open_tasks}
          caption={s ? t("crm.kpi.unresolved_cap", { n: s.overdue }) : undefined}
          href="/tasks?open=true"
        />
        <KpiCard
          icon={<CheckCircle2 />}
          tone="success"
          label={t("crm.kpi.resolved", { range: rangeWord })}
          value={resolved}
          caption={stats.data?.within_sla_pct_today != null ? t("crm.kpi.sla_cap", { pct: f.percent(stats.data.within_sla_pct_today / 100) }) : undefined}
          href="/tasks?status=completed"
        />
      </div>

      <div className="grid gap-4 xl:h-[calc(100vh-17rem)] xl:min-h-[36rem] xl:grid-cols-[17rem_minmax(0,1fr)_23rem]">
        <InboxPane className="h-[26rem] xl:h-auto" />
        <IssuesPane className="h-[30rem] xl:h-auto" selectedId={selected} onSelect={select} clocks={clocks} autoSelect={wide} />
        {wide && selected ? <IssuePanel key={selected} taskId={selected} className="xl:h-auto" /> : null}
        {wide && !selected ? (
          <div className="hidden items-center justify-center rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-fg-3 xl:flex">
            {t("crm.pick_issue")}
          </div>
        ) : null}
      </div>

      {!wide && selected ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-950/50" onClick={() => setSelected(null)} aria-hidden />
          <div className="absolute inset-y-0 right-0 flex w-[min(30rem,100vw)] animate-slide-in-left flex-col p-0 sm:p-3">
            <IssuePanel key={selected} taskId={selected} onClose={() => setSelected(null)} className="h-full rounded-none sm:rounded-xl" />
          </div>
        </div>
      ) : null}

      {me.role === "owner" ? <OwnerStrip /> : null}
    </div>
  );
}

// --------------------------------------------------------------------------- owner overview strip

function StripStat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number | undefined; tone?: "danger" | "success" }) {
  const { count } = useFmt();
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3">
      <span
        className={cx(
          "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px]",
          tone === "danger" ? "bg-danger-soft text-danger-text" : tone === "success" ? "bg-success-soft text-success-text" : "bg-white/10 text-indigo-200",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs leading-tight text-indigo-100/70">{label}</span>
        <span className={cx("block text-xl font-semibold tabular-nums", tone === "danger" && value ? "text-red-300" : "text-white")}>
          {value === undefined ? "—" : count(value)}
        </span>
      </span>
    </div>
  );
}

export function OwnerStrip() {
  const { t } = useFmt();
  const res = useApi<OwnerOverviewOut>(paths.ownerOverview(), { refreshMs: 30000 });
  const o = res.data;
  return (
    <section className="overflow-hidden rounded-xl border border-nav-line bg-nav text-white shadow-card" aria-labelledby="owner-strip-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-nav-line px-4 py-2.5">
        <h2 id="owner-strip-title" className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-indigo-300" aria-hidden />
          {t("crm.owner_overview")}
        </h2>
        <Link href="/companies" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-200 hover:text-white hover:underline">
          {t("crm.view_breakdown")}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {res.error && !o ? <p className="px-4 py-3 text-sm text-red-200">{t("crm.owner_unavailable")}</p> : null}
      <div className="grid grid-cols-2 divide-nav-line sm:grid-cols-3 xl:grid-cols-6 xl:divide-x">
        <StripStat icon={<Building2 />} label={t("crm.os.companies")} value={o?.companies} />
        <StripStat icon={<Send />} label={t("crm.os.telegram")} value={o?.telegram_groups} />
        <StripStat icon={<Mail />} label={t("crm.os.gmail")} value={o?.gmail_accounts} />
        <StripStat icon={<AlarmClock />} label={t("crm.os.overdue")} value={o?.overdue_responses} tone="danger" />
        <StripStat icon={<Inbox />} label={t("crm.os.unresolved")} value={o?.open_issues} />
        <StripStat icon={<CheckCircle2 />} label={t("crm.os.resolved")} value={o?.resolved_24h} tone="success" />
      </div>
    </section>
  );
}
