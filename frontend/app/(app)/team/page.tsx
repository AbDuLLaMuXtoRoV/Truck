"use client";

import { Info, Send, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Avatar } from "@/components/avatars";
import { DepartmentSelect, UserSelect } from "@/components/pickers";
import { useToast } from "@/components/toast";
import { Button, Card, Empty, ErrorBanner, Field, Modal, NoAccess, PageHeader, SkeletonTable, Toggle, cx, inputCls, selectCls } from "@/components/ui";
import { api, errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import { LANGS, type Key } from "@/lib/i18n";
import { useReference, type Reference } from "@/lib/reference";
import { ROLES, type Language, type Role, type TelegramIdentityOut, type UserOut } from "@/lib/types";

export default function TeamPage() {
  const { can } = useMe();
  const { t } = useFmt();
  if (!can("users.manage")) return <NoAccess message={t("crm.admin_only")} />;
  return (
    <div className="space-y-5">
      <PageHeader icon={<Users />} title={t("crm.nav.team")} subtitle={t("crm.team_sub")} />
      <UsersCard />
      <RosterCard />
    </div>
  );
}

// --------------------------------------------------------------------------- users

function UsersCard() {
  const { me } = useMe();
  const f = useFmt();
  const { t } = f;
  const refData = useReference();
  const toast = useToast();
  const res = useApi<UserOut[]>(paths.users({ active: false }), { refreshMs: 60000 });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const roles = ROLES.filter((r) => r !== "owner" || me.role === "owner");

  async function patch(u: UserOut, body: Parameters<typeof api.patchUser>[1]) {
    setBusy(u.id);
    try {
      await api.patchUser(u.id, body);
      invalidateCache("/api/users");
      res.reload();
      toast(t("crm.saved_short"));
    } catch (err) {
      toast(errorMessage(err), { kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  const users = [...(res.data ?? [])].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.full_name.localeCompare(b.full_name));
  return (
    <Card
      title={t("crm.users")}
      icon={<ShieldCheck />}
      subtitle={t("crm.users_sub")}
      actions={
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
          <UserPlus />
          {t("crm.add_user")}
        </Button>
      }
    >
      {res.error && !res.data ? <ErrorBanner error={res.error} onRetry={res.reload} /> : null}
      {!res.data && res.loading ? <SkeletonTable rows={5} /> : null}
      {res.data ? (
        <div className="-m-4 overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
              <tr>
                <th className="px-4 py-2.5">{t("crm.user")}</th>
                <th className="w-44 px-3 py-2.5">{t("crm.role")}</th>
                <th className="w-52 px-3 py-2.5">{t("crm.col.department")}</th>
                <th className="px-3 py-2.5">{t("crm.telegram")}</th>
                <th className="px-3 py-2.5">{t("crm.active")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => {
                const self = u.id === me.id;
                const locked = self || (u.role === "owner" && me.role !== "owner") || busy === u.id;
                return (
                  <tr key={u.id} className={cx(!u.is_active && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.full_name} size="md" />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-fg">
                            {u.full_name}
                            {self ? <span className="ml-1.5 text-xs font-normal text-fg-3">({t("crm.you")})</span> : null}
                          </div>
                          <div className="truncate text-xs text-fg-3">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        aria-label={t("crm.role_of", { name: u.full_name })}
                        className={cx(selectCls, "h-8")}
                        value={u.role}
                        disabled={locked}
                        onChange={(e) => void patch(u, { role: e.target.value as Role })}
                      >
                        {(roles.includes(u.role) ? roles : [u.role, ...roles]).map((r) => (
                          <option key={r} value={r}>
                            {f.role(r)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <DepartmentSelect
                        refData={refData}
                        value={u.department_id ?? ""}
                        disabled={busy === u.id}
                        onChange={(v) => void patch(u, { department_id: v || null })}
                        emptyLabel={t("crm.no_department")}
                        className="h-8 w-full"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cx("rounded-full px-2 py-0.5 text-xs font-medium", u.telegram_linked ? "bg-success-soft text-success-text" : "bg-surface-3 text-fg-3")}>
                        {u.telegram_linked ? t("tg.linked") : t("tg.not_linked")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Toggle checked={u.is_active} disabled={locked} label={t("crm.active")} onChange={(v) => void patch(u, { is_active: v })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {adding ? (
        <AddUserDialog
          refData={refData}
          roles={roles}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            invalidateCache("/api/users");
            res.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function AddUserDialog({ refData, roles, onClose, onDone }: { refData: Reference; roles: readonly Role[]; onClose: () => void; onDone: () => void }) {
  const f = useFmt();
  const { t } = f;
  const toast = useToast();
  const [form, setForm] = useState({ full_name: "", email: "", password: "", role: "agent" as Role, department_id: "", language: "uz" as Language });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((p) => ({ ...p, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await api.createUser({ ...form, full_name: form.full_name.trim(), email: form.email.trim(), department_id: form.department_id || null });
      toast(t("crm.user_added", { name: u.full_name }));
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      wide
      title={t("crm.add_user")}
      onClose={onClose}
      icon={<UserPlus />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" type="submit" form="crm-add-user" busy={busy}>
            {t("crm.add_user")}
          </Button>
        </>
      }
    >
      <form id="crm-add-user" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.full_name")}>
          {(id) => <input id={id} className={inputCls} required maxLength={120} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />}
        </Field>
        <Field label={t("login.email")}>
          {(id) => <input id={id} className={inputCls} required inputMode="email" autoComplete="off" value={form.email} onChange={(e) => set("email", e.target.value)} />}
        </Field>
        <Field label={t("crm.temp_password")} hint={t("crm.temp_password_hint")}>
          {(id) => <input id={id} className={inputCls} required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} />}
        </Field>
        <Field label={t("crm.role")}>
          {(id) => (
            <select id={id} className={selectCls} value={form.role} onChange={(e) => set("role", e.target.value as Role)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {f.role(r)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("crm.col.department")}>
          {(id) => <DepartmentSelect id={id} refData={refData} value={form.department_id} onChange={(v) => set("department_id", v)} emptyLabel={t("crm.no_department")} />}
        </Field>
        <Field label={t("lang.switch")}>
          {(id) => (
            <select id={id} className={selectCls} value={form.language} onChange={(e) => set("language", e.target.value as Language)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </Field>
        {error ? (
          <div className="sm:col-span-2">
            <ErrorBanner error={error} />
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- telegram roster

function RosterCard() {
  const f = useFmt();
  const { t } = f;
  const refData = useReference();
  const toast = useToast();
  const now = useNow(60000);
  const res = useApi<TelegramIdentityOut[]>(paths.rosterTelegram(), { refreshMs: 60000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "staff" | "external">("all");

  async function patch(row: TelegramIdentityOut, body: Parameters<typeof api.patchTelegramIdentity>[1]) {
    setBusy(row.id);
    try {
      const next = await api.patchTelegramIdentity(row.id, body);
      res.setData((prev) => (prev ?? []).map((x) => (x.id === row.id ? next : x)));
      invalidateCache("/api/inbox");
      toast(t("crm.saved_short"));
    } catch (err) {
      toast(errorMessage(err), { kind: "error" });
    } finally {
      setBusy(null);
    }
  }

  const rows = (res.data ?? []).filter((r) => filter === "all" || (filter === "staff" ? r.is_staff : !r.is_staff));
  return (
    <Card title={t("crm.roster")} icon={<Send />} subtitle={t("crm.roster_sub")}>
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/8 px-3 py-2 text-sm text-fg-2">
        <Info className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden />
        {t("crm.roster_explain")}
      </div>
      <div className="mb-3 flex gap-1.5" role="group" aria-label={t("crm.filters")}>
        {(["all", "staff", "external"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={cx(
              "rounded-full border px-3 py-1 text-sm",
              filter === k ? "border-accent bg-accent-soft font-medium text-fg" : "border-line text-fg-2 hover:bg-surface-2",
            )}
          >
            {t(`crm.roster_${k}` as Key)}
            {res.data ? (
              <span className="ml-1 tabular-nums text-fg-4">
                {k === "all" ? res.data.length : res.data.filter((r) => (k === "staff" ? r.is_staff : !r.is_staff)).length}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {res.error && !res.data ? <ErrorBanner error={res.error} onRetry={res.reload} /> : null}
      {!res.data && res.loading ? <SkeletonTable rows={5} /> : null}
      {res.data && rows.length === 0 ? <Empty illustration="chat" compact>{t("crm.roster_empty")}</Empty> : null}
      {rows.length ? (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
              <tr>
                <th className="px-4 py-2.5">{t("crm.tg_identity")}</th>
                <th className="px-3 py-2.5">{t("crm.last_seen")}</th>
                <th className="px-3 py-2.5 text-right">{t("crm.messages")}</th>
                <th className="px-3 py-2.5">{t("crm.staff")}</th>
                <th className="w-60 px-3 py-2.5">{t("crm.linked_user")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className={r.is_staff ? "bg-emerald-500/5" : undefined}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.display_name} size="md" />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-fg">{r.display_name}</div>
                        <div className="truncate text-xs text-fg-3">
                          {r.username ? `@${r.username} · ` : ""}
                          <span className="font-mono">{r.tg_user_id}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-fg-2">{r.last_seen_at ? f.ago(r.last_seen_at, now) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{f.count(r.message_count)}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <Toggle checked={r.is_staff} disabled={busy === r.id} label={t("crm.staff_of", { name: r.display_name })} onChange={(v) => void patch(r, { is_staff: v })} />
                      <span className={cx("text-xs", r.is_staff ? "font-medium text-success-text" : "text-fg-3")}>{r.is_staff ? t("crm.staff") : t("crm.external")}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <UserSelect
                      refData={refData}
                      value={r.linked_user?.id ?? ""}
                      onChange={(v) => void patch(r, v ? { linked_user_id: v, is_staff: true } : { linked_user_id: null })}
                      placeholder={t("crm.not_linked")}
                      disabled={busy === r.id}
                      className="h-8 w-full"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
