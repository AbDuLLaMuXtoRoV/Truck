"use client";

import { CircleCheck, Clock, ListTodo, MessageSquare, RefreshCw, Search, Send, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { GroupAvatar } from "@/components/avatars";
import { BotStatusBadge } from "@/components/badges";
import { DepartmentSelect, TruckSelect } from "@/components/pickers";
import { Button, Empty, ErrorBanner, NoAccess, PageHeader, Skeleton, Spinner, Toggle, cx, focusRing, inputCls, selectCls } from "@/components/ui";
import { api, errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import { useT, type Key } from "@/lib/i18n";
import { useReference, type Reference } from "@/lib/reference";
import { GROUP_KINDS, type GroupKind, type GroupOut, type GroupPatchIn } from "@/lib/types";

type Filter = "all" | "enabled" | "disabled";

/** Telegram username of the company bot, shown in the "add the bot" hint. */
const BOT_USERNAME = (process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? "truckdipatchbot").replace(/^@/, "");

const FILTERS: [Filter, Key][] = [
  ["all", "filter.all"],
  ["enabled", "groups.filter_enabled"],
  ["disabled", "groups.filter_disabled"],
];

const isPending = (g: GroupOut) => !g.is_enabled && (g.bot_status === "member" || g.bot_status === "administrator");
const botGone = (g: GroupOut) => g.bot_status === "left" || g.bot_status === "kicked";

export default function GroupsPage() {
  const { can } = useMe();
  const { t } = useT();
  if (!can("groups.read")) return <NoAccess message={t("access.groups")} />;
  return <Groups />;
}

function Groups() {
  const { can } = useMe();
  const { t, tp } = useT();
  const canManage = can("groups.manage");
  const res = useApi<GroupOut[]>(paths.groups());
  const refData = useReference();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const groups = res.data;
  const term = q.trim().toLowerCase();
  const matches = (g: GroupOut) =>
    !term || g.title.toLowerCase().includes(term) || String(g.tg_chat_id).includes(term) || (g.truck?.unit_number ?? "").toLowerCase().includes(term);

  const pending = useMemo(
    () => (groups ?? []).filter(isPending).filter(matches).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches only depends on term
    [groups, term],
  );
  const others = useMemo(
    () =>
      (groups ?? [])
        .filter((g) => !isPending(g))
        .filter((g) => (filter === "enabled" ? g.is_enabled : filter === "disabled" ? !g.is_enabled : true))
        .filter(matches)
        .sort((a, b) => Number(b.is_enabled) - Number(a.is_enabled) || a.title.localeCompare(b.title)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches only depends on term
    [groups, filter, term],
  );
  const counts = {
    all: (groups ?? []).filter((g) => !isPending(g)).length,
    enabled: (groups ?? []).filter((g) => g.is_enabled).length,
    disabled: (groups ?? []).filter((g) => !g.is_enabled && !isPending(g)).length,
  };

  const onSaved = (g: GroupOut) => {
    res.setData((prev) => (prev ?? []).map((x) => (x.id === g.id ? g : x)));
    invalidateCache("/api/dashboard");
  };

  return (
    <>
      <PageHeader
        icon={<Send />}
        title={t("groups.title")}
        subtitle={t("groups.subtitle")}
        actions={
          <Button size="sm" onClick={res.reload} busy={res.loading && !!groups}>
            <RefreshCw />
            {t("common.refresh")}
          </Button>
        }
      />

      <ErrorBanner error={res.error} onRetry={res.reload} className="mb-3" />

      {!groups && res.loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : null}

      {groups && groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface shadow-card">
          <Empty
            illustration="chat"
            title={t("groups.no_bot_title")}
            action={
              <a
                href={`https://t.me/${BOT_USERNAME}?startgroup=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-xs hover:bg-accent-hover"
              >
                <Send className="size-4" aria-hidden />
                {t("groups.add_bot_link")}
              </a>
            }
          >
            {t("groups.no_bot_hint", { bot: `@${BOT_USERNAME}` })}
          </Empty>
        </div>
      ) : null}

      {groups && groups.length > 0 ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
              <input type="search" className={cx(inputCls, "pl-8")} placeholder={t("groups.search_placeholder")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("groups.search_label")} />
            </div>
            {!canManage ? <span className="text-xs text-fg-3">{t("groups.read_only")}</span> : null}
          </div>

          {pending.length ? (
            <section className="mb-6 overflow-hidden rounded-xl border border-warning/40 bg-warning-soft shadow-card" aria-labelledby="pending-title">
              <header className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-warning/15 text-warning-text">
                  <Clock className="size-4" aria-hidden />
                </span>
                <div>
                  <h2 id="pending-title" className="text-sm font-semibold text-fg">
                    {t("groups.pending_section")}
                  </h2>
                  <p className="text-xs text-fg-2">
                    {tp("groups.pending_banner", pending.length)} {t("groups.pending_banner_explain")}
                  </p>
                </div>
              </header>
              <ul className="space-y-2 px-3 pb-3">
                {pending.map((g) => (
                  <PendingCard key={g.id} group={g} canManage={canManage} refData={refData} onSaved={onSaved} />
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex h-8 rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="group" aria-label={t("groups.filter_label")}>
              {FILTERS.map(([v, key]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={filter === v}
                  onClick={() => setFilter(v)}
                  className={cx("rounded-md px-2.5 transition-colors", focusRing, filter === v ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg")}
                >
                  {t(key)} <span className="tabular-nums opacity-70">{counts[v]}</span>
                </button>
              ))}
            </div>
          </div>

          <ul className="space-y-2">
            {others.map((g) => (
              <GroupRow key={g.id} group={g} canManage={canManage} refData={refData} onSaved={onSaved} />
            ))}
          </ul>
          {others.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface">
              <Empty illustration="search" compact>
                {t("groups.no_match")}
              </Empty>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function useGroupPatch(g: GroupOut, onSaved: (g: GroupOut) => void) {
  const [saving, setSaving] = useState<keyof GroupPatchIn | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function patch(field: keyof GroupPatchIn, body: GroupPatchIn) {
    setSaving(field);
    setError(null);
    try {
      onSaved(await api.patchGroup(g.id, body));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(null);
    }
  }
  return { saving, error, patch };
}

function Mapping({
  g,
  disabled,
  refData,
  saving,
  patch,
}: {
  g: GroupOut;
  disabled: boolean;
  refData: Reference;
  saving: keyof GroupPatchIn | null;
  patch: (field: keyof GroupPatchIn, body: GroupPatchIn) => void;
}) {
  const { t, label } = useFmt();
  const busy = (field: keyof GroupPatchIn) => (saving === field ? <Spinner className="ml-1.5 size-3.5 text-fg-4" /> : null);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <label className="flex items-center">
        <span className="sr-only">{t("groups.kind_of", { title: g.title })}</span>
        <select className={cx(selectCls, "h-8")} value={g.kind} disabled={disabled} onChange={(e) => patch("kind", { kind: e.target.value as GroupKind })} aria-label={t("groups.kind_of", { title: g.title })}>
          {GROUP_KINDS.map((k) => (
            <option key={k} value={k}>
              {label("groupkind", k)}
            </option>
          ))}
        </select>
        {busy("kind")}
      </label>
      <div className="flex items-center">
        <TruckSelect
          refData={refData}
          value={g.truck?.id ?? ""}
          disabled={disabled}
          onChange={(v) => patch("truck_id", { truck_id: v || null })}
          className={cx("h-8", g.kind === "truck" && !g.truck && "border-warning")}
        />
        {busy("truck_id")}
      </div>
      <div className="flex items-center">
        <DepartmentSelect refData={refData} value={g.department?.id ?? ""} disabled={disabled} onChange={(v) => patch("department_id", { department_id: v || null })} className="h-8" />
        {busy("department_id")}
      </div>
    </div>
  );
}

function PendingCard({ group: g, canManage, refData, onSaved }: { group: GroupOut; canManage: boolean; refData: Reference; onSaved: (g: GroupOut) => void }) {
  const f = useFmt();
  const { t, label } = f;
  const { saving, error, patch } = useGroupPatch(g, onSaved);
  const disabled = !canManage || saving !== null;
  return (
    <li className="animate-slide-up rounded-xl border border-line bg-surface p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <GroupAvatar title={g.title} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-fg">{g.title}</span>
            <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-semibold text-amber-950">{t("groups.pending_badge")}</span>
          </div>
          <div className="mt-0.5 text-xs text-fg-3">{t("groups.meta", { type: label("chattype", g.chat_type), id: g.tg_chat_id, when: f.dateTime(g.created_at) })}</div>
        </div>
        {canManage ? (
          <Button variant="success" size="md" busy={saving === "is_enabled"} disabled={disabled} onClick={() => patch("is_enabled", { is_enabled: true })}>
            <CircleCheck />
            {t("groups.enable")}
          </Button>
        ) : null}
      </div>
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-fg-3">{t("groups.mapping_hint")}</p>
        <Mapping g={g} disabled={disabled} refData={refData} saving={saving} patch={patch} />
      </div>
      {error ? <p className="mt-2 text-xs text-danger-text">{errorMessage(error)}</p> : null}
    </li>
  );
}

function GroupRow({ group: g, canManage, refData, onSaved }: { group: GroupOut; canManage: boolean; refData: Reference; onSaved: (g: GroupOut) => void }) {
  const f = useFmt();
  const { t, label } = f;
  const now = useNow(60000);
  const { saving, error, patch } = useGroupPatch(g, onSaved);
  const gone = botGone(g);
  const disabled = !canManage || saving !== null;

  return (
    <li className={cx("rounded-xl border bg-surface p-3.5 shadow-xs transition-colors", gone ? "border-warning/40" : "border-line hover:border-line-strong", !g.is_enabled && "opacity-90")}>
      <div className="grid grid-cols-1 items-center gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <GroupAvatar title={g.title} className={cx(!g.is_enabled && "grayscale")} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-semibold text-fg" title={g.title}>
                {g.title}
              </span>
              <BotStatusBadge status={g.bot_status} />
            </div>
            <div className="mt-0.5 truncate text-xs text-fg-3">{t("groups.meta", { type: label("chattype", g.chat_type), id: g.tg_chat_id, when: f.dateTime(g.created_at) })}</div>
          </div>
        </div>
        <Mapping g={g} disabled={disabled} refData={refData} saving={saving} patch={patch} />
        <div className="flex items-center justify-between gap-4 xl:justify-end">
          <div className="flex items-center gap-4 text-xs text-fg-3">
            <span className="inline-flex items-center gap-1 tabular-nums" title={t("groups.col_messages")}>
              <MessageSquare className="size-3.5" aria-hidden />
              {f.count(g.message_count)}
            </span>
            {g.open_tasks ? (
              <Link href={`/tasks?group_id=${g.id}&open=true`} className="inline-flex items-center gap-1 font-medium tabular-nums text-accent-text hover:underline" title={t("groups.col_open_tasks")}>
                <ListTodo className="size-3.5" aria-hidden />
                {g.open_tasks}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 tabular-nums" title={t("groups.col_open_tasks")}>
                <ListTodo className="size-3.5" aria-hidden />0
              </span>
            )}
            <span className="hidden whitespace-nowrap sm:inline" title={g.last_message_at ? f.dateTime(g.last_message_at) : undefined}>
              {g.last_message_at ? f.ago(g.last_message_at, now) : "—"}
            </span>
          </div>
          <span className="flex items-center gap-2">
            {saving === "is_enabled" ? <Spinner className="size-3.5 text-fg-4" /> : null}
            <Toggle
              checked={g.is_enabled}
              disabled={disabled}
              onChange={(v) => patch("is_enabled", { is_enabled: v })}
              label={g.is_enabled ? t("groups.disable_title", { title: g.title }) : t("groups.enable_title", { title: g.title })}
            />
          </span>
        </div>
      </div>
      {gone ? (
        <p className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs font-medium text-warning-text">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {g.bot_status === "kicked" ? t("groups.bot_kicked") : t("groups.bot_left")}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger-text">{errorMessage(error)}</p> : null}
    </li>
  );
}
