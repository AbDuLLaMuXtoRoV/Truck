"use client";

import { ArrowRight, Building2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OwnerStrip } from "@/components/crm/Dashboard";
import { useToast } from "@/components/toast";
import { Button, Card, Empty, ErrorBanner, Field, NoAccess, PageHeader, SkeletonTable, inputCls } from "@/components/ui";
import { api, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { setCompanyScope, useCompanyScope } from "@/lib/company";
import { formatResponse } from "@/lib/crm";
import { useFmt } from "@/lib/format";
import { invalidateCache, useApi } from "@/lib/hooks";
import type { OwnerOverviewOut } from "@/lib/types";

const TIMEZONES = ["America/Chicago", "America/New_York", "America/Denver", "America/Los_Angeles", "Asia/Tashkent", "Europe/Moscow", "UTC"];

export default function CompaniesPage() {
  const { me, reloadMe } = useMe();
  const f = useFmt();
  const { t } = f;
  const router = useRouter();
  const scope = useCompanyScope();
  const toast = useToast();
  const isOwner = me.role === "owner";
  const res = useApi<OwnerOverviewOut>(isOwner ? paths.ownerOverview() : null, { refreshMs: 30000 });
  const [name, setName] = useState("");
  const [tz, setTz] = useState("America/Chicago");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!isOwner) return <NoAccess message={t("crm.owner_only")} />;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const c = await api.createCompany({ name: name.trim(), timezone: tz });
      setName("");
      toast(t("crm.company_created", { name: c.name }));
      invalidateCache("/api/owner");
      invalidateCache("/api/companies");
      res.reload();
      await reloadMe();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setCompanyScope(id);
    try {
      await reloadMe();
    } finally {
      router.push("/");
    }
  }

  // the API sends 0–100
  const pct = (x: number | null) => (x === null ? "—" : f.percent(x / 100));
  return (
    <div className="space-y-5">
      <PageHeader icon={<Building2 />} title={t("crm.nav.companies")} subtitle={t("crm.companies_sub")} />
      <OwnerStrip />
      <Card title={t("crm.company_breakdown")} subtitle={t("crm.last_24h")}>
        {res.error && !res.data ? <ErrorBanner error={res.error} onRetry={res.reload} /> : null}
        {!res.data && res.loading ? <SkeletonTable rows={4} /> : null}
        {res.data && res.data.per_company.length === 0 ? <Empty illustration="truck" compact>{t("crm.no_companies")}</Empty> : null}
        {res.data && res.data.per_company.length ? (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                <tr>
                  <th className="px-4 py-2.5">{t("crm.company")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.channel_telegram")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.channel_email")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.state.unanswered")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.state.overdue")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.tab.unresolved")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.tab.resolved")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.nav.escalations")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.median_response")}</th>
                  <th className="px-3 py-2.5 text-right">{t("crm.within_5")}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {res.data.per_company.map((c) => (
                  <tr key={c.company_id} className={scope === c.company_id ? "bg-accent-soft/40" : undefined}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-fg">{c.name}</td>
                    <td className="px-3 py-2.5 text-right">{f.count(c.telegram_groups)}</td>
                    <td className="px-3 py-2.5 text-right">{f.count(c.gmail_accounts)}</td>
                    <td className="px-3 py-2.5 text-right">{f.count(c.unanswered)}</td>
                    <td className={c.overdue_responses ? "px-3 py-2.5 text-right font-semibold text-danger-text" : "px-3 py-2.5 text-right"}>{f.count(c.overdue_responses)}</td>
                    <td className="px-3 py-2.5 text-right">{f.count(c.open_issues)}</td>
                    <td className="px-3 py-2.5 text-right">{f.count(c.resolved_24h)}</td>
                    <td className="px-3 py-2.5 text-right">{f.count(c.escalations_24h)}</td>
                    <td className="px-3 py-2.5 text-right">{formatResponse(c.median_response_seconds_24h, t)}</td>
                    <td className="px-3 py-2.5 text-right">{pct(c.within_sla_pct_24h)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button size="xs" variant="ghost" onClick={() => void open(c.company_id)}>
                        {t("crm.open_company")}
                        <ArrowRight />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      <Card title={t("crm.new_company")} icon={<Plus />}>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
          <Field label={t("crm.company_name")}>
            {(id) => <input id={id} className={inputCls} value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t("crm.timezone")}>
            {(id) => (
              <select id={id} className={inputCls} value={tz} onChange={(e) => setTz(e.target.value)}>
                {TIMEZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Button type="submit" variant="primary" size="md" busy={busy} disabled={!name.trim()}>
            <Plus />
            {t("crm.create_company")}
          </Button>
        </form>
        {error ? (
          <div className="mt-3">
            <ErrorBanner error={error} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
