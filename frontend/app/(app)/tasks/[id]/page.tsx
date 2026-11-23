"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button, Card, ErrorBox, Loading, STAGE_COLOR, Tag, dateTime, inputCls, stageOf, taskTitle } from "@/components/ui";
import { api, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { invalidateCache, useApi } from "@/lib/hooks";
import { useT, type Key } from "@/lib/i18n";
import type { TaskDetailOut, TaskStatus, TransitionIn, UserOut } from "@/lib/types";

const STAGE_LABEL: Record<ReturnType<typeof stageOf>, Key> = {
  new: "stage.new",
  doing: "stage.doing",
  check: "stage.check",
  done: "stage.done",
  cancelled: "stage.cancelled",
};

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{children}</dd>
    </div>
  );
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { tz } = useMe();
  const { t, lang, locale } = useT();
  const task = useApi<TaskDetailOut>(paths.task(id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [person, setPerson] = useState("");

  const d = task.data;
  const allowed = new Set<TaskStatus>(d?.allowed_transitions ?? []);
  const isNew = d ? stageOf(d.status) === "new" : false;
  const canGive = !!d && isNew && allowed.has("assigned") && d.can_assign;
  const users = useApi<UserOut[]>(canGive ? paths.users() : null);
  const people = (users.data ?? []).filter((u) => u.is_active && u.role !== "viewer");

  if (task.error && !d) {
    return (
      <>
        <BackLink />
        <ErrorBox error={task.error} onRetry={task.reload} retryLabel={t("common.retry")} />
      </>
    );
  }
  if (!d) return <Loading text={t("common.loading")} />;

  async function move(body: TransitionIn) {
    setBusy(true);
    setError(null);
    try {
      task.setData(await api.transition(id, body));
      invalidateCache("/api/tasks");
      invalidateCache("/api/dashboard");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const stage = stageOf(d.status);
  const summary = d.i18n?.[lang]?.summary || d.description;
  const source = d.messages.find((m) => m.relation === "source") ?? d.messages[0];
  const text = d.source_text || source?.text || source?.transcript;
  const truck = d.truck?.unit_number ?? d.truck_unit_raw;
  const from = d.group?.title ?? d.mailbox?.email_address ?? null;

  const actions: ReactNode[] = [];
  if (allowed.has("in_progress") && d.status === "assigned") {
    actions.push(
      <Button key="start" big disabled={busy} onClick={() => void move({ to_status: "in_progress" })}>
        {t("issue.start")}
      </Button>,
    );
  }
  if (allowed.has("in_progress") && d.status === "blocked") {
    actions.push(
      <Button key="continue" big disabled={busy} onClick={() => void move({ to_status: "in_progress" })}>
        {t("issue.continue")}
      </Button>,
    );
  }
  if (allowed.has("pending_verification") && (d.status === "assigned" || d.status === "in_progress")) {
    actions.push(
      <Button key="done" big variant="green" disabled={busy} onClick={() => void move({ to_status: "pending_verification" })}>
        {t("issue.done")}
      </Button>,
    );
  }
  if (allowed.has("completed") && d.status === "pending_verification") {
    actions.push(
      <Button key="confirm" big variant="green" disabled={busy} onClick={() => void move({ to_status: "completed" })}>
        {t("issue.confirm")}
      </Button>,
    );
  }
  if (allowed.has("in_progress") && d.status === "pending_verification") {
    actions.push(
      <Button key="back" big variant="white" disabled={busy} onClick={() => void move({ to_status: "in_progress", reason: t("issue.reason_send_back") })}>
        {t("issue.send_back")}
      </Button>,
    );
  }
  if (allowed.has("cancelled") && isNew) {
    actions.push(
      <Button key="cancel" big variant="red" disabled={busy} onClick={() => void move({ to_status: "cancelled", reason: t("issue.reason_not_issue") })}>
        {t("issue.not_issue")}
      </Button>,
    );
  }

  return (
    <>
      <BackLink />

      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Tag color={STAGE_COLOR[stage]}>{t(STAGE_LABEL[stage])}</Tag>
          {d.priority === "P1" && <Tag color="red">{t("issues.urgent")}</Tag>}
          {d.is_overdue && <Tag color="red">{t("issues.late")}</Tag>}
          {d.status === "blocked" && <Tag color="yellow">{t("stage.waiting")}</Tag>}
          <span className="text-sm text-gray-400">{d.code}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{taskTitle(d, lang)}</h1>
        {summary && <p className="mt-2 text-gray-700">{summary}</p>}
      </div>

      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-lg font-bold">{t("issue.what_now")}</h2>
        <ErrorBox error={error} />
        {canGive && (
          <div className="mb-3 flex flex-wrap gap-2">
            <select aria-label={t("issue.choose_person")} value={person} onChange={(e) => setPerson(e.target.value)} className={`${inputCls} sm:max-w-xs`}>
              <option value="">{t("issue.choose_person")}</option>
              {people.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
            <Button big disabled={busy || !person} onClick={() => void move({ to_status: "assigned", assignee_id: person })}>
              {t("issue.give")}
            </Button>
          </div>
        )}
        {actions.length > 0 && <div className="flex flex-wrap gap-2">{actions}</div>}
        {!canGive && actions.length === 0 && (
          <p className="text-gray-600">{stage === "done" || stage === "cancelled" ? t("issue.finished") : t("issue.nothing_to_do")}</p>
        )}
      </Card>

      <Card className="mb-4 p-5">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Info label={t("issue.who")}>{d.assignee?.full_name ?? t("common.nobody")}</Info>
          {truck && <Info label={t("issue.truck")}>#{truck}</Info>}
          {d.department && <Info label={t("issue.department")}>{d.department.name}</Info>}
          {d.due_at && <Info label={t("issue.due")}>{dateTime(d.due_at, locale, tz)}</Info>}
          {from && <Info label={t("issue.from")}>{from}</Info>}
          {d.load_ref && <Info label={t("issue.load")}>{d.load_ref}</Info>}
        </dl>
      </Card>

      {text && (
        <Card className="p-5">
          <h2 className="mb-2 text-lg font-bold">{t("issue.message")}</h2>
          {source && (
            <p className="mb-2 text-sm text-gray-500">
              {source.sender_name} · {dateTime(source.sent_at, locale, tz)}
            </p>
          )}
          <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-gray-800">{text}</p>
          {source?.telegram_link && (
            <a href={source.telegram_link} target="_blank" rel="noreferrer" className="mt-3 inline-block font-medium">
              {t("issue.open_telegram")} →
            </a>
          )}
        </Card>
      )}
    </>
  );
}

function BackLink() {
  const { t } = useT();
  return (
    <Link href="/" className="mb-4 inline-block font-medium">
      ← {t("common.back")}
    </Link>
  );
}
