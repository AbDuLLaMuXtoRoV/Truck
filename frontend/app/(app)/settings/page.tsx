"use client";

import { useState } from "react";
import { Button, Card, ErrorBox, Loading, PageTitle, Tag } from "@/components/ui";
import { api, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { invalidateCache, useApi } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { GroupOut, TelegramIdentityOut } from "@/lib/types";

/** Two things only: which Telegram groups the bot reads, and who in Telegram is staff. */
export default function SettingsPage() {
  const { can } = useMe();
  const { t } = useT();

  if (!can("groups.manage")) {
    return (
      <>
        <PageTitle title={t("settings.title")} />
        <Card className="p-5 text-gray-600">{t("settings.only_admin")}</Card>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("settings.title")} />
      <Groups />
      {can("users.manage") && <Staff />}
    </>
  );
}

function Groups() {
  const { t } = useT();
  const groups = useApi<GroupOut[]>(paths.groups());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  // groups waiting to be turned on first, then by name
  const list = [...(groups.data ?? [])].sort((a, b) => Number(a.is_enabled) - Number(b.is_enabled) || a.title.localeCompare(b.title));

  async function toggle(g: GroupOut) {
    setBusy(g.id);
    setError(null);
    try {
      const updated = await api.patchGroup(g.id, { is_enabled: !g.is_enabled });
      groups.setData((prev) => (prev ?? []).map((x) => (x.id === g.id ? updated : x)));
      invalidateCache("/api/dashboard");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold">{t("settings.groups")}</h2>
      <p className="mb-3 text-gray-600">{t("settings.groups_hint")}</p>
      <ErrorBox error={error ?? groups.error} onRetry={groups.reload} retryLabel={t("common.retry")} />
      {!groups.data && !groups.error ? (
        <Loading text={t("common.loading")} />
      ) : list.length === 0 ? (
        groups.data && <Card className="p-5 text-gray-600">{t("settings.no_groups")}</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-gray-100">
            {list.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">{g.title}</p>
                  {!g.is_enabled && <p className="text-sm text-gray-500">{t("settings.new_group")}</p>}
                </div>
                <Tag color={g.is_enabled ? "green" : "gray"}>{g.is_enabled ? t("settings.on") : t("settings.off")}</Tag>
                <Button variant={g.is_enabled ? "white" : "blue"} disabled={busy === g.id} onClick={() => void toggle(g)}>
                  {g.is_enabled ? t("settings.turn_off") : t("settings.turn_on")}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function Staff() {
  const { t } = useT();
  const people = useApi<TelegramIdentityOut[]>(paths.rosterTelegram());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function toggle(p: TelegramIdentityOut) {
    setBusy(p.id);
    setError(null);
    try {
      const updated = await api.patchTelegramIdentity(p.id, { is_staff: !p.is_staff });
      people.setData((prev) => (prev ?? []).map((x) => (x.id === p.id ? updated : x)));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const list = people.data ?? [];

  return (
    <section>
      <h2 className="text-lg font-bold">{t("settings.staff")}</h2>
      <p className="mb-3 text-gray-600">{t("settings.staff_hint")}</p>
      <ErrorBox error={error ?? people.error} onRetry={people.reload} retryLabel={t("common.retry")} />
      {!people.data && !people.error ? (
        <Loading text={t("common.loading")} />
      ) : list.length === 0 ? (
        people.data && <Card className="p-5 text-gray-600">{t("settings.no_people")}</Card>
      ) : (
        <Card>
          <ul className="divide-y divide-gray-100">
            {list.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={p.is_staff}
                    disabled={busy === p.id}
                    onChange={() => void toggle(p)}
                    className="size-5 accent-blue-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-gray-900">{p.display_name}</span>
                    {p.username && <span className="ml-2 text-sm text-gray-500">@{p.username}</span>}
                  </span>
                  {p.is_staff && <Tag color="blue">{t("settings.staff_label")}</Tag>}
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
