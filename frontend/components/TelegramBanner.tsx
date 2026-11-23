"use client";

import { useEffect, useState } from "react";
import { Button, ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { TelegramLinkOut } from "@/lib/types";

/** Shown until the user links Telegram: then the bot sends them their tasks with buttons. */
export function TelegramBanner() {
  const { me, reloadMe } = useMe();
  const { t } = useT();
  const [link, setLink] = useState<TelegramLinkOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const hideKey = `smart-truck.tg-banner-hidden.${me.id}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(hideKey) === "1";
    } catch {
      return false;
    }
  });

  // after pressing Start in Telegram the user comes back to this tab: re-read the account then
  useEffect(() => {
    if (!link) return;
    const onFocus = () => void reloadMe().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [link, reloadMe]);

  if (hidden || me.telegram_linked || me.role === "viewer") return null;

  function hide() {
    setHidden(true);
    try {
      window.localStorage.setItem(hideKey, "1");
    } catch {
      /* hidden for this visit only */
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      setLink(await api.telegramLink());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-blue-900">{t("tg.banner")}</p>
      <ErrorBox error={error} />
      {!link ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void connect()}>
            {t("tg.connect")}
          </Button>
          <Button variant="white" onClick={hide}>
            {t("tg.hide")}
          </Button>
        </div>
      ) : link.deep_link ? (
        <a href={link.deep_link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block font-semibold">
          {t("tg.open_bot")} →
        </a>
      ) : (
        <p className="mt-3 text-gray-800">
          {t("tg.send_code")} <code className="rounded bg-white px-2 py-1 font-mono text-sm break-all">/start {link.token}</code>
        </p>
      )}
    </div>
  );
}
