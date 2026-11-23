"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Empty, ErrorBox, Loading, PageTitle, cx, duration, taskTitle } from "@/components/ui";
import { api, paths } from "@/lib/api";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { ConversationOut } from "@/lib/types";

/** Messages that still wait for a reply, oldest first; red after the 5-minute limit. */
export default function MessagesPage() {
  const { t, lang, locale } = useT();
  const now = useNow(15000);
  const inbox = useApi<ConversationOut[]>(paths.inbox({ state: "unanswered" }), { refreshMs: 15000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const items = [...(inbox.data ?? [])]
    .filter((c) => c.oldest_pending)
    .sort((a, b) => Date.parse(a.oldest_pending!.started_at) - Date.parse(b.oldest_pending!.started_at));

  async function noReply(c: ConversationOut) {
    if (!c.oldest_pending) return;
    setBusy(c.key);
    setError(null);
    try {
      await api.noResponse(c.oldest_pending.id, t("messages.reason"));
      invalidateCache("/api/dashboard");
      inbox.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle title={t("messages.title")} subtitle={t("messages.subtitle")} />
      <ErrorBox error={error ?? inbox.error} onRetry={inbox.reload} retryLabel={t("common.retry")} />

      {!inbox.data && !inbox.error ? (
        <Loading text={t("common.loading")} />
      ) : inbox.data && items.length === 0 ? (
        <Empty text={t("messages.empty")} />
      ) : (
        <ul className="space-y-3">
          {items.map((c) => {
            const clock = c.oldest_pending!;
            const waited = (now - Date.parse(clock.started_at)) / 1000;
            const late = now > Date.parse(clock.due_at) || clock.critical;
            return (
              <li key={c.key}>
                <Card className={cx("p-4", late && "border-red-300 bg-red-50")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{c.channel_name}</p>
                      <p className="text-sm text-gray-500">{c.last_message.sender_name}</p>
                    </div>
                    <span className={cx("rounded-full px-3 py-1 text-sm font-bold", late ? "bg-red-600 text-white" : "bg-yellow-100 text-yellow-800")}>
                      {t("messages.waiting", { d: duration(waited, locale) })}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-gray-800">{c.last_message.preview}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button variant="white" disabled={busy === c.key} onClick={() => void noReply(c)}>
                      {t("messages.no_reply")}
                    </Button>
                    {c.task && (
                      <Link href={`/tasks/${c.task.id}`} className="font-medium">
                        {t("messages.open_issue")}: {taskTitle(c.task, lang)} →
                      </Link>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
