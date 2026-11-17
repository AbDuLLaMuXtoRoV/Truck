"use client";

import { Ban, ChevronDown, ChevronUp, Copy, Inbox, Keyboard, Pencil, RefreshCw, Sparkles, UserCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Confidence, PriorityBadge, StatusBadge, TruckChip } from "@/components/badges";
import { DueChip } from "@/components/due";
import { DepartmentSelect, TaskPicker, TruckSelect, UserSelect } from "@/components/pickers";
import { MessageCard } from "@/components/TaskParts";
import { useToast } from "@/components/toast";
import { Button, Empty, ErrorBanner, Kbd, NoAccess, PageHeader, Skeleton, cx, focusRing, inputCls, selectCls } from "@/components/ui";
import { api, errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import { useT, type Key } from "@/lib/i18n";
import { useReference, type Reference } from "@/lib/reference";
import {
  CATEGORY_DEPARTMENT,
  PRIORITIES,
  TASK_CATEGORIES,
  type Priority,
  type TaskCategory,
  type TaskDetailOut,
  type TaskListOut,
  type TaskOut,
  type TaskPatchIn,
} from "@/lib/types";

const BATCH = 50;
const QUEUE_PATH = paths.tasks({ status: ["detected", "needs_review"], sort: "created_asc", limit: BATCH });
const QUICK_REASONS: Key[] = ["review.reason_not_actionable", "review.reason_chatter", "review.reason_resolved", "review.reason_status_only"];

export default function ReviewPage() {
  const { can } = useMe();
  const { t } = useT();
  if (!can("tasks.review")) return <NoAccess message={t("access.review")} />;
  return <ReviewQueue />;
}

/**
 * The list endpoint does not carry the AI's "why" or the source messages, so each card loads its
 * task detail. Requests run four at a time, in queue order.
 */
function useTaskDetails(ids: string[]) {
  const [details, setDetails] = useState<Record<string, TaskDetailOut>>({});
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  const key = ids.join(",");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const queue = key ? key.split(",").filter((id) => !requested.current.has(id)) : [];
    queue.forEach((id) => requested.current.add(id));
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          const d = await api.getTask(id);
          if (mounted.current) setDetails((m) => ({ ...m, [id]: d }));
        } catch (err) {
          requested.current.delete(id);
          if (mounted.current) setErrors((m) => ({ ...m, [id]: err }));
        }
      }
    };
    for (let i = 0; i < 4; i++) void worker();
  }, [key]);

  const put = useCallback((d: TaskDetailOut) => setDetails((m) => ({ ...m, [d.id]: d })), []);
  return { details, errors, put };
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

function ReviewQueue() {
  const list = useApi<TaskListOut>(QUEUE_PATH);
  const refData = useReference();
  const toast = useToast();
  const f = useFmt();
  const { t, tp } = f;
  const now = useNow();
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const [handled, setHandled] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = (list.data?.items ?? []).filter((x) => !resolved.has(x.id));
  const remainingTotal = Math.max(0, (list.data?.total ?? 0) - (list.data ? list.data.items.length - items.length : 0));
  const { details, errors, put } = useTaskDetails(items.map((x) => x.id));
  const index = Math.max(0, items.findIndex((x) => x.id === selectedId));
  const current = items[index];

  const { reload } = list;
  const onResolved = useCallback(
    (task: TaskOut, message: string, href?: string) => {
      // move on to the next card in queue order
      const all = list.data?.items ?? [];
      const rest = all.filter((x) => x.id !== task.id && !resolved.has(x.id));
      const pos = all.findIndex((x) => x.id === task.id);
      const after = rest.find((x) => all.indexOf(x) > pos) ?? rest[rest.length - 1];
      setSelectedId(after?.id ?? null);
      setResolved((s) => new Set(s).add(task.id));
      setHandled((n) => n + 1);
      invalidateCache("/api/tasks?");
      invalidateCache("/api/dashboard");
      toast(message, { href });
    },
    [toast, list.data, resolved],
  );

  // keep the queue topped up: fetch the next batch when the loaded cards run low
  const loadedLeft = items.length;
  const moreOnServer = remainingTotal > loadedLeft;
  useEffect(() => {
    if (list.data && loadedLeft < 5 && moreOnServer && !list.loading && !list.error) reload();
  }, [loadedLeft, moreOnServer, list.data, list.loading, list.error, reload]);

  const onUpdated = (d: TaskDetailOut) => {
    put(d);
    list.setData((prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.id === d.id ? d : x)) } : prev!));
  };

  const go = useCallback(
    (delta: number) => {
      if (!items.length) return;
      const next = items[Math.max(0, Math.min(items.length - 1, index + delta))];
      setSelectedId(next.id);
    },
    [items, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        go(1);
      } else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        go(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);

  const done = handled;
  const totalWork = done + remainingTotal;
  const progress = totalWork ? done / totalWork : 0;

  return (
    <>
      <PageHeader
        icon={<Inbox />}
        title={t("review.title")}
        subtitle={list.data ? [tp("review.waiting", remainingTotal), t("review.oldest_first")].join(" · ") : t("review.subtitle")}
        actions={
          <Button size="sm" onClick={reload} busy={list.loading && !!list.data}>
            <RefreshCw />
            {t("common.refresh")}
          </Button>
        }
      />

      {list.data && remainingTotal + done > 0 ? (
        <div className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold text-fg">
              {items.length ? t("review.position", { n: index + 1, total: remainingTotal }) : t("review.caught_up_short")}
            </span>
            <span className="text-xs text-fg-3">{t("review.progress", { done, total: totalWork })}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={0} aria-valuemax={totalWork} aria-valuenow={done} aria-label={t("review.progress", { done, total: totalWork })}>
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-[width] duration-500" style={{ width: `${Math.max(progress * 100, done ? 2 : 0)}%` }} />
          </div>
        </div>
      ) : null}

      <ErrorBanner error={list.error} onRetry={reload} className="mb-3" />

      {!list.data && list.loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="hidden space-y-2 lg:block">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-[28rem] rounded-xl" />
        </div>
      ) : null}

      {list.data && items.length === 0 && !list.loading ? (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <Empty illustration="check" title={t("review.caught_up_title")}>
            {t("review.caught_up")}
          </Empty>
        </div>
      ) : null}

      {current ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* queue list */}
          <aside className="hidden lg:block">
            <ol className="sticky top-20 max-h-[calc(100vh-12rem)] space-y-1.5 overflow-y-auto pr-1" aria-label={t("review.queue")}>
              {items.map((x, i) => {
                const active = x.id === current.id;
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(x.id)}
                      aria-current={active ? "true" : undefined}
                      className={cx(
                        "w-full rounded-lg border px-3 py-2.5 text-left transition-all",
                        focusRing,
                        active ? "border-accent/50 bg-accent-soft shadow-xs" : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="w-5 text-[11px] tabular-nums text-fg-4">{i + 1}</span>
                        <span className="font-mono text-[11px] font-medium text-fg-3">{x.code}</span>
                        <PriorityBadge priority={x.priority} />
                        <span className="ml-auto text-[11px] text-fg-4">{f.ago(x.created_at, now)}</span>
                      </span>
                      <span className={cx("mt-1 line-clamp-2 block text-[13px] leading-snug", active ? "font-medium text-fg" : "text-fg-2")}>{f.title(details[x.id] ?? x)}</span>
                    </button>
                  </li>
                );
              })}
              {moreOnServer ? (
                <li>
                  <Button className="w-full" onClick={reload} busy={list.loading}>
                    {t("common.load_more")}
                  </Button>
                </li>
              ) : null}
            </ol>
          </aside>

          <div className="min-w-0">
            <ReviewCard
              key={current.id}
              task={details[current.id] ?? current}
              detail={details[current.id]}
              detailError={errors[current.id]}
              refData={refData}
              onResolved={onResolved}
              onUpdated={onUpdated}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button size="sm" onClick={() => go(-1)} disabled={index === 0}>
                  <ChevronUp />
                  {t("review.prev")}
                </Button>
                <Button size="sm" onClick={() => go(1)} disabled={index >= items.length - 1}>
                  <ChevronDown />
                  {t("review.next")}
                </Button>
              </div>
              <ShortcutsHint />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ShortcutsHint() {
  const { t } = useT();
  const keys: [string, Key][] = [
    ["A", "review.key_approve"],
    ["E", "review.key_edit"],
    ["N", "review.key_reject"],
    ["D", "review.key_duplicate"],
    ["J / K", "review.key_move"],
  ];
  return (
    <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3 md:flex" aria-label={t("review.shortcuts")}>
      <Keyboard className="size-3.5" aria-hidden />
      {keys.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <Kbd>{k}</Kbd>
          {t(label)}
        </span>
      ))}
    </div>
  );
}

type Panel = null | "edit" | "reject" | "duplicate";

function ReviewCard({
  task,
  detail,
  detailError,
  refData,
  onResolved,
  onUpdated,
}: {
  task: TaskOut;
  detail?: TaskDetailOut;
  detailError?: unknown;
  refData: Reference;
  onResolved: (task: TaskOut, message: string, href?: string) => void;
  onUpdated: (d: TaskDetailOut) => void;
}) {
  const f = useFmt();
  const { t } = f;
  const now = useNow();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const assigneeRef = useRef<HTMLDivElement>(null);

  // preselect the department's default assignee when that user is active
  const defaultId = task.department ? refData.departmentById.get(task.department.id)?.default_assignee_user_id : null;
  const deptDefault = defaultId && refData.activeUsers.some((u) => u.id === defaultId) ? defaultId : "";
  const [picked, setPicked] = useState<string | null>(null);
  const assigneeId = picked ?? deptDefault;

  const created = detail?.events.find((e) => e.type === "created");
  const why = typeof created?.data?.why === "string" ? created.data.why : null;
  const hint = typeof created?.data?.assignee_hint === "string" ? created.data.assignee_hint : null;
  const sourceMsgs = detail?.messages.filter((m) => m.relation === "source") ?? [];
  const allowed = detail?.allowed_transitions;
  const canApprove = !allowed || allowed.includes("assigned");
  const canCancel = !allowed || allowed.includes("cancelled");
  const canEdit = detail?.can_edit !== false;
  const title = f.title(task);
  const summary = f.summary(task);

  const act = useCallback(async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }, []);

  const approve = useCallback(
    () =>
      act("approve", async () => {
        const d = await api.transition(task.id, { to_status: "assigned", assignee_id: assigneeId });
        onResolved(task, t("toast.assigned", { code: task.code, name: d.assignee?.full_name ?? "—" }), `/tasks/${task.id}`);
      }),
    [act, assigneeId, onResolved, t, task],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || busy) return;
      const k = e.key.toLowerCase();
      if (k === "a" && canApprove) {
        e.preventDefault();
        if (assigneeId) void approve();
        else assigneeRef.current?.querySelector("select")?.focus();
      } else if (k === "e" && canEdit) {
        e.preventDefault();
        setPanel((p) => (p === "edit" ? null : "edit"));
      } else if (k === "n" && canCancel) {
        e.preventDefault();
        setPanel((p) => (p === "reject" ? null : "reject"));
      } else if (k === "d" && canCancel) {
        e.preventDefault();
        setPanel((p) => (p === "duplicate" ? null : "duplicate"));
      } else if (e.key === "Escape") {
        setPanel(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [approve, assigneeId, busy, canApprove, canCancel, canEdit]);

  return (
    <article className="animate-slide-up overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href={`/tasks/${task.id}`} className="rounded-md bg-surface-3 px-2 py-0.5 font-mono font-semibold text-fg-2 hover:text-accent-text">
            {task.code}
          </Link>
          <PriorityBadge priority={task.priority} withLabel />
          <span className="rounded-md bg-surface-3 px-2 py-0.5 font-medium text-fg-2">{f.category(task.category)}</span>
          <StatusBadge status={task.status} />
          <span className="ml-auto text-fg-3" title={f.dateTime(task.created_at)}>
            {f.ago(task.created_at, now)}
            {task.group ? ` · ${task.group.title}` : ""}
          </span>
        </div>
        <h2 className="mt-3 text-xl font-semibold leading-snug tracking-tight text-fg">{title}</h2>
        {title !== task.title ? (
          <p className="mt-1 text-xs text-fg-3" lang="en">
            <span className="font-medium">{t("detail.original")}:</span> {task.title}
          </p>
        ) : null}
        {summary ? <p className="mt-2 text-[15px] leading-relaxed text-fg-2">{summary}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {task.truck ? (
            <TruckChip unit={task.truck.unit_number} />
          ) : task.truck_unit_raw ? (
            <TruckChip unit={task.truck_unit_raw} unmatched title={t("review.truck_not_in_fleet", { unit: task.truck_unit_raw })} />
          ) : null}
          <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-medium text-fg-2">{task.department?.name ?? t("dept.unrouted")}</span>
          {task.load_ref ? <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-fg-2">{task.load_ref}</span> : null}
          <DueChip createdAt={task.created_at} dueAt={task.due_at} status={task.status} now={now} />
          <span className="ml-auto">
            <Confidence value={task.confidence} wide />
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="relative overflow-hidden rounded-xl border border-ai/20 bg-ai-soft p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ai-text">
              <Sparkles className="size-3.5" aria-hidden />
              {t("review.why_flagged")}
            </div>
            {detail ? (
              <>
                <p className="text-sm leading-relaxed text-fg">{why ?? <span className="text-fg-3">{t("review.no_reason")}</span>}</p>
                {hint ? (
                  <p className="mt-2 text-[13px] text-fg-2">
                    <span className="font-medium">{t("review.assignee_hint")}</span> {hint}
                  </p>
                ) : null}
              </>
            ) : detailError ? (
              <p className="text-sm text-danger-text">{errorMessage(detailError)}</p>
            ) : (
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            )}
          </div>
          <div className="min-w-0 rounded-xl border border-line bg-[radial-gradient(var(--line)_1px,transparent_1px)] [background-size:16px_16px] p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">{t("review.source_message")}</div>
            {detail ? (
              sourceMsgs.length ? (
                <div className="space-y-3">
                  {sourceMsgs.slice(0, 3).map((m) => (
                    <MessageCard key={m.id} message={m} compact />
                  ))}
                  {sourceMsgs.length > 3 ? (
                    <Link href={`/tasks/${task.id}`} className="text-xs font-medium text-accent-text hover:underline">
                      {t("review.more_messages", { n: sourceMsgs.length - 3 })}
                    </Link>
                  ) : null}
                </div>
              ) : detail.source_text ? (
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface px-3 py-2 font-sans text-sm text-fg">{detail.source_text}</pre>
              ) : (
                <p className="text-sm text-fg-4">{t("review.no_source")}</p>
              )
            ) : detailError ? null : (
              <div className="space-y-2">
                <Skeleton className="h-12 w-4/5 rounded-2xl" />
                <Skeleton className="h-10 w-3/5 rounded-2xl" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="border-t border-line bg-surface-2 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {canApprove ? (
            <form
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none"
              onSubmit={(e) => {
                e.preventDefault();
                if (assigneeId) void approve();
              }}
            >
              <div ref={assigneeRef} className="w-full min-w-48 sm:w-64">
                <UserSelect refData={refData} value={assigneeId} onChange={(v) => setPicked(v)} preferDepartmentId={task.department?.id} />
              </div>
              <Button type="submit" variant="primary" size="md" busy={busy === "approve"} disabled={!assigneeId || busy !== null}>
                <UserCheck />
                {t("tr.approve_assign")}
                <Kbd className="ml-1 border-white/25 bg-white/15 text-white">A</Kbd>
              </Button>
            </form>
          ) : null}
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {canEdit ? (
              <Button aria-expanded={panel === "edit"} onClick={() => setPanel(panel === "edit" ? null : "edit")}>
                <Pencil />
                {t("common.edit")}
                <Kbd>E</Kbd>
              </Button>
            ) : null}
            {canCancel ? (
              <Button aria-expanded={panel === "duplicate"} onClick={() => setPanel(panel === "duplicate" ? null : "duplicate")}>
                <Copy />
                {t("review.duplicate_of")}
                <Kbd>D</Kbd>
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="danger" aria-expanded={panel === "reject"} onClick={() => setPanel(panel === "reject" ? null : "reject")}>
                <Ban />
                {t("review.not_a_task")}
                <Kbd>N</Kbd>
              </Button>
            ) : null}
          </div>
        </div>
        {error && panel !== "reject" && panel !== "duplicate" ? <ErrorBanner error={error} className="mt-3" /> : null}

        {panel === "edit" ? (
          <EditPanel
            task={task}
            refData={refData}
            onClose={() => setPanel(null)}
            onSaved={(d) => {
              onUpdated(d);
              setPanel(null);
            }}
          />
        ) : null}
        {panel === "reject" ? (
          <RejectPanel
            busy={busy === "reject"}
            error={error}
            onClose={() => setPanel(null)}
            onConfirm={(reason) =>
              act("reject", async () => {
                await api.transition(task.id, { to_status: "cancelled", reason });
                onResolved(task, t("toast.dismissed", { code: task.code }));
              })
            }
          />
        ) : null}
        {panel === "duplicate" ? (
          <DuplicatePanel
            task={task}
            busy={busy === "merge"}
            error={error}
            onClose={() => setPanel(null)}
            onConfirm={(target) =>
              act("merge", async () => {
                const d = await api.merge(task.id, { into_task_id: target.id, reason: t("merge.default_reason", { code: target.code }) });
                onResolved(task, t("toast.merged", { code: task.code, target: d.code }), `/tasks/${d.id}`);
              })
            }
          />
        ) : null}
      </div>
    </article>
  );
}

function EditPanel({ task, refData, onClose, onSaved }: { task: TaskOut; refData: Reference; onClose: () => void; onSaved: (d: TaskDetailOut) => void }) {
  const f = useFmt();
  const { t } = f;
  const [category, setCategory] = useState<TaskCategory>(task.category);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [departmentId, setDepartmentId] = useState(task.department?.id ?? "");
  const [deptTouched, setDeptTouched] = useState(false);
  const [truckId, setTruckId] = useState(task.truck?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const patch: TaskPatchIn = {};
  if (category !== task.category) patch.category = category;
  if (priority !== task.priority) patch.priority = priority;
  if ((departmentId || null) !== (task.department?.id ?? null)) patch.department_id = departmentId || null;
  if ((truckId || null) !== (task.truck?.id ?? null)) patch.truck_id = truckId || null;
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.patchTask(task.id, patch));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 animate-slide-up rounded-xl border border-line bg-surface p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-fg-2">
          {t("form.category")}
          <select
            className={cx(selectCls, "mt-1.5")}
            value={category}
            autoFocus
            onChange={(e) => {
              const c = e.target.value as TaskCategory;
              setCategory(c);
              if (!deptTouched) {
                const code = CATEGORY_DEPARTMENT[c];
                const d = code ? refData.departmentByCode.get(code) : undefined;
                if (d) setDepartmentId(d.id);
              }
            }}
          >
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {f.category(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-fg-2">
          {t("form.priority")}
          <select className={cx(selectCls, "mt-1.5")} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {f.priority(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-fg-2">
          {t("form.department")}
          <DepartmentSelect
            refData={refData}
            value={departmentId}
            onChange={(v) => {
              setDeptTouched(true);
              setDepartmentId(v);
            }}
            className="mt-1.5"
          />
        </label>
        <label className="text-xs font-medium text-fg-2">
          {t("form.truck")}
          <TruckSelect refData={refData} value={truckId} onChange={setTruckId} className="mt-1.5" />
        </label>
      </div>
      {error ? <ErrorBanner error={error} className="mt-3" /> : null}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={save} busy={busy} disabled={!dirty}>
          {t("common.save")}
        </Button>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </div>
  );
}

function RejectPanel({ busy, error, onClose, onConfirm }: { busy: boolean; error: unknown; onClose: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-3 animate-slide-up rounded-xl border border-danger/25 bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim()) onConfirm(reason.trim());
      }}
    >
      <label className="text-xs font-semibold text-fg-2" htmlFor="reject-reason">
        {t("review.reject_label")}
      </label>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_REASONS.map((key) => {
          const text = t(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setReason(text)}
              className={cx(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                focusRing,
                reason === text ? "border-danger/40 bg-danger-soft text-danger-text" : "border-line text-fg-2 hover:bg-surface-2",
              )}
            >
              {text}
            </button>
          );
        })}
      </div>
      <input
        id="reject-reason"
        className={cx(inputCls, "mt-2.5")}
        maxLength={2000}
        autoFocus
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("tr.reason")}
      />
      {error ? <ErrorBanner error={error} className="mt-2.5" /> : null}
      <div className="mt-3 flex gap-2">
        <Button type="submit" variant="danger" busy={busy} disabled={!reason.trim()}>
          {t("review.dismiss")}
        </Button>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </form>
  );
}

function DuplicatePanel({
  task,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  task: TaskOut;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (target: TaskOut) => void;
}) {
  const f = useFmt();
  const { t } = f;
  const [target, setTarget] = useState<TaskOut | null>(null);
  return (
    <div className="mt-3 animate-slide-up rounded-xl border border-line bg-surface p-4">
      {target ? (
        <div className="space-y-2.5">
          <p className="text-sm text-fg-2">
            {t("review.duplicate_confirm", { code: task.code, target: target.code })}{" "}
            <Link href={`/tasks/${target.id}`} className="font-medium text-accent-text hover:underline" target="_blank">
              {f.title(target)}
            </Link>
          </p>
          {error ? <ErrorBanner error={error} /> : null}
          <div className="flex gap-2">
            <Button variant="danger" busy={busy} onClick={() => onConfirm(target)}>
              {t("merge.into", { code: target.code })}
            </Button>
            <Button onClick={() => setTarget(null)}>{t("common.back")}</Button>
          </div>
        </div>
      ) : (
        <>
          <TaskPicker excludeId={task.id} autoFocus suggest={task.truck ? { truck_id: task.truck.id } : undefined} onPick={setTarget} />
          <div className="mt-2.5">
            <Button onClick={onClose}>{t("common.close")}</Button>
          </div>
        </>
      )}
    </div>
  );
}
