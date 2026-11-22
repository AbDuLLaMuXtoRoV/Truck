"use client";

import { CheckCircle2, Database, FileUp, Mail, Plug, RefreshCw, Search, Send, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { DepartmentSelect } from "../pickers";
import { useToast } from "../toast";
import { Button, Card, Empty, ErrorBanner, Modal, NoAccess, PageHeader, Skeleton, Toggle, cx, inputCls } from "../ui";
import { api, errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { invalidateCache, useApi, useDebounced, useNow } from "@/lib/hooks";
import { useReference, type Reference } from "@/lib/reference";
import type { Key } from "@/lib/i18n";
import type { IntegrationsOut, LoadImportOut, LoadOut, MailboxOut } from "@/lib/types";

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", ok ? "bg-success-soft text-success-text" : "bg-surface-3 text-fg-3")}>
      <span className={cx("size-1.5 rounded-full", ok ? "bg-emerald-500" : "bg-fg-4")} aria-hidden />
      {label}
    </span>
  );
}

/** Owner/admin: Telegram bot, Gmail inboxes and the TMS (loads) import. */
export function IntegrationsView() {
  const { can } = useMe();
  const { t } = useFmt();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const res = useApi<IntegrationsOut>(can("groups.manage") ? paths.integrations() : null, { refreshMs: 30000 });
  if (!can("groups.manage")) return <NoAccess message={t("crm.admin_only")} />;

  // Google sends the browser back here: /settings?tab=integrations&gmail=connected|error&reason=…
  const gmail = sp.get("gmail");
  const reason = sp.get("reason");
  const clearNotice = () => {
    const next = new URLSearchParams(sp.toString());
    next.delete("gmail");
    next.delete("reason");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={<Plug />} title={t("crm.nav.integrations")} subtitle={t("crm.integrations_sub")} />
      {gmail === "connected" ? (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("crm.gmail_connected_notice")}</span>
          <button type="button" onClick={clearNotice} className="text-xs font-medium underline">
            {t("common.close")}
          </button>
        </div>
      ) : null}
      {gmail === "error" ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/8 px-4 py-3 text-sm text-red-900 dark:text-red-200" role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("crm.gmail_error_notice", { reason: reason || t("crm.unknown_reason") })}</span>
          <button type="button" onClick={clearNotice} className="text-xs font-medium underline">
            {t("common.close")}
          </button>
        </div>
      ) : null}
      {res.error && !res.data ? <ErrorBanner error={res.error} onRetry={res.reload} /> : null}
      <TelegramCard data={res.data} />
      <GmailCard data={res.data} onChanged={res.reload} />
      <TmsCard data={res.data} onImported={res.reload} />
    </div>
  );
}

// --------------------------------------------------------------------------- telegram

function TelegramCard({ data }: { data: IntegrationsOut | undefined }) {
  const { t, count } = useFmt();
  const tg = data?.telegram;
  return (
    <Card title={t("crm.int.telegram")} icon={<Send />} actions={tg ? <StatusDot ok={tg.connected} label={tg.connected ? t("crm.connected") : t("crm.not_connected")} /> : null}>
      {!tg ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg bg-surface-2 p-3">
              <dt className="text-xs text-fg-3">{t("crm.int.bot")}</dt>
              <dd className="mt-0.5 truncate font-semibold text-fg">{tg.bot_username ? `@${tg.bot_username}` : "—"}</dd>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <dt className="text-xs text-fg-3">{t("crm.int.mode")}</dt>
              <dd className="mt-0.5 font-semibold text-fg">{tg.mode}</dd>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <dt className="text-xs text-fg-3">{t("crm.int.groups_enabled")}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{count(tg.groups_enabled)}</dd>
            </div>
            <div className="rounded-lg bg-surface-2 p-3">
              <dt className="text-xs text-fg-3">{t("crm.int.groups_pending")}</dt>
              <dd className={cx("mt-0.5 text-lg font-semibold tabular-nums", tg.groups_pending ? "text-warning-text" : "text-fg")}>{count(tg.groups_pending)}</dd>
            </div>
          </dl>
          <p className="text-fg-3">{t("crm.int.telegram_hint")}</p>
          <Link href="/groups" className="inline-flex text-sm font-medium text-accent-text hover:underline">
            {t("crm.int.manage_groups")} →
          </Link>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- gmail

function GmailCard({ data, onChanged }: { data: IntegrationsOut | undefined; onChanged: () => void }) {
  const { t } = useFmt();
  const refData = useReference();
  const [connecting, setConnecting] = useState(false);
  const gm = data?.gmail;
  const connected = gm?.mailboxes.some((m) => m.status === "connected") ?? false;
  return (
    <Card
      title={t("crm.int.gmail")}
      icon={<Mail />}
      subtitle={t("crm.int.gmail_sub")}
      actions={
        gm ? (
          <>
            <StatusDot ok={connected} label={connected ? t("crm.connected") : t("crm.not_connected")} />
            <Button variant="primary" size="sm" disabled={!gm.configured} onClick={() => setConnecting(true)} title={!gm.configured ? t("crm.int.gmail_not_configured") : undefined}>
              <Mail />
              {t("crm.int.connect_gmail")}
            </Button>
          </>
        ) : null
      }
    >
      {!gm ? <Skeleton className="h-24 w-full rounded-lg" /> : null}
      {gm && !gm.configured ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("crm.int.gmail_not_configured")}
        </div>
      ) : null}
      {gm && gm.mailboxes.length === 0 ? (
        <Empty illustration="inbox" compact title={t("crm.int.no_mailboxes")}>
          {t("crm.int.no_mailboxes_hint")}
        </Empty>
      ) : null}
      {gm && gm.mailboxes.length ? (
        <div className="-m-4 overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
              <tr>
                <th className="px-4 py-2.5">{t("crm.int.mailbox")}</th>
                <th className="px-3 py-2.5">{t("crm.col.status")}</th>
                <th className="w-52 px-3 py-2.5">{t("crm.col.department")}</th>
                <th className="px-3 py-2.5">{t("crm.int.last_sync")}</th>
                <th className="px-3 py-2.5 text-right">{t("crm.state.unanswered")}</th>
                <th className="px-3 py-2.5">{t("crm.int.enabled")}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {gm.mailboxes.map((m) => (
                <MailboxRow key={m.id} m={m} refData={refData} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {connecting ? <ConnectGmailDialog refData={refData} onClose={() => setConnecting(false)} /> : null}
    </Card>
  );
}

function MailboxRow({ m, refData, onChanged }: { m: MailboxOut; refData: Reference; onChanged: () => void }) {
  const f = useFmt();
  const { t } = f;
  const toast = useToast();
  const now = useNow(30000);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  async function run(kind: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(kind);
    try {
      await fn();
      if (done) toast(done);
      invalidateCache("/api/integrations");
      invalidateCache("/api/mailboxes");
      invalidateCache("/api/inbox");
      onChanged();
    } catch (err) {
      toast(errorMessage(err), { kind: "error" });
    } finally {
      setBusy(null);
    }
  }
  const statusCls = m.status === "connected" ? "bg-success-soft text-success-text" : m.status === "error" ? "bg-danger-soft text-danger-text" : "bg-surface-3 text-fg-3";
  return (
    <tr className="align-top">
      <td className="px-4 py-2.5">
        <div className="font-medium text-fg">{m.email_address}</div>
        {m.display_name ? <div className="text-xs text-fg-3">{m.display_name}</div> : null}
        {m.last_error ? <div className="mt-0.5 text-xs text-danger-text">{m.last_error}</div> : null}
      </td>
      <td className="px-3 py-2.5">
        <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", statusCls)}>{t(`crm.mb.${m.status}` as Key)}</span>
      </td>
      <td className="px-3 py-2.5">
        <DepartmentSelect
          refData={refData}
          value={m.department?.id ?? ""}
          onChange={(v) => void run("dept", () => api.patchMailbox(m.id, { department_id: v || null }), t("crm.saved_short"))}
          emptyLabel={t("dept.unrouted")}
          disabled={busy !== null}
          className="h-8 w-full"
        />
      </td>
      <td className="px-3 py-2.5 text-xs text-fg-2">
        {m.last_sync_at ? f.ago(m.last_sync_at, now) : "—"}
        <div className="text-fg-3">{t("crm.int.messages_n", { n: m.message_count })}</div>
      </td>
      <td className={cx("px-3 py-2.5 text-right tabular-nums", m.unanswered > 0 && "font-semibold text-danger-text")}>{f.count(m.unanswered)}</td>
      <td className="px-3 py-2.5">
        <Toggle
          checked={m.is_enabled}
          disabled={busy !== null}
          label={t("crm.int.enabled")}
          onChange={(v) => void run("toggle", () => api.patchMailbox(m.id, { is_enabled: v }))}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <Button size="xs" variant="ghost" busy={busy === "sync"} disabled={busy !== null} onClick={() => void run("sync", () => api.syncMailbox(m.id), t("crm.int.synced"))}>
          <RefreshCw />
          {t("crm.int.sync_now")}
        </Button>
        <Button size="xs" variant="ghost" className="text-danger-text" disabled={busy !== null} onClick={() => setConfirm(true)}>
          <Trash2 />
          {t("crm.int.disconnect")}
        </Button>
        {confirm ? (
          <Modal
            open
            title={t("crm.int.disconnect_title")}
            onClose={() => setConfirm(false)}
            icon={<Trash2 />}
            footer={
              <>
                <Button onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
                <Button
                  variant="danger"
                  busy={busy === "delete"}
                  onClick={() =>
                    void run("delete", () => api.deleteMailbox(m.id), t("crm.int.disconnected")).then(() => setConfirm(false))
                  }
                >
                  {t("crm.int.disconnect")}
                </Button>
              </>
            }
          >
            <p className="whitespace-normal text-left text-sm text-fg-2">{t("crm.int.disconnect_explain", { email: m.email_address })}</p>
          </Modal>
        ) : null}
      </td>
    </tr>
  );
}

function ConnectGmailDialog({ refData, onClose }: { refData: Reference; onClose: () => void }) {
  const { t } = useFmt();
  const [dept, setDept] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const { auth_url } = await api.gmailConnect({ department_id: dept || null });
      // Google's consent screen, in this tab; the backend sends us back to /settings?tab=integrations&gmail=…
      window.location.assign(auth_url);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={t("crm.int.connect_gmail")}
      onClose={onClose}
      icon={<Mail />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" busy={busy} onClick={() => void go()}>
            {t("crm.int.continue_google")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-fg-2">{t("crm.int.connect_explain")}</p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-fg-2">{t("crm.int.route_to")}</span>
          <DepartmentSelect refData={refData} value={dept} onChange={setDept} emptyLabel={t("crm.int.route_later")} className="w-full" />
        </label>
        {error ? <ErrorBanner error={error} /> : null}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- TMS

function TmsCard({ data, onImported }: { data: IntegrationsOut | undefined; onImported: () => void }) {
  const f = useFmt();
  const { t } = f;
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LoadImportOut | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const loads = useApi<LoadOut[]>(paths.loads(dq));

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const csv = await file.text();
      const out = await api.importLoads(csv);
      setResult(out);
      toast(t("crm.tms.imported", { created: out.created, updated: out.updated }));
      invalidateCache("/api/loads");
      loads.reload();
      onImported();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t("crm.int.tms")}
      icon={<Database />}
      actions={
        <>
          <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e)} aria-label={t("crm.tms.choose_csv")} />
          <Button size="sm" busy={busy} onClick={() => input.current?.click()}>
            <FileUp />
            {t("crm.tms.import_csv")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-xs text-fg-3">{t("crm.tms.loads")}</div>
            <div className="text-lg font-semibold tabular-nums text-fg">{data ? f.count(data.tms.loads) : "—"}</div>
          </div>
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-xs text-fg-3">{t("crm.tms.last_import")}</div>
            <div className="text-sm font-medium text-fg">{data?.tms.last_import_at ? f.dateTime(data.tms.last_import_at) : "—"}</div>
          </div>
        </div>
        <p className="text-xs text-fg-3">{t("crm.tms.hint")}</p>
        {error ? <ErrorBanner error={error} /> : null}
        {result ? (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
            <div className="font-medium text-fg">{t("crm.tms.imported", { created: result.created, updated: result.updated })}</div>
            {result.errors.length ? (
              <ul className="mt-1 max-h-28 list-disc overflow-y-auto pl-5 text-xs text-danger-text">
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
          <input
            type="search"
            className={cx(inputCls, "h-9 pl-8")}
            placeholder={t("crm.tms.search")}
            aria-label={t("crm.tms.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {loads.error && !loads.data ? <p className="text-sm text-danger-text">{errorMessage(loads.error)}</p> : null}
        {loads.data && loads.data.length === 0 ? <p className="text-sm text-fg-3">{dq ? t("crm.tms.no_match") : t("crm.tms.empty")}</p> : null}
        {loads.data && loads.data.length ? (
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="sticky top-0 bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
                <tr>
                  <th className="px-3 py-2">{t("crm.tms.load")}</th>
                  <th className="px-3 py-2">{t("crm.tms.truck_trailer")}</th>
                  <th className="px-3 py-2">{t("crm.f.driver")}</th>
                  <th className="px-3 py-2">{t("crm.tms.broker")}</th>
                  <th className="px-3 py-2">{t("crm.tms.route")}</th>
                  <th className="px-3 py-2 text-right">{t("crm.os.unresolved")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loads.data.slice(0, 100).map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 font-mono font-medium text-fg">
                      {l.load_ref}
                      {l.status ? <div className="font-sans text-xs font-normal text-fg-3">{l.status}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-fg-2">{[l.truck_unit, l.trailer_ref].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="px-3 py-2 text-fg-2">
                      {l.driver_name ?? "—"}
                      {l.driver_phone ? <div className="text-xs text-fg-3">{l.driver_phone}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-fg-2">{l.broker ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-fg-2">{[l.pickup, l.delivery].filter(Boolean).join(" → ") || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.open_issues ? <span className="font-semibold text-fg">{l.open_issues}</span> : <span className="text-fg-4">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loads.data && loads.loading ? <Skeleton className="h-24 w-full rounded-lg" /> : null}
      </div>
    </Card>
  );
}
