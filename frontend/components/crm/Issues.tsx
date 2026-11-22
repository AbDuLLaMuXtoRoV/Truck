"use client";

import { AlertTriangle, ArrowUpRight, CheckCircle2, CircleDashed, Flag, MessageSquare, Pencil, Siren, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage, paths } from "@/lib/api";
import { deptLabel, formatResponse, isReopened, issueSource, issueTypeLabel, resolveTarget } from "@/lib/crm";
import { isoToZonedInput, useFmt, zonedInputToIso } from "@/lib/format";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import { useReference, type Reference } from "@/lib/reference";
import { PRIORITIES, type ClockOut, type ConversationOut, type EscalationOut, type Priority, type TaskDetailOut, type TaskListOut, type TaskListQuery, type TaskOut } from "@/lib/types";
import { CommentBox, KeyDates } from "../AdvancedTaskDetail";
import { PriorityBadge, StatusBadge } from "../badges";
import { DepartmentSelect, UserSelect } from "../pickers";
import { MessageCard, Timeline } from "../TaskParts";
import { useToast } from "../toast";
import { TransitionBar } from "../TransitionBar";
import { Button, Empty, ErrorBanner, Field, Modal, Skeleton, cx, focusRing, inputCls, selectCls } from "../ui";
import { CountdownPill, DeptPill, IssueIcon, ReopenedBadge, ResponseCell } from "./parts";

export function refreshIssues() {
  invalidateCache("/api/tasks");
  invalidateCache("/api/dashboard");
  invalidateCache("/api/inbox");
  invalidateCache("/api/escalations");
}

// --------------------------------------------------------------------------- issues pane (dashboard middle)

export type IssueTab = "active" | "mine" | "unresolved" | "resolved";

const TAB_QUERY: Record<IssueTab, TaskListQuery> = {
  // being worked on
  active: { status: ["assigned", "in_progress", "blocked", "pending_verification"], sort: "updated_desc" },
  mine: { mine: true, open: true, sort: "updated_desc" },
  // everything not resolved yet, new ones included; past-due first
  unresolved: { open: true, sort: "due_asc" },
  resolved: { status: ["completed"], sort: "updated_desc" },
};

const TAB_LABEL: Record<IssueTab, Key> = {
  active: "crm.tab.active",
  mine: "crm.tab.mine",
  unresolved: "crm.tab.unresolved",
  resolved: "crm.tab.resolved",
};

function useTabCount(tab: IssueTab, skip: boolean): number | undefined {
  const res = useApi<TaskListOut>(skip ? null : paths.tasks({ ...TAB_QUERY[tab], limit: 1 }), { refreshMs: 15000 });
  return res.data?.total;
}

export function IssuesPane({
  selectedId,
  onSelect,
  clocks,
  className,
  autoSelect,
}: {
  /** select the first issue when nothing is selected (wide screens, where the panel is always shown) */
  autoSelect?: boolean;
  selectedId: string | null;
  onSelect: (task: TaskOut) => void;
  /** pending reply clocks by task id (from the inbox), for the live countdown */
  clocks: Map<string, ClockOut>;
  className?: string;
}) {
  const f = useFmt();
  const { t } = f;
  const [tab, setTab] = useState<IssueTab>("active");
  const res = useApi<TaskListOut>(paths.tasks({ ...TAB_QUERY[tab], limit: 50 }), { refreshMs: 15000 });
  const counts: Record<IssueTab, number | undefined> = {
    active: useTabCount("active", tab === "active"),
    mine: useTabCount("mine", tab === "mine"),
    unresolved: useTabCount("unresolved", tab === "unresolved"),
    resolved: useTabCount("resolved", tab === "resolved"),
  };
  counts[tab] = res.stale ? undefined : res.data?.total;
  const items = res.stale ? [] : (res.data?.items ?? []);
  const first = items[0];
  useEffect(() => {
    if (autoSelect && !selectedId && first) onSelect(first);
  }, [autoSelect, selectedId, first, onSelect]);

  return (
    <section className={cx("@container flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card", className)} aria-labelledby="issues-pane-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 pt-3">
        <h2 id="issues-pane-title" className="text-sm font-semibold text-fg">
          {t("crm.active_issues")}
        </h2>
        <Link href="/tasks?open=true" className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline">
          {t("crm.all_issues")}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
        <div role="tablist" aria-label={t("crm.issue_tabs")} className="-mb-px flex w-full gap-1 overflow-x-auto">
          {(Object.keys(TAB_QUERY) as IssueTab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx(
                "whitespace-nowrap border-b-2 px-2 py-2 text-[13px] font-medium transition-colors",
                focusRing,
                tab === id ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg",
              )}
            >
              {t(TAB_LABEL[id])}
              {counts[id] !== undefined ? <span className="ml-1 rounded-full bg-surface-3 px-1.5 text-[11px] tabular-nums text-fg-2">{counts[id]}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {res.error && !res.data ? <p className="p-3 text-sm text-danger-text">{errorMessage(res.error)}</p> : null}
        {(!res.data || res.stale) && res.loading ? (
          <div className="space-y-3 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : null}
        {res.data && !res.stale && items.length === 0 ? (
          <Empty illustration="check" compact>
            {t(`crm.issues_empty.${tab}` as Key)}
          </Empty>
        ) : null}
        {items.length ? (
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
              <tr>
                <th className="px-3 py-2">{t("crm.col.issue")}</th>
                <th className="hidden w-[8rem] px-2 py-2 @2xl:table-cell">{t("crm.col.department")}</th>
                <th className="w-[5.75rem] px-2 py-2">{t("crm.col.response")}</th>
                <th className="hidden w-[8.5rem] px-2 py-2 @md:table-cell">{t("crm.col.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((task) => {
                const active = task.id === selectedId;
                return (
                  <tr
                    key={task.id}
                    onClick={() => onSelect(task)}
                    className={cx("cursor-pointer transition-colors", active ? "bg-accent-soft/60" : "hover:bg-surface-2")}
                    aria-selected={active}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(task);
                        }}
                        className={cx("flex w-full min-w-0 items-start gap-2.5 text-left", focusRing)}
                      >
                        <IssueIcon category={task.category} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            {task.priority === "P1" ? <Flag className="size-3.5 shrink-0 fill-red-500 text-red-500" aria-label={f.priority("P1")} /> : null}
                            <span className="truncate font-medium text-fg">{f.title(task)}</span>
                          </span>
                          <span className="block truncate text-xs text-fg-3">
                            <span className="font-mono">{task.code}</span>
                            <span className="@2xl:hidden"> · {deptLabel(task.department, t)}</span> · {f.summary(task) ?? issueTypeLabel(task, f.label)}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1 @md:hidden">
                            <StatusBadge status={task.status} />
                            {isReopened(task) ? <ReopenedBadge /> : null}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="hidden px-2 py-2 align-top @2xl:table-cell">
                      <DeptPill dept={task.department} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <ResponseCell task={task} clock={clocks.get(task.id)} />
                    </td>
                    <td className="hidden px-2 py-2 align-top @md:table-cell">
                      <span className="flex flex-col items-start gap-1 [&>span]:whitespace-normal">
                        <StatusBadge status={task.status} />
                        {isReopened(task) ? <ReopenedBadge /> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- issue panel (dashboard right)

type PanelTab = "details" | "messages" | "activity" | "resolution";

export function IssuePanel({ taskId, onClose, className }: { taskId: string; onClose?: () => void; className?: string }) {
  const f = useFmt();
  const { t } = f;
  const refData = useReference();
  const res = useApi<TaskDetailOut>(paths.task(taskId), { refreshMs: 15000 });
  const task = res.stale ? undefined : res.data;
  const [tab, setTab] = useState<PanelTab>("details");
  const update = (next: TaskDetailOut) => {
    res.setData(next);
    refreshIssues();
  };

  return (
    <section className={cx("flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card", className)} aria-label={t("crm.issue_panel")}>
      {res.error && !task ? (
        <div className="p-3">
          <ErrorBanner error={res.error} onRetry={res.reload} />
        </div>
      ) : null}
      {!task && !res.error ? (
        <div className="space-y-3 p-4" role="status" aria-label={t("common.loading")}>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : null}
      {task ? (
        <>
          <header className="border-b border-line px-4 pb-0 pt-3">
            <div className="flex items-start gap-2.5">
              <IssueIcon category={task.category} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-mono font-semibold text-fg-3">{task.code}</span>
                  <StatusBadge status={task.status} />
                  {isReopened(task) ? <ReopenedBadge /> : null}
                </div>
                <h2 className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-fg">{f.title(task)}</h2>
              </div>
              <Link href={`/tasks/${task.id}`} className="rounded-md p-1 text-fg-3 hover:bg-surface-3 hover:text-fg" title={t("crm.open_full")} aria-label={t("crm.open_full")}>
                <ArrowUpRight className="size-4" />
              </Link>
              {onClose ? (
                <button type="button" onClick={onClose} className="rounded-md p-1 text-fg-3 hover:bg-surface-3 hover:text-fg" aria-label={t("common.close")}>
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div role="tablist" aria-label={t("crm.issue_panel")} className="-mb-px mt-2 flex gap-1 overflow-x-auto">
              {(["details", "messages", "activity", "resolution"] as PanelTab[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cx(
                    "whitespace-nowrap border-b-2 px-2 py-2 text-[13px] font-medium transition-colors",
                    focusRing,
                    tab === id ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg",
                  )}
                >
                  {t(`crm.ptab.${id}` as Key)}
                  {id === "messages" && task.messages.length ? <span className="ml-1 text-fg-4">({task.messages.length})</span> : null}
                </button>
              ))}
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "details" ? <DetailsTab task={task} refData={refData} onChange={update} /> : null}
            {tab === "messages" ? (
              task.messages.length ? (
                <div className="space-y-4">
                  {task.messages.map((m) => (
                    <MessageCard key={m.id} message={m} compact />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-fg-3">{t("detail.no_messages")}</p>
              )
            ) : null}
            {tab === "activity" ? <ActivityTab task={task} refData={refData} onChange={update} /> : null}
            {tab === "resolution" ? <ResolutionTab task={task} refData={refData} onChange={update} /> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-2 py-1.5">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="min-w-0 text-sm text-fg">{children}</dd>
    </div>
  );
}

/** Green / red cards: was the message answered, is the issue resolved. */
export function StatusCards({ task }: { task: TaskDetailOut }) {
  const f = useFmt();
  const { t } = f;
  const r = task.response;
  const resolved = task.status === "completed";
  const pending = r?.pending && r.pending.status === "pending" ? r.pending : null;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div
        className={cx(
          "rounded-lg border p-2.5",
          r?.message_answered === true ? "border-emerald-500/30 bg-emerald-500/8" : r?.message_answered === false ? "border-red-500/30 bg-red-500/8" : "border-line bg-surface-2",
        )}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
          <MessageSquare className="size-3.5" aria-hidden />
          {t("crm.msg_answered")}
        </div>
        <div className="mt-1 text-sm font-semibold">
          {r?.message_answered === true ? (
            <span className="text-emerald-700 dark:text-emerald-300">
              {t("crm.yes")}
              {r.answered_at ? <span className="font-normal"> ({f.time(r.answered_at)})</span> : null}
            </span>
          ) : r?.message_answered === false ? (
            <span className="flex flex-wrap items-center gap-1.5 text-red-700 dark:text-red-300">
              {t("crm.no")}
              {pending ? <CountdownPill clock={pending} /> : null}
            </span>
          ) : (
            <span className="text-fg-3">{t("crm.no_reply_needed")}</span>
          )}
        </div>
        {r?.message_answered && (r.answered_by_name || r.response_seconds !== null) ? (
          <div className="mt-0.5 truncate text-[11px] text-fg-3">
            {[r.answered_by_name, r.response_seconds !== null ? formatResponse(r.response_seconds, t) : null].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </div>
      <div className={cx("rounded-lg border p-2.5", resolved ? "border-emerald-500/30 bg-emerald-500/8" : "border-amber-500/30 bg-amber-500/8")}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
          {resolved ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleDashed className="size-3.5" aria-hidden />}
          {t("crm.issue_resolved")}
        </div>
        <div className={cx("mt-1 text-sm font-semibold", resolved ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300")}>
          {resolved ? t("crm.yes") : t("crm.no")}
          {resolved && task.completed_at ? <span className="font-normal"> ({f.time(task.completed_at)})</span> : null}
        </div>
      </div>
    </div>
  );
}

function DetailsTab({ task, refData, onChange }: { task: TaskDetailOut; refData: Reference; onChange: (t: TaskDetailOut) => void }) {
  const f = useFmt();
  const { t } = f;
  const toast = useToast();
  const [busy, setBusy] = useState<"assign" | "resolve" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<"update" | "escalate" | null>(null);
  const target = resolveTarget(task.allowed_transitions);
  const source = issueSource(task, t);

  async function assign(userId: string) {
    if (!userId || userId === task.assignee?.id) return;
    setBusy("assign");
    setError(null);
    try {
      onChange(await api.assign(task.id, { assignee_id: userId }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function resolve() {
    if (!target) return;
    setBusy("resolve");
    setError(null);
    try {
      onChange(await api.transition(task.id, { to_status: target }));
      toast(target === "completed" ? t("crm.resolved_toast", { code: task.code }) : t("crm.resolution_sent", { code: task.code }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <StatusCards task={task} />
      <dl className="divide-y divide-line">
        <Row label={t("crm.f.source")}>{source ?? <span className="text-fg-3">{f.source(task.source)}</span>}</Row>
        <Row label={t("crm.f.reported")}>{f.dateTime(task.created_at)}</Row>
        <Row label={t("crm.f.department")}>{deptLabel(task.department, t)}</Row>
        <Row label={t("crm.f.assigned")}>
          {task.can_assign ? (
            <UserSelect
              refData={refData}
              value={task.assignee?.id ?? ""}
              onChange={(v) => void assign(v)}
              preferDepartmentId={task.department?.id}
              placeholder={t("crm.unassigned")}
              disabled={busy === "assign"}
              className="h-8 w-full text-sm"
            />
          ) : (
            (task.assignee?.full_name ?? <span className="text-fg-3">{t("crm.unassigned")}</span>)
          )}
        </Row>
        <Row label={t("crm.f.priority")}>
          <PriorityBadge priority={task.priority} withLabel />
        </Row>
        <Row label={t("crm.f.issue_type")}>{issueTypeLabel(task, f.label)}</Row>
        <Row label={t("crm.f.load_driver")}>
          {task.load_ref || task.driver_name ? (
            <span>
              {task.load_ref ? <span className="font-mono">#{task.load_ref}</span> : null}
              {task.load_ref && task.driver_name ? " · " : null}
              {task.driver_name}
            </span>
          ) : (
            <span className="text-fg-4">—</span>
          )}
        </Row>
        {task.truck || task.truck_unit_raw || task.trailer_ref ? (
          <Row label={t("crm.f.truck_trailer")}>
            {[task.truck?.unit_number ?? task.truck_unit_raw, task.trailer_ref ? t("crm.trailer_n", { n: task.trailer_ref }) : null].filter(Boolean).join(" · ")}
          </Row>
        ) : null}
        {task.amount !== null && task.amount !== undefined ? (
          <Row label={t("crm.f.amount")}>{new Intl.NumberFormat(f.locale, { style: "currency", currency: "USD" }).format(task.amount)}</Row>
        ) : null}
        {task.next_action_at ? <Row label={t("crm.f.next_action")}>{f.dateTime(task.next_action_at)}</Row> : null}
      </dl>
      {error ? <ErrorBanner error={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="success"
          onClick={() => void resolve()}
          busy={busy === "resolve"}
          disabled={!target}
          title={!target ? t("crm.resolve_unavailable") : target === "pending_verification" ? t("crm.resolve_needs_approval") : undefined}
        >
          <CheckCircle2 />
          {t("crm.mark_resolved")}
        </Button>
        <Button onClick={() => setDialog("update")} disabled={!task.can_edit}>
          <Pencil />
          {t("crm.update")}
        </Button>
        <Button variant="danger" onClick={() => setDialog("escalate")} disabled={!task.can_edit}>
          <Siren />
          {t("crm.escalate")}
        </Button>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("crm.esc_history")}</h3>
        <EscalationHistory task={task} />
      </div>
      {dialog === "update" ? <UpdateIssueDialog task={task} refData={refData} onClose={() => setDialog(null)} onSaved={onChange} /> : null}
      {dialog === "escalate" ? <EscalateDialog task={task} onClose={() => setDialog(null)} onSaved={onChange} /> : null}
    </div>
  );
}

function ActivityTab({ task, refData, onChange }: { task: TaskDetailOut; refData: Reference; onChange: (t: TaskDetailOut) => void }) {
  const now = useNow(60000);
  return (
    <div className="space-y-4">
      <CommentBox taskId={task.id} onChange={onChange} />
      <Timeline events={task.events} refData={refData} now={now} />
    </div>
  );
}

function ResolutionTab({ task, refData, onChange }: { task: TaskDetailOut; refData: Reference; onChange: (t: TaskDetailOut) => void }) {
  const f = useFmt();
  const { t } = f;
  const now = useNow(60000);
  return (
    <div className="space-y-4">
      <StatusCards task={task} />
      {task.status === "cancelled" && task.cancel_reason ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-2">
          <span className="font-semibold">{t("detail.cancel_reason")} </span>
          {task.cancel_reason}
        </p>
      ) : null}
      {task.status === "blocked" && task.blocked_reason ? (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
          <span className="font-semibold">{t("crm.waiting_on")} </span>
          {task.blocked_reason}
        </p>
      ) : null}
      {task.allowed_transitions.length ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{t("crm.change_status")}</h3>
          <TransitionBar task={task} refData={refData} onChanged={onChange} />
        </div>
      ) : (
        <p className="text-sm text-fg-3">{t("crm.no_status_changes")}</p>
      )}
      <KeyDates task={task} now={now} />
    </div>
  );
}

// --------------------------------------------------------------------------- escalation history

const ESC_TEXT: Record<EscalationOut["kind"], Key> = {
  reminder: "crm.esc.reminder",
  overdue: "crm.esc.overdue",
  escalated: "crm.esc.escalated",
  critical: "crm.esc.critical",
  manual: "crm.esc.manual",
};

export function EscalationHistory({ task }: { task: TaskDetailOut }) {
  const f = useFmt();
  const { t } = f;
  const items = [...(task.escalations ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const via = task.source_channel === "email" ? t("crm.channel_email") : task.source_channel === "telegram" ? t("crm.channel_telegram") : f.source(task.source);
  const answered = task.response?.message_answered && task.response.answered_at ? task.response : null;
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      <li className="relative">
        <span className="absolute -left-[1.3rem] top-1 size-2.5 rounded-full bg-accent ring-4 ring-surface" aria-hidden />
        <div className="text-sm text-fg">
          <span className="mr-1.5 font-mono text-xs tabular-nums text-fg-3">{f.time(task.created_at)}</span>
          {t("crm.esc.created", { via })}
        </div>
      </li>
      {items.map((e) => (
        <li key={e.id} className="relative">
          <span
            className={cx("absolute -left-[1.3rem] top-1 size-2.5 rounded-full ring-4 ring-surface", e.kind === "reminder" ? "bg-amber-500" : e.kind === "manual" ? "bg-violet-500" : "bg-red-500")}
            aria-hidden
          />
          <div className="text-sm text-fg">
            <span className="mr-1.5 font-mono text-xs tabular-nums text-fg-3">{f.time(e.created_at)}</span>
            {t(ESC_TEXT[e.kind] ?? "crm.esc.manual")}
          </div>
          {e.reason ? <div className="mt-0.5 text-xs text-fg-2">“{e.reason}”</div> : null}
          {e.notified_names.length ? <div className="mt-0.5 text-xs text-fg-3">{t("crm.notified", { names: e.notified_names.join(", ") })}</div> : null}
        </li>
      ))}
      {answered ? (
        <li className="relative">
          <span className="absolute -left-[1.3rem] top-1 size-2.5 rounded-full bg-emerald-500 ring-4 ring-surface" aria-hidden />
          <div className="text-sm text-fg">
            <span className="mr-1.5 font-mono text-xs tabular-nums text-fg-3">{f.time(answered.answered_at)}</span>
            {answered.answered_by_name ? t("crm.esc.answered_by", { name: answered.answered_by_name }) : t("crm.esc.answered")}
          </div>
        </li>
      ) : null}
      {task.status === "completed" && task.completed_at ? (
        <li className="relative">
          <span className="absolute -left-[1.3rem] top-1 size-2.5 rounded-full bg-emerald-600 ring-4 ring-surface" aria-hidden />
          <div className="text-sm text-fg">
            <span className="mr-1.5 font-mono text-xs tabular-nums text-fg-3">{f.time(task.completed_at)}</span>
            {t("crm.esc.resolved")}
          </div>
        </li>
      ) : null}
      {items.length === 0 ? <li className="text-xs text-fg-3">{t("crm.esc.none")}</li> : null}
    </ol>
  );
}

// --------------------------------------------------------------------------- dialogs

function num(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return v.trim() === "" || Number.isNaN(n) ? null : n;
}

export function UpdateIssueDialog({
  task,
  refData,
  onClose,
  onSaved,
}: {
  task: TaskDetailOut;
  refData: Reference;
  onClose: () => void;
  onSaved: (t: TaskDetailOut) => void;
}) {
  const f = useFmt();
  const { t, tz } = f;
  const toast = useToast();
  const [form, setForm] = useState({
    title: task.title,
    priority: task.priority as Priority,
    department_id: task.department?.id ?? "",
    issue_type: task.issue_type ?? "",
    load_ref: task.load_ref ?? "",
    driver_name: task.driver_name ?? "",
    trailer_ref: task.trailer_ref ?? "",
    amount: task.amount === null || task.amount === undefined ? "" : String(task.amount),
    due_at: isoToZonedInput(task.due_at, tz),
    next_action_at: isoToZonedInput(task.next_action_at, tz),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.patchTask(task.id, {
        title: form.title.trim(),
        priority: form.priority,
        department_id: form.department_id || null,
        issue_type: form.issue_type.trim() || null,
        load_ref: form.load_ref.trim() || null,
        driver_name: form.driver_name.trim() || null,
        trailer_ref: form.trailer_ref.trim() || null,
        amount: num(form.amount),
        due_at: form.due_at ? zonedInputToIso(form.due_at, tz) : null,
        next_action_at: form.next_action_at ? zonedInputToIso(form.next_action_at, tz) : null,
      });
      onSaved(next);
      toast(t("crm.saved", { code: task.code }));
      onClose();
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
      title={t("crm.update_issue", { code: task.code })}
      onClose={onClose}
      icon={<Pencil />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" type="submit" form="crm-update" busy={busy}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form id="crm-update" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label={t("crm.f.title")} className="sm:col-span-2">
          {(id) => <input id={id} className={inputCls} value={form.title} maxLength={200} required onChange={(e) => set("title", e.target.value)} />}
        </Field>
        <Field label={t("crm.f.priority")}>
          {(id) => (
            <select id={id} className={selectCls} value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {f.priority(p)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("crm.f.department")}>
          {(id) => <DepartmentSelect id={id} refData={refData} value={form.department_id} onChange={(v) => set("department_id", v)} emptyLabel={t("dept.unrouted")} />}
        </Field>
        <Field label={t("crm.f.issue_type")} hint={t("crm.f.issue_type_hint")}>
          {(id) => <input id={id} className={inputCls} value={form.issue_type} maxLength={48} onChange={(e) => set("issue_type", e.target.value)} />}
        </Field>
        <Field label={t("crm.f.load")}>
          {(id) => <input id={id} className={inputCls} value={form.load_ref} maxLength={64} onChange={(e) => set("load_ref", e.target.value)} />}
        </Field>
        <Field label={t("crm.f.driver")}>
          {(id) => <input id={id} className={inputCls} value={form.driver_name} maxLength={120} onChange={(e) => set("driver_name", e.target.value)} />}
        </Field>
        <Field label={t("crm.f.trailer")}>
          {(id) => <input id={id} className={inputCls} value={form.trailer_ref} maxLength={32} onChange={(e) => set("trailer_ref", e.target.value)} />}
        </Field>
        <Field label={t("crm.f.amount_usd")}>
          {(id) => <input id={id} className={inputCls} inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />}
        </Field>
        <Field label={t("crm.f.due")}>
          {(id) => <input id={id} type="datetime-local" className={inputCls} value={form.due_at} onChange={(e) => set("due_at", e.target.value)} />}
        </Field>
        <Field label={t("crm.f.next_action")}>
          {(id) => <input id={id} type="datetime-local" className={inputCls} value={form.next_action_at} onChange={(e) => set("next_action_at", e.target.value)} />}
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

export function EscalateDialog({ task, onClose, onSaved }: { task: TaskDetailOut; onClose: () => void; onSaved: (t: TaskDetailOut) => void }) {
  const { t } = useFmt();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.escalate(task.id, reason.trim()));
      toast(t("crm.escalated_toast", { code: task.code }));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={t("crm.escalate_issue", { code: task.code })}
      onClose={onClose}
      icon={<AlertTriangle />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="danger" type="submit" form="crm-escalate" busy={busy} disabled={!reason.trim()}>
            {t("crm.escalate")}
          </Button>
        </>
      }
    >
      <form id="crm-escalate" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-fg-3">{t("crm.escalate_explain")}</p>
        <Field label={t("crm.reason")}>
          {(id) => (
            <textarea id={id} className={cx(inputCls, "min-h-24")} value={reason} maxLength={2000} required autoFocus onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
        {error ? <ErrorBanner error={error} /> : null}
      </form>
    </Modal>
  );
}

/** Pending reply clocks by task id, taken from the inbox list (TaskOut has no reply deadline). */
export function useClocksByTask(): Map<string, ClockOut> {
  const res = useApi<ConversationOut[]>(paths.inbox({ source: "all", limit: 60 }), { refreshMs: 15000 });
  const map = new Map<string, ClockOut>();
  for (const c of res.data ?? []) {
    if (c.task && c.oldest_pending && c.oldest_pending.status === "pending") {
      const prev = map.get(c.task.id);
      if (!prev || Date.parse(c.oldest_pending.due_at) < Date.parse(prev.due_at)) map.set(c.task.id, c.oldest_pending);
    }
  }
  return map;
}


/** Full issue page (CRM mode): reply status, escalation history, escalate / update. */
export function ResponseCard({ task, refData, onChange }: { task: TaskDetailOut; refData: Reference; onChange: (t: TaskDetailOut) => void }) {
  const { t } = useFmt();
  const [dialog, setDialog] = useState<"update" | "escalate" | null>(null);
  return (
    <section className="rounded-xl border border-line bg-surface shadow-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Siren className="size-4 text-fg-3" aria-hidden />
          {t("crm.response_card")}
        </h2>
        <span className="flex gap-1.5">
          <Button size="xs" onClick={() => setDialog("update")} disabled={!task.can_edit}>
            <Pencil />
            {t("crm.update")}
          </Button>
          <Button size="xs" variant="danger" onClick={() => setDialog("escalate")} disabled={!task.can_edit}>
            <Siren />
            {t("crm.escalate")}
          </Button>
        </span>
      </header>
      <div className="space-y-4 p-4">
        <StatusCards task={task} />
        <EscalationHistory task={task} />
      </div>
      {dialog === "update" ? <UpdateIssueDialog task={task} refData={refData} onClose={() => setDialog(null)} onSaved={onChange} /> : null}
      {dialog === "escalate" ? <EscalateDialog task={task} onClose={() => setDialog(null)} onSaved={onChange} /> : null}
    </section>
  );
}
