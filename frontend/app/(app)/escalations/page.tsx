"use client";

import { Siren } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LevelBadge } from "@/components/crm/parts";
import { Empty, ErrorBanner, NoAccess, PageHeader, SkeletonTable, cx, focusRing } from "@/components/ui";
import { paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import type { EscalationKind, EscalationOut } from "@/lib/types";

const FILTERS: { id: EscalationKind | "all"; label: Key }[] = [
  { id: "all", label: "crm.state.all" },
  { id: "reminder", label: "crm.lvl.reminder" },
  { id: "overdue", label: "crm.lvl.overdue" },
  { id: "escalated", label: "crm.lvl.escalated" },
  { id: "critical", label: "crm.lvl.critical" },
  { id: "manual", label: "crm.lvl.manual" },
];

function What({ e }: { e: EscalationOut }) {
  const f = useFmt();
  return (
    <div className="min-w-0">
      {e.task ? (
        <Link href={`/tasks/${e.task.id}`} className="block truncate font-medium text-fg hover:underline">
          <span className="mr-1.5 font-mono text-xs text-fg-3">{e.task.code}</span>
          {f.title(e.task)}
        </Link>
      ) : null}
      {e.clock ? (
        <div className="truncate text-xs text-fg-3">
          <span className="font-medium text-fg-2">{e.clock.channel_name}</span>
          {e.clock.sender_name ? ` · ${e.clock.sender_name}` : ""}
          {e.clock.preview ? `: ${e.clock.preview}` : ""}
        </div>
      ) : null}
      {!e.task && !e.clock ? <span className="text-fg-4">—</span> : null}
    </div>
  );
}

export default function EscalationsPage() {
  const { can } = useMe();
  const f = useFmt();
  const { t } = f;
  const now = useNow(30000);
  const [kind, setKind] = useState<EscalationKind | "all">("all");
  const res = useApi<EscalationOut[]>(can("dashboard.read") ? paths.escalations(100) : null, { refreshMs: 15000 });
  if (!can("dashboard.read")) return <NoAccess message={t("crm.no_access")} />;
  const items = (res.data ?? []).filter((e) => kind === "all" || e.kind === kind);

  return (
    <div>
      <PageHeader icon={<Siren />} title={t("crm.nav.escalations")} subtitle={t("crm.esc_sub")} />
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={t("crm.esc_level")}>
        {FILTERS.map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={kind === x.id}
            onClick={() => setKind(x.id)}
            className={cx(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              focusRing,
              kind === x.id ? "border-accent bg-accent-soft font-medium text-fg" : "border-line bg-surface text-fg-2 hover:bg-surface-2",
            )}
          >
            {t(x.label)}
            {res.data ? <span className="ml-1 tabular-nums text-fg-4">{x.id === "all" ? res.data.length : res.data.filter((e) => e.kind === x.id).length}</span> : null}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {res.error && !res.data ? (
          <div className="p-4">
            <ErrorBanner error={res.error} onRetry={res.reload} />
          </div>
        ) : null}
        {!res.data && res.loading ? <SkeletonTable rows={8} /> : null}
        {res.data && items.length === 0 ? (
          <Empty illustration="check" title={t("crm.esc_empty_title")}>
            {t("crm.esc_empty")}
          </Empty>
        ) : null}
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                <tr>
                  <th className="w-36 px-4 py-2.5">{t("crm.col.when")}</th>
                  <th className="w-44 px-3 py-2.5">{t("crm.esc_level")}</th>
                  <th className="px-3 py-2.5">{t("crm.col.what")}</th>
                  <th className="w-48 px-3 py-2.5">{t("crm.col.reason")}</th>
                  <th className="w-48 px-3 py-2.5">{t("crm.col.notified")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((e) => (
                  <tr key={e.id} className={cx("align-top", e.kind === "critical" && "bg-red-500/5")}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium tabular-nums text-fg">{f.time(e.created_at)}</div>
                      <div className="text-xs text-fg-3">{f.ago(e.created_at, now)}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <LevelBadge kind={e.kind} />
                    </td>
                    <td className="max-w-0 px-3 py-2.5">
                      <What e={e} />
                    </td>
                    <td className="px-3 py-2.5 text-fg-2">{e.reason ?? <span className="text-fg-4">—</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-fg-2">{e.notified_names.length ? e.notified_names.join(", ") : <span className="text-fg-4">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
