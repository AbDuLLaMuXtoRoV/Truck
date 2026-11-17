"use client";

import { ArrowLeft, ChevronDown, Clock, MessageSquare, Send, Timer, Truck as TruckIcon, User, Workflow } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { KeyDates, MergeCard, PropertiesCard } from "../AdvancedTaskDetail";
import { Avatar } from "../avatars";
import { SlaBar } from "../due";
import { useCrumb } from "../Shell";
import { MessageCard, Timeline } from "../TaskParts";
import { TransitionBar } from "../TransitionBar";
import { Button, Card, Empty, Skeleton, cx, focusRing, inputCls } from "../ui";
import { ApiError, api, errorMessage, paths } from "@/lib/api";
import { useFmt } from "@/lib/format";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import { useReference, type Reference } from "@/lib/reference";
import { plainDue, simpleActions } from "@/lib/stage";
import type { TaskDetailOut } from "@/lib/types";
import { SimpleActions } from "./Actions";
import { BigButton, StagePill, Stepper } from "./parts";
import { UrgentTag, truckLabel } from "./TaskCard";
import { usePageTitle } from "./tips";

/** The simple-mode task page: what, where, who, by when, the Telegram message, the buttons. */
export function SimpleTaskPage() {
  const params = useParams<{ id: string }>();
  const res = useApi<TaskDetailOut>(paths.task(params.id));
  const refData = useReference();
  const { t } = useFmt();
  const task = res.stale ? undefined : res.data;
  usePageTitle(t("s.task_title"));
  useCrumb(task?.code ?? null);

  const update = (next: TaskDetailOut) => {
    res.setData(next);
    invalidateCache("/api/tasks");
    invalidateCache("/api/dashboard");
  };

  if (res.error && !task) {
    const missing = res.error instanceof ApiError && res.error.status === 404;
    return (
      <div className="space-y-4">
        <BackButton />
        <div className="rounded-2xl border border-line bg-surface">
          <Empty
            illustration="search"
            title={missing ? t("s.task_not_found") : t("s.task_load_failed")}
            action={
              missing ? null : (
                <Button variant="primary" onClick={res.reload}>
                  {t("common.try_again")}
                </Button>
              )
            }
          >
            {missing ? t("s.task_not_found_text") : errorMessage(res.error)}
          </Empty>
        </div>
      </div>
    );
  }
  if (!task) {
    return (
      <div className="space-y-4" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-11 w-28 rounded-xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  return <SimpleTaskView task={task} refData={refData} onChange={update} />;
}

function BackButton() {
  const { t } = useFmt();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className={cx("inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-base font-semibold text-fg-2 shadow-xs hover:bg-surface-2", focusRing)}
    >
      <ArrowLeft className="size-5" aria-hidden />
      {t("s.back")}
    </button>
  );
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="text-fg-3 [&_svg]:size-5" aria-hidden>
        {icon}
      </span>
      <dt className="w-24 shrink-0 text-[15px] text-fg-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-base font-semibold text-fg">{children}</dd>
    </div>
  );
}

/** The latest "sent back" (checking → in work) reason, if that is how the task got to where it is. */
function sendBackReason(task: TaskDetailOut): string | null {
  const moves = task.events.filter((e) => e.to_status !== null && e.from_status !== null);
  const last = moves[moves.length - 1];
  return last && last.from_status === "pending_verification" && last.to_status === "in_progress" ? last.reason : null;
}

function SimpleTaskView({ task, refData, onChange }: { task: TaskDetailOut; refData: Reference; onChange: (t: TaskDetailOut) => void }) {
  const f = useFmt();
  const { t } = f;
  const now = useNow(60000);
  const [more, setMore] = useState(false);
  const due = plainDue(task.due_at, task.status, now, f.tz, f.locale, t);
  const truck = truckLabel(task, t);
  const returned = task.status === "in_progress" ? sendBackReason(task) : null;
  const messages = [...task.messages.filter((m) => m.relation === "source"), ...task.messages.filter((m) => m.relation !== "source")];
  const hasActions = simpleActions(task.status, task.allowed_transitions).length > 0;

  return (
    <div className="space-y-5">
      <BackButton />
      <p className="text-base text-fg-2">{t("s.task_intro")}</p>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <StagePill status={task.status} large />
          {task.priority === "P1" ? <UrgentTag /> : null}
          <span className="ml-auto text-xs text-fg-4">{task.code}</span>
        </div>
        <h2 className="mt-3 text-2xl font-bold leading-tight tracking-tight text-fg">{f.title(task)}</h2>
        {task.status !== "cancelled" ? (
          <div className="mt-5">
            <Stepper status={task.status} />
          </div>
        ) : null}
        <dl className="mt-5 divide-y divide-line rounded-xl border border-line">
          <InfoRow icon={<TruckIcon />} label={t("s.f_truck")}>
            {truck ?? <span className="font-normal text-fg-3">{t("s.no_truck")}</span>}
          </InfoRow>
          <InfoRow icon={<User />} label={t("s.f_who")}>
            {task.assignee ? (
              <span className="inline-flex items-center gap-2">
                <Avatar name={task.assignee.full_name} size="sm" />
                {task.assignee.full_name}
              </span>
            ) : (
              <span className="font-normal text-fg-3">{t("s.nobody")}</span>
            )}
          </InfoRow>
          <InfoRow icon={<Clock />} label={t("s.f_due")}>
            <span className={due.late ? "text-danger-text" : undefined}>{due.text}</span>
          </InfoRow>
        </dl>
        {task.status === "blocked" && task.blocked_reason ? (
          <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-base text-rose-800 dark:text-rose-200">
            <span className="font-semibold">{t("s.waiting_for")} </span>
            {task.blocked_reason}
          </p>
        ) : null}
        {returned ? (
          <p className="mt-4 rounded-xl bg-amber-500/12 px-4 py-3 text-base text-amber-900 dark:text-amber-200">
            <span className="font-semibold">{t("s.sent_back_because")} </span>
            {returned}
          </p>
        ) : null}
        {task.status === "cancelled" && task.cancel_reason ? (
          <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-base text-fg-2">
            <span className="font-semibold">{t("s.cancelled_because")} </span>
            {task.cancel_reason}
          </p>
        ) : null}
        {task.merged_into_id ? (
          <Link href={`/tasks/${task.merged_into_id}`} className="mt-4 inline-flex min-h-11 items-center text-base font-semibold text-accent-text hover:underline">
            {t("s.open_main_task")}
          </Link>
        ) : null}
      </section>

      {messages.length || task.source_text ? (
        <section className="space-y-2">
          <h3 className="text-lg font-bold text-fg">{t("s.tg_message")}</h3>
          <div className="space-y-4 rounded-2xl border border-line bg-surface-2 p-4">
            {messages.length ? (
              messages.map((m) => <MessageCard key={m.id} message={m} />)
            ) : (
              <blockquote className="whitespace-pre-wrap break-words border-l-4 border-sky-400 pl-3 text-base text-fg">{task.source_text}</blockquote>
            )}
          </div>
        </section>
      ) : null}

      {hasActions ? (
        <section className="space-y-2">
          <h3 className="text-lg font-bold text-fg">{t("s.what_next")}</h3>
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <SimpleActions key={task.status} task={task} refData={refData} onChanged={onChange} />
          </div>
        </section>
      ) : null}

      <CommentPanel task={task} onChange={onChange} />

      <section>
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className={cx("flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 text-base font-semibold text-fg-2 hover:bg-surface-2", focusRing)}
        >
          {t("s.more_details")}
          <ChevronDown className={cx("size-5 transition-transform", more && "rotate-180")} aria-hidden />
        </button>
        {more ? (
          <div className="mt-4 animate-fade-in space-y-4">
            {task.allowed_transitions.length ? (
              <Card title={t("s.all_actions")} icon={<Workflow />}>
                <TransitionBar task={task} refData={refData} onChanged={onChange} />
              </Card>
            ) : null}
            <PropertiesCard task={task} refData={refData} onChange={onChange} />
            <Card title={t("sla.title")} icon={<Timer />}>
              <SlaBar createdAt={task.created_at} dueAt={task.due_at} status={task.status} now={now} />
            </Card>
            <KeyDates task={task} now={now} />
            <Card title={t("detail.activity")} icon={<MessageSquare />}>
              <Timeline events={task.events} refData={refData} now={now} />
            </Card>
            {task.allowed_transitions.includes("cancelled") && !task.merged_into_id ? <MergeCard task={task} /> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CommentPanel({ task, onChange }: { task: TaskDetailOut; onChange: (t: TaskDetailOut) => void }) {
  const f = useFmt();
  const { t } = f;
  const now = useNow(60000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const comments = task.events.filter((e) => e.type === "comment" && e.reason).slice(-3).reverse();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.comment(task.id, { text: text.trim() }));
      setText("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-lg font-bold text-fg">
        <label htmlFor="simple-comment">{t("s.comment_title")}</label>
      </h3>
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <textarea
          id="simple-comment"
          className={cx(inputCls, "min-h-24 text-base")}
          maxLength={4000}
          placeholder={t("s.comment_placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">{errorMessage(error)}</p> : null}
        <BigButton type="submit" variant="secondary" icon={<Send />} busy={busy} disabled={!text.trim()}>
          {t("s.comment_send")}
        </BigButton>
        {comments.length ? (
          <ul className="space-y-2 border-t border-line pt-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-xl bg-surface-2 px-3 py-2">
                <div className="text-sm font-semibold text-fg">
                  {c.actor?.full_name ?? t("s.system")} <span className="font-normal text-fg-3">· {f.ago(c.created_at, now)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[15px] text-fg-2">{c.reason}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    </section>
  );
}
