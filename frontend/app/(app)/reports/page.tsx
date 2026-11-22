"use client";

import { AlarmClock, BarChart3, CheckCircle2, Gauge, Timer, TimerOff } from "lucide-react";
import { useState } from "react";
import { KpiCard, MedianReplyChart, ResponseTrendChart, TrendChart } from "@/components/charts";
import { Card, ErrorBanner, NoAccess, PageHeader, Skeleton, cx, selectBase } from "@/components/ui";
import { paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { deptLabel, formatResponse } from "@/lib/crm";
import { useFmt } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { ResponseStatsOut, TrendOut } from "@/lib/types";

const WINDOWS = [7, 14, 30] as const;

export default function ReportsPage() {
  const { can } = useMe();
  const f = useFmt();
  const { t } = f;
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(14);
  const stats = useApi<ResponseStatsOut>(can("dashboard.read") ? paths.responseStats(days) : null, { refreshMs: 60000 });
  const trend = useApi<TrendOut>(can("dashboard.read") ? paths.trend(days) : null, { refreshMs: 60000 });
  if (!can("dashboard.read")) return <NoAccess message={t("crm.no_access")} />;
  const s = stats.data;
  const answered = s ? s.trend.reduce((a, d) => a + d.answered, 0) : undefined;
  const inbound = s ? s.trend.reduce((a, d) => a + d.inbound, 0) : undefined;
  const within = s ? s.trend.reduce((a, d) => a + d.within_sla, 0) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<BarChart3 />}
        title={t("crm.nav.reports")}
        subtitle={t("crm.reports_sub")}
        actions={
          <select aria-label={t("crm.range")} className={cx(selectBase, "h-9 w-auto")} value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof WINDOWS)[number])}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {t("crm.last_n_days", { n: w })}
              </option>
            ))}
          </select>
        }
      />
      {stats.error && !s ? <ErrorBanner error={stats.error} onRetry={stats.reload} /> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard icon={<CheckCircle2 />} tone="success" label={t("crm.rep.answered", { n: days })} value={answered} caption={inbound !== undefined ? t("crm.rep.of_inbound", { n: f.count(inbound) }) : undefined} />
        <KpiCard
          icon={<Gauge />}
          tone="accent"
          label={t("crm.rep.within")}
          value={within}
          caption={answered ? t("crm.rep.within_pct", { pct: f.percent(within! / Math.max(1, answered)) }) : undefined}
        />
        <KpiCard icon={<Timer />} label={t("crm.rep.median_today")} value={undefined} display={s ? formatResponse(s.median_response_seconds_today, t) : undefined} caption={s?.within_sla_pct_today != null ? t("crm.kpi.sla_cap", { pct: f.percent(s.within_sla_pct_today / 100) }) : undefined} />
        <KpiCard icon={<TimerOff />} tone="danger" label={t("crm.kpi.overdue_resp")} value={s?.overdue_5_plus} caption={s ? t("crm.kpi.overdue_cap", { n: s.escalated_10_plus }) : undefined} href="/inbox?state=overdue" />
        <KpiCard icon={<AlarmClock />} tone="warning" label={t("crm.rep.waiting_now")} value={s?.unanswered_0_5} href="/inbox?state=unanswered" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="h-[22rem]">
          {s ? (
            <ResponseTrendChart days={s.trend} title={t("crm.rep.reply_chart")} subtitle={t("crm.rep.reply_chart_sub", { n: days })} />
          ) : (
            <Skeleton className="h-full w-full rounded-xl" />
          )}
        </div>
        <div className="h-[22rem]">
          {s ? <MedianReplyChart days={s.trend} title={t("crm.rep.median_chart")} subtitle={t("crm.rep.median_chart_sub")} /> : <Skeleton className="h-full w-full rounded-xl" />}
        </div>
        <div className="h-[22rem]">{trend.data ? <TrendChart days={trend.data.days} /> : <Skeleton className="h-full w-full rounded-xl" />}</div>
        <Card title={t("crm.rep.by_department")} subtitle={t("crm.rep.by_department_sub")}>
          {!s ? <Skeleton className="h-40 w-full" /> : null}
          {s ? (
            <div className="-m-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                  <tr>
                    <th className="px-4 py-2.5">{t("crm.col.department")}</th>
                    <th className="px-3 py-2.5 text-right">{t("crm.state.unanswered")}</th>
                    <th className="px-4 py-2.5 text-right">{t("crm.state.overdue")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {s.by_department.map((d) => (
                    <tr key={d.department_id ?? "none"}>
                      <td className="px-4 py-2.5 font-medium text-fg">{d.department_id ? deptLabel(d, t) : t("dept.unrouted")}</td>
                      <td className="px-3 py-2.5 text-right">{f.count(d.unanswered)}</td>
                      <td className={cx("px-4 py-2.5 text-right", d.overdue > 0 && "font-semibold text-danger-text")}>{f.count(d.overdue)}</td>
                    </tr>
                  ))}
                  {s.by_department.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-fg-3">
                        {t("crm.rep.no_waiting")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
