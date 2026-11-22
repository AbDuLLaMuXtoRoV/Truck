"use client";

import { Inbox, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ConversationRow, SourceTabs, ThreadView, countBySource, type SourceTab } from "@/components/crm/Inbox";
import { DepartmentSelect } from "@/components/pickers";
import { Empty, NoAccess, PageHeader, Skeleton, cx, focusRing, inputCls } from "@/components/ui";
import { errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import { useReference } from "@/lib/reference";
import type { ConversationOut, InboxState } from "@/lib/types";

const STATES: { id: InboxState; label: Key }[] = [
  { id: "unanswered", label: "crm.state.unanswered" },
  { id: "overdue", label: "crm.state.overdue" },
  { id: "answered", label: "crm.state.answered" },
  { id: "all", label: "crm.state.all" },
];

function isState(v: string | null): v is InboxState {
  return v === "all" || v === "unanswered" || v === "overdue" || v === "answered";
}

function InboxView() {
  const { t } = useFmt();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const refData = useReference();
  const key = sp.get("key");
  const source = (["telegram", "email"].includes(sp.get("source") ?? "") ? sp.get("source") : "all") as SourceTab;
  const rawState = sp.get("state");
  const state: InboxState = isState(rawState) ? rawState : "all";
  const dept = sp.get("department_id") ?? "";
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);

  const res = useApi<ConversationOut[]>(paths.inbox({ source: "all", state, department_id: dept || undefined, q: dq || undefined, limit: 100 }), {
    refreshMs: 15000,
  });
  const items = (res.stale ? [] : (res.data ?? [])).filter((c) => source === "all" || c.source === source);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || (k === "state" && v === "all") || (k === "source" && v === "all")) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div>
      <PageHeader icon={<Inbox />} title={t("crm.nav.inbox")} subtitle={t("crm.inbox_sub")} />
      <div className="grid gap-4 lg:h-[calc(100vh-12rem)] lg:min-h-[32rem] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,22rem)_minmax(0,1fr)] xl:grid-rows-1">
        {/* filters */}
        <aside
          className={cx(
            "space-y-4 rounded-xl border border-line bg-surface p-3 shadow-card lg:col-span-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,12rem)] lg:items-end lg:gap-4 lg:space-y-0 xl:col-span-1 xl:block xl:space-y-4 xl:overflow-y-auto",
            key && "hidden lg:grid xl:block",
          )} aria-label={t("crm.filters")}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
            <input
              type="search"
              className={cx(inputCls, "h-9 pl-8")}
              placeholder={t("crm.search_messages")}
              aria-label={t("crm.search_messages")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("crm.source")}</div>
            <SourceTabs value={source} onChange={(v) => go({ source: v })} counts={countBySource(res.stale ? undefined : res.data)} className="xl:flex-col" />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("crm.reply_state")}</div>
            <div className="flex flex-wrap gap-1.5 xl:flex-col xl:items-stretch" role="group" aria-label={t("crm.reply_state")}>
              {STATES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={state === s.id}
                  onClick={() => go({ state: s.id })}
                  className={cx(
                    "rounded-full border px-3 py-1 text-sm transition-colors xl:rounded-lg xl:text-left",
                    focusRing,
                    state === s.id ? "border-accent bg-accent-soft font-medium text-fg" : "border-line text-fg-2 hover:bg-surface-2",
                  )}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="inbox-dept" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-fg-3">
              {t("crm.col.department")}
            </label>
            <DepartmentSelect id="inbox-dept" refData={refData} value={dept} onChange={(v) => go({ department_id: v || null })} emptyLabel={t("crm.all_departments")} className="w-full" />
          </div>
        </aside>

        {/* conversations */}
        <section className={cx("flex min-h-[24rem] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card", key && "hidden lg:flex")} aria-label={t("crm.conversations")}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5 text-xs text-fg-3">
            <span>{t("crm.most_urgent_first")}</span>
            {res.data && !res.stale ? <span className="tabular-nums">{items.length}</span> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {res.error && !res.data ? <p className="p-3 text-sm text-danger-text">{errorMessage(res.error)}</p> : null}
            {(!res.data || res.stale) && res.loading ? (
              <div className="space-y-3 p-3">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : null}
            {res.data && !res.stale && items.length === 0 ? (
              <Empty illustration="chat" compact title={t("crm.inbox_empty_title")}>
                {state === "all" && !dq ? t("crm.inbox_empty") : t("crm.inbox_no_match")}
              </Empty>
            ) : null}
            <ul className="divide-y divide-line">
              {items.map((c) => (
                <li key={c.key}>
                  <ConversationRow c={c} active={c.key === key} onClick={() => go({ key: c.key })} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* thread */}
        <section className={cx("min-h-[28rem] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card", key ? "flex" : "hidden lg:flex")} aria-label={t("crm.thread")}>
          {key ? (
            <ThreadView key={key} convKey={key} onBack={() => go({ key: null })} />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Empty illustration="chat" compact title={t("crm.pick_conversation")}>
                {t("crm.pick_conversation_hint")}
              </Empty>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { can } = useMe();
  const { t } = useFmt();
  if (!can("dashboard.read")) return <NoAccess message={t("crm.no_access")} />;
  return (
    <Suspense fallback={null}>
      <InboxView />
    </Suspense>
  );
}
