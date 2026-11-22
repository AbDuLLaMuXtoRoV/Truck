"use client";

import { ArrowRight, Ban, Link2, Mail, Mic, PlusCircle, Search, Send } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { deptLabel } from "@/lib/crm";
import { isoToZonedInput, useFmt } from "@/lib/format";
import { invalidateCache, useApi, useDebounced, useNow } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import { PRIORITIES, TASK_CATEGORIES, type ConversationOut, type Priority, type Source, type TaskCategory, type ThreadMessageOut, type ThreadOut } from "@/lib/types";
import { AttachmentItem } from "../Attachment";
import { StatusBadge } from "../badges";
import { TaskPicker } from "../pickers";
import { useToast } from "../toast";
import { Button, Empty, ErrorBanner, Field, Modal, Skeleton, cx, focusRing, inputCls, selectCls } from "../ui";
import { ChannelIcon, CountdownPill, DeptPill } from "./parts";

/** "10:24" today, "20 Nov" before. */
export function useWhen(): (iso: string) => string {
  const f = useFmt();
  const now = useNow(60000);
  const today = isoToZonedInput(new Date(now).toISOString(), f.tz).slice(0, 10);
  return (iso) => (isoToZonedInput(iso, f.tz).slice(0, 10) === today ? f.time(iso) : f.date(iso));
}

function refreshAfterChange() {
  invalidateCache("/api/inbox");
  invalidateCache("/api/tasks");
  invalidateCache("/api/dashboard");
}

// --------------------------------------------------------------------------- conversation list

export function ConversationRow({ c, active, href, onClick }: { c: ConversationOut; active?: boolean; href?: string; onClick?: () => void }) {
  const { t } = useFmt();
  const when = useWhen();
  const pending = c.oldest_pending && c.oldest_pending.status === "pending" ? c.oldest_pending : null;
  const body = (
    <>
      <span className="relative">
        <ChannelIcon source={c.source} />
        {c.unanswered > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-orange-500 ring-2 ring-surface" title={t("crm.unanswered_n", { n: c.unanswered })} aria-label={t("crm.unanswered_n", { n: c.unanswered })} />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cx("min-w-0 flex-1 truncate text-sm", c.unanswered ? "font-semibold text-fg" : "font-medium text-fg-2")}>{c.channel_name}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-fg-4">{when(c.last_message.sent_at)}</span>
        </span>
        {c.subject ? <span className="block truncate text-xs font-medium text-fg-2">{c.subject}</span> : null}
        <span className="block truncate text-xs text-fg-3">
          <span className="font-medium text-fg-2">{c.last_message.direction === "outbound" ? t("crm.you_prefix") : `${c.last_message.sender_name}:`}</span>{" "}
          {c.last_message.preview}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {pending ? <CountdownPill clock={pending} /> : null}
          {c.department ? <DeptPill dept={c.department} /> : null}
          {c.task ? <span className="rounded bg-surface-3 px-1.5 py-px font-mono text-[11px] font-semibold text-fg-2">{c.task.code}</span> : null}
        </span>
      </span>
    </>
  );
  const cls = cx(
    "flex w-full items-start gap-3 border-l-2 px-3 py-2.5 text-left transition-colors",
    focusRing,
    active ? "border-accent bg-accent-soft/60" : "border-transparent hover:bg-surface-2",
  );
  return href ? (
    <Link href={href} className={cls} aria-current={active ? "true" : undefined}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-current={active ? "true" : undefined}>
      {body}
    </button>
  );
}

export type SourceTab = "all" | Source;

export function SourceTabs({
  value,
  onChange,
  counts,
  className,
}: {
  value: SourceTab;
  onChange: (v: SourceTab) => void;
  counts: Record<SourceTab, number | undefined>;
  className?: string;
}) {
  const { t } = useFmt();
  const tabs: { id: SourceTab; label: Key }[] = [
    { id: "telegram", label: "crm.channel_telegram" },
    { id: "email", label: "crm.channel_email" },
    { id: "all", label: "crm.all" },
  ];
  return (
    <div role="tablist" aria-label={t("crm.source")} className={cx("flex gap-1 rounded-lg bg-surface-2 p-0.5 text-xs font-medium", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx(
            "flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center transition-colors",
            focusRing,
            value === tab.id ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg",
          )}
        >
          {t(tab.label)} {counts[tab.id] !== undefined ? <span className="tabular-nums text-fg-4">({counts[tab.id]})</span> : null}
        </button>
      ))}
    </div>
  );
}

export function countBySource(items: ConversationOut[] | undefined): Record<SourceTab, number | undefined> {
  if (!items) return { all: undefined, telegram: undefined, email: undefined };
  return {
    all: items.length,
    telegram: items.filter((c) => c.source === "telegram").length,
    email: items.filter((c) => c.source === "email").length,
  };
}

/** Dashboard left pane: tabs, search, most urgent conversations first. */
export function InboxPane({ className }: { className?: string }) {
  const { t } = useFmt();
  const [tab, setTab] = useState<SourceTab>("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 300);
  const res = useApi<ConversationOut[]>(paths.inbox({ source: "all", q: dq || undefined, limit: 60 }), { refreshMs: 15000 });
  const items = (res.data ?? []).filter((c) => tab === "all" || c.source === tab);
  return (
    <section className={cx("flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card", className)} aria-labelledby="inbox-pane-title">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="inbox-pane-title" className="text-sm font-semibold text-fg">
            {t("crm.nav.inbox")}
          </h2>
          <Link href="/inbox" className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline">
            {t("crm.open_inbox")}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <SourceTabs value={tab} onChange={setTab} counts={countBySource(res.data)} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
          <input
            type="search"
            className={cx(inputCls, "h-8 pl-8 text-sm")}
            placeholder={t("crm.search_messages")}
            aria-label={t("crm.search_messages")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {res.error && !res.data ? <p className="p-3 text-sm text-danger-text">{errorMessage(res.error)}</p> : null}
        {!res.data && res.loading ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-2.5 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {res.data && items.length === 0 ? (
          <Empty illustration="chat" compact>
            {dq ? t("crm.inbox_no_match") : t("crm.inbox_empty")}
          </Empty>
        ) : null}
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.key}>
              <ConversationRow c={c} href={`/inbox?key=${encodeURIComponent(c.key)}`} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- thread

export function ThreadView({ convKey, onBack }: { convKey: string; onBack?: () => void }) {
  const { t } = useFmt();
  const res = useApi<ThreadOut>(paths.thread(convKey), { refreshMs: 15000 });
  const th = res.stale ? undefined : res.data;
  const [action, setAction] = useState<{ kind: "task" | "link" | "noreply"; msg: ThreadMessageOut } | null>(null);
  const done = () => {
    setAction(null);
    refreshAfterChange();
    res.reload();
  };

  if (res.error && !th) return <ErrorBanner error={res.error} onRetry={res.reload} />;
  if (!th) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-20 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-14 w-2/3 rounded-2xl" />
        <Skeleton className="h-20 w-3/4 rounded-2xl" />
      </div>
    );
  }
  const email = th.source === "email";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        {onBack ? (
          <button type="button" onClick={onBack} className={cx("rounded-md px-2 py-1 text-sm font-medium text-accent-text hover:bg-surface-2 lg:hidden", focusRing)}>
            ← {t("crm.back_to_list")}
          </button>
        ) : null}
        <ChannelIcon source={th.source} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-fg">{th.channel_name}</h2>
          <p className="truncate text-xs text-fg-3">
            {email && th.subject ? th.subject : null}
            {email && th.subject && th.department ? " · " : null}
            {th.department ? deptLabel(th.department, t) : null}
          </p>
        </div>
      </header>
      {th.tasks.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-xs">
          <span className="font-medium text-fg-3">{t("crm.linked_issues")}</span>
          {th.tasks.map((task) => (
            <Link key={task.id} href={`/tasks/${task.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 hover:border-line-strong">
              <span className="font-mono font-semibold text-fg-2">{task.code}</span>
              <StatusBadge status={task.status} />
            </Link>
          ))}
        </div>
      ) : null}
      <div className={cx("min-h-0 flex-1 space-y-3 overflow-y-auto p-4", !email && "bg-[radial-gradient(var(--line)_1px,transparent_1px)] [background-size:16px_16px]")}>
        {th.messages.length === 0 ? <p className="text-sm text-fg-3">{t("crm.thread_empty")}</p> : null}
        {th.messages.map((m) =>
          email ? (
            <EmailMessage key={m.id} m={m} onAction={(kind) => setAction({ kind, msg: m })} />
          ) : (
            <ChatMessage key={m.id} m={m} onAction={(kind) => setAction({ kind, msg: m })} />
          ),
        )}
      </div>
      {action?.kind === "task" ? <CreateIssueDialog msg={action.msg} onClose={() => setAction(null)} onDone={done} /> : null}
      {action?.kind === "link" ? <LinkIssueDialog msg={action.msg} onClose={() => setAction(null)} onDone={done} /> : null}
      {action?.kind === "noreply" && action.msg.clock ? <NoReplyDialog clockId={action.msg.clock.id} onClose={() => setAction(null)} onDone={done} /> : null}
    </div>
  );
}

type MsgAction = "task" | "link" | "noreply";

function MessageActions({ m, onAction }: { m: ThreadMessageOut; onAction: (a: MsgAction) => void }) {
  const { t } = useFmt();
  const { can } = useMe();
  if (m.direction !== "inbound") return null;
  // viewers only look: the timer and linked issue codes, no actions
  const acts = can("tasks.create");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {m.clock ? <CountdownPill clock={m.clock} /> : null}
      {m.task_codes.map((code) => (
        <span key={code} className="rounded bg-surface-3 px-1.5 py-px font-mono text-[11px] font-semibold text-fg-2">
          {code}
        </span>
      ))}
      <span className="flex-1" />
      {acts && m.task_codes.length === 0 ? (
        <Button size="xs" variant="ghost" onClick={() => onAction("task")}>
          <PlusCircle />
          {t("crm.create_issue")}
        </Button>
      ) : null}
      {acts ? (
        <Button size="xs" variant="ghost" onClick={() => onAction("link")}>
          <Link2 />
          {t("crm.link_issue")}
        </Button>
      ) : null}
      {acts && m.clock?.status === "pending" ? (
        <Button size="xs" variant="ghost" onClick={() => onAction("noreply")}>
          <Ban />
          {t("crm.no_reply_needed")}
        </Button>
      ) : null}
    </div>
  );
}

function MessageBody({ m }: { m: ThreadMessageOut }) {
  const { t } = useFmt();
  return (
    <>
      {m.text ? <p className="whitespace-pre-wrap break-words text-sm text-fg">{m.text}</p> : null}
      {m.transcript ? (
        <p className="mt-1 rounded-md border-l-2 border-ai bg-ai-soft px-2 py-1 text-sm text-fg">
          <Mic className="mr-1 inline size-3 text-ai-text" aria-label={t("msg.transcript")} />
          {m.transcript}
        </p>
      ) : null}
      {!m.text && !m.transcript && m.attachments.length === 0 ? <p className="text-sm text-fg-4">{t("msg.no_text")}</p> : null}
      {m.attachments.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.attachments.map((a) => (
            <AttachmentItem key={a.id} attachment={a} telegramLink={m.telegram_link} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function ChatMessage({ m, onAction }: { m: ThreadMessageOut; onAction: (a: MsgAction) => void }) {
  const f = useFmt();
  const out = m.direction === "outbound";
  return (
    <article className={cx("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "max-w-[92%] rounded-2xl border px-3 py-2 shadow-xs sm:max-w-[80%]",
          out ? "rounded-br-md border-accent/20 bg-accent-soft" : "rounded-bl-md border-line bg-surface",
          m.clock?.status === "pending" && "border-red-500/40",
        )}
      >
        <div className="mb-0.5 flex items-center gap-2 text-xs">
          <span className={cx("font-semibold", out ? "text-accent-text" : "text-fg")}>{m.sender_name}</span>
          {m.sender_kind !== "external" ? <span className="rounded bg-surface-3 px-1 text-[10px] font-medium uppercase text-fg-3">{f.t(`crm.sender.${m.sender_kind}` as Key)}</span> : null}
          <span className="ml-auto text-[11px] text-fg-4">{f.dateTime(m.sent_at)}</span>
        </div>
        <MessageBody m={m} />
        <MessageActions m={m} onAction={onAction} />
      </div>
    </article>
  );
}

function EmailMessage({ m, onAction }: { m: ThreadMessageOut; onAction: (a: MsgAction) => void }) {
  const f = useFmt();
  const { t } = f;
  const out = m.direction === "outbound";
  return (
    <article className={cx("rounded-xl border bg-surface shadow-xs", out ? "border-accent/25" : m.clock?.status === "pending" ? "border-red-500/40" : "border-line")}>
      <header className="flex flex-wrap items-start gap-2 border-b border-line px-4 py-2.5 text-xs">
        <Mail className={cx("mt-0.5 size-4", out ? "text-accent-text" : "text-rose-500")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-fg-3">
            <span className="font-medium text-fg-2">{out ? t("crm.email_to_reply") : t("crm.email_from")}</span> <span className="font-semibold text-fg">{m.sender_name}</span>
          </div>
          {m.subject ? (
            <div className="truncate text-fg-3">
              <span className="font-medium text-fg-2">{t("crm.email_subject")}</span> {m.subject}
            </div>
          ) : null}
        </div>
        <span className="text-[11px] text-fg-4">{f.dateTime(m.sent_at)}</span>
      </header>
      <div className="px-4 py-3">
        <MessageBody m={m} />
        <MessageActions m={m} onAction={onAction} />
      </div>
    </article>
  );
}

// --------------------------------------------------------------------------- actions

function CreateIssueDialog({ msg, onClose, onDone }: { msg: ThreadMessageOut; onClose: () => void; onDone: () => void }) {
  const f = useFmt();
  const { t } = f;
  const toast = useToast();
  const seed = (msg.subject || msg.text || msg.transcript || "").replace(/\s+/g, " ").trim();
  const [title, setTitle] = useState(seed.slice(0, 120));
  const [category, setCategory] = useState<TaskCategory>("other");
  const [priority, setPriority] = useState<Priority>("P3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const task = await api.messageToTask(msg.id, { title: title.trim() || null, category, priority });
      toast(t("crm.issue_created", { code: task.code }), { href: `/tasks/${task.id}` });
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
      title={t("crm.create_issue")}
      onClose={onClose}
      icon={<PlusCircle />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" type="submit" form="crm-create-issue" busy={busy}>
            {t("crm.create_issue")}
          </Button>
        </>
      }
    >
      <form id="crm-create-issue" onSubmit={submit} className="space-y-3">
        <blockquote className="line-clamp-3 rounded-lg border-l-4 border-sky-400 bg-surface-2 px-3 py-2 text-sm text-fg-2">
          <span className="font-semibold text-fg">{msg.sender_name}:</span> {msg.text || msg.transcript || msg.subject || t("msg.no_text")}
        </blockquote>
        <Field label={t("crm.f.title")} hint={t("crm.f.title_hint")}>
          {(id) => <input id={id} className={inputCls} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("field.category")}>
            {(id) => (
              <select id={id} className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as TaskCategory)}>
                {TASK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {f.category(c)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("field.priority")}>
            {(id) => (
              <select id={id} className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {f.priority(p)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {error ? <ErrorBanner error={error} /> : null}
      </form>
    </Modal>
  );
}

function LinkIssueDialog({ msg, onClose, onDone }: { msg: ThreadMessageOut; onClose: () => void; onDone: () => void }) {
  const { t } = useFmt();
  const toast = useToast();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function pick(taskId: string, code: string) {
    setBusy(true);
    setError(null);
    try {
      await api.linkMessage(taskId, msg.id);
      toast(t("crm.linked_to", { code }), { href: `/tasks/${taskId}` });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={t("crm.link_issue")} onClose={onClose} icon={<Link2 />} footer={<Button onClick={onClose}>{t("common.cancel")}</Button>}>
      <p className="mb-3 text-sm text-fg-3">{t("crm.link_explain")}</p>
      <div className={cx(busy && "pointer-events-none opacity-60")}>
        <TaskPicker excludeId="" onPick={(task) => void pick(task.id, task.code)} autoFocus />
      </div>
      {error ? (
        <div className="mt-3">
          <ErrorBanner error={error} />
        </div>
      ) : null}
    </Modal>
  );
}

const NO_REPLY_REASONS: Key[] = ["crm.nr.thanks", "crm.nr.automated", "crm.nr.phone", "crm.nr.internal"];

function NoReplyDialog({ clockId, onClose, onDone }: { clockId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useFmt();
  const toast = useToast();
  const [choice, setChoice] = useState<Key | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const reason = [choice ? t(choice) : "", note.trim()].filter(Boolean).join(" — ").slice(0, 200);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.noResponse(clockId, reason);
      toast(t("crm.no_reply_saved"));
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
      title={t("crm.no_reply_needed")}
      onClose={onClose}
      icon={<Ban />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" type="submit" form="crm-no-reply" busy={busy} disabled={!reason}>
            {t("crm.no_reply_confirm")}
          </Button>
        </>
      }
    >
      <form id="crm-no-reply" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-fg-3">{t("crm.no_reply_explain")}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("crm.reason")}>
          {NO_REPLY_REASONS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={choice === k}
              onClick={() => setChoice(choice === k ? "" : k)}
              className={cx(
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                focusRing,
                choice === k ? "border-accent bg-accent-soft text-fg" : "border-line text-fg-2 hover:bg-surface-2",
              )}
            >
              {t(k)}
            </button>
          ))}
        </div>
        <Field label={t("crm.reason_note")}>
          {(id) => <input id={id} className={inputCls} value={note} maxLength={180} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error ? <ErrorBanner error={error} /> : null}
      </form>
    </Modal>
  );
}

/** Icon for the source in compact places. */
export function SourceGlyph({ source }: { source: Source }) {
  return source === "email" ? <Mail className="size-3.5 text-rose-500" aria-hidden /> : <Send className="size-3.5 text-sky-500" aria-hidden />;
}
