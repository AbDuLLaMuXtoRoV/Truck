"use client";

import {
  ArrowLeft,
  Building2,
  CalendarClock,
  FileText,
  Gauge,
  GitMerge,
  Hash,
  MessageSquare,
  Package,
  Pencil,
  Send,
  Sparkles,
  Timer,
  Truck as TruckIcon,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Avatar, AvatarGroup } from "@/components/avatars";
import { Confidence, OverdueBadge, PriorityBadge, SourceBadge, StatusBadge, TruckChip } from "@/components/badges";
import { SlaBar } from "@/components/due";
import { DepartmentSelect, TaskPicker, TruckSelect, UserSelect } from "@/components/pickers";
import { useCrumb } from "@/components/Shell";
import { MessageCard, Timeline } from "@/components/TaskParts";
import { useToast } from "@/components/toast";
import { TransitionBar } from "@/components/TransitionBar";
import { Button, Card, ErrorBanner, Field, Modal, Skeleton, cx, inputCls, selectCls } from "@/components/ui";
import { api, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { isOpenStatus, isoToZonedInput, tzAbbreviation, useFmt, zonedInputToIso } from "@/lib/format";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { useReference, type Reference } from "@/lib/reference";
import { PRIORITIES, TASK_CATEGORIES, type Priority, type TaskCategory, type TaskDetailOut, type TaskOut, type TaskPatchIn } from "@/lib/types";

/** The full (advanced-mode) task page. */
export function AdvancedTaskPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const res = useApi<TaskDetailOut>(paths.task(id));
  const refData = useReference();
  const task = res.stale ? undefined : res.data;
  useCrumb(task?.code ?? null);

  const update = (next: TaskDetailOut) => {
    res.setData(next);
    invalidateCache("/api/tasks?");
    invalidateCache("/api/dashboard");
  };

  if (res.error && !task) {
    return (
      <div className="space-y-3">
        <BackLink />
        <ErrorBanner error={res.error} onRetry={res.reload} />
      </div>
    );
  }
  if (!task) return <DetailSkeleton />;
  return <TaskDetail task={task} refData={refData} onChange={update} reloading={res.loading} />;
}

export function DetailSkeleton() {
  const { t } = useT();
  return (
    <div role="status" aria-label={t("detail.loading")}>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-3 h-40 rounded-xl" />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  const { t } = useT();
  return (
    <Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-medium text-fg-3 hover:text-fg">
      <ArrowLeft className="size-3.5" aria-hidden />
      {t("detail.back")}
    </Link>
  );
}

function TaskDetail({
  task,
  refData,
  onChange,
  reloading,
}: {
  task: TaskDetailOut;
  refData: Reference;
  onChange: (t: TaskDetailOut) => void;
  reloading: boolean;
}) {
  const f = useFmt();
  const { t } = f;
  const now = useNow();
  const due = isOpenStatus(task.status) ? f.relDue(task.due_at, now) : null;
  const sourceMessages = task.messages.filter((m) => m.relation === "source");
  const otherMessages = task.messages.filter((m) => m.relation !== "source");
  const title = f.title(task);
  const summary = f.summary(task);

  return (
    <div className={cx("transition-opacity", reloading && "opacity-90")}>
      <BackLink />
      {/* header */}
      <div className="relative mt-3 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div
          className={cx(
            "absolute inset-x-0 top-0 h-1",
            task.is_overdue ? "bg-danger" : task.status === "completed" ? "bg-success" : task.status === "cancelled" ? "bg-fg-4" : "bg-accent",
          )}
          aria-hidden
        />
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-surface-3 px-2 py-0.5 font-mono text-xs font-semibold text-fg-2">{task.code}</span>
            <StatusBadge status={task.status} size="md" />
            {task.is_overdue ? <OverdueBadge detail={due?.text} /> : null}
            <PriorityBadge priority={task.priority} withLabel />
            <SourceBadge source={task.source} />
            {task.escalation_level > 0 ? (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-text">
                {t("detail.escalated_level", { level: task.escalation_level })}
              </span>
            ) : null}
            {task.reopen_count > 0 ? <span className="text-xs text-fg-3">{t("detail.reopened_times", { n: task.reopen_count })}</span> : null}
          </div>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight text-fg">{title}</h1>
          {title !== task.title ? (
            <p className="mt-1 text-xs text-fg-3" lang="en">
              <span className="font-medium">{t("detail.original")}:</span> {task.title}
            </p>
          ) : null}
          {task.blocked_reason && task.status === "blocked" ? (
            <p className="mt-3 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-3 py-2 text-sm text-fuchsia-900 dark:text-fuchsia-200">
              <span className="font-semibold">{t("detail.blocked_reason")} </span>
              {task.blocked_reason}
            </p>
          ) : null}
          {task.cancel_reason && task.status === "cancelled" ? (
            <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-2">
              <span className="font-semibold">{t("detail.cancel_reason")} </span>
              {task.cancel_reason}
            </p>
          ) : null}
          {task.merged_into_id ? (
            <p className="mt-3 text-sm text-fg-2">
              {t("detail.closed_duplicate")}{" "}
              <Link href={`/tasks/${task.merged_into_id}`} className="font-medium text-accent-text hover:underline">
                {t("detail.open_merged_target")}
              </Link>
            </p>
          ) : null}
        </div>
        {task.allowed_transitions.length ? (
          <div className="border-t border-line bg-surface-2 px-5 py-3">
            <TransitionBar task={task} refData={refData} onChanged={onChange} />
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* main column */}
        <div className="min-w-0 space-y-4">
          <Card title={t("detail.description")} icon={<FileText />}>
            {summary ? (
              <div>
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-fg">{summary}</p>
                {task.description && summary !== task.description ? (
                  <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-xs text-fg-3" lang="en">
                    <span className="font-medium">{t("detail.original")}:</span> {task.description}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-fg-4">{t("detail.no_description")}</p>
            )}
          </Card>

          <Card
            title={task.messages.length ? t("detail.source_messages_n", { n: task.messages.length }) : t("detail.source_messages")}
            icon={<Send />}
            bodyClassName="bg-[radial-gradient(var(--line)_1px,transparent_1px)] [background-size:16px_16px] p-4 rounded-b-xl"
          >
            {task.messages.length === 0 ? (
              <p className="text-sm text-fg-3">{t("detail.no_messages")}</p>
            ) : (
              <div className="space-y-4">
                {[...sourceMessages, ...otherMessages].map((m) => (
                  <MessageCard key={m.id} message={m} />
                ))}
              </div>
            )}
          </Card>

          {task.source_text ? (
            <Card title={t("detail.source_text")} icon={<Hash />}>
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-fg-2">{task.source_text}</pre>
            </Card>
          ) : null}

          <Card title={t("detail.activity")} icon={<MessageSquare />}>
            <CommentBox taskId={task.id} onChange={onChange} />
            <div className="mt-5">
              <Timeline events={task.events} refData={refData} now={now} />
            </div>
          </Card>
        </div>

        {/* side column */}
        <div className="space-y-4">
          <PropertiesCard task={task} refData={refData} onChange={onChange} />
          <Card title={t("sla.title")} icon={<Timer />}>
            <SlaBar createdAt={task.created_at} dueAt={task.due_at} status={task.status} now={now} />
          </Card>
          <KeyDates task={task} now={now} />
          {task.allowed_transitions.includes("cancelled") && !task.merged_into_id ? <MergeCard task={task} /> : null}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- properties

function Prop({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 text-fg-4 [&_svg]:size-4">{icon}</span>
      <dt className="w-28 shrink-0 text-xs font-medium text-fg-3">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-fg">{children}</dd>
    </div>
  );
}

export function PropertiesCard({ task, refData, onChange }: { task: TaskDetailOut; refData: Reference; onChange: (t: TaskDetailOut) => void }) {
  const f = useFmt();
  const { t } = f;
  const [editing, setEditing] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isCandidate = task.status === "detected" || task.status === "needs_review";
  const participants = [
    ...(task.assignee ? [task.assignee.full_name] : []),
    ...task.events.map((e) => (e.actor_kind === "user" ? e.actor?.full_name : null)).filter((n): n is string => !!n),
  ];

  async function assign(e: FormEvent) {
    e.preventDefault();
    if (!assigneeId) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.assign(task.id, { assignee_id: assigneeId }));
      setAssigneeId("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={t("detail.properties")}
      actions={
        task.can_edit ? (
          <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil />
            {t("common.edit")}
          </Button>
        ) : null
      }
      bodyClassName="px-4 py-1"
    >
      <dl className="divide-y divide-line">
        <Prop icon={<Users />} label={t("detail.assignee")}>
          {task.assignee ? (
            <span className="flex items-center gap-2">
              <Avatar name={task.assignee.full_name} size="sm" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{task.assignee.full_name}</span>
                <span className="block truncate text-xs text-fg-3">{f.role(task.assignee.role)}</span>
              </span>
            </span>
          ) : (
            <span className="text-fg-3">{t("common.unassigned")}</span>
          )}
        </Prop>
      </dl>
      {task.can_assign ? (
        <form onSubmit={assign} className="flex gap-2 pb-3">
          <UserSelect
            refData={refData}
            value={assigneeId}
            onChange={setAssigneeId}
            preferDepartmentId={task.department?.id}
            placeholder={task.assignee ? t("detail.reassign_to") : t("detail.assign_to")}
            className="h-8 min-w-0 flex-1"
          />
          <Button type="submit" size="sm" variant="primary" busy={busy} disabled={!assigneeId || assigneeId === task.assignee?.id}>
            {isCandidate ? t("detail.approve_short") : task.assignee ? t("detail.reassign") : t("detail.assign")}
          </Button>
        </form>
      ) : null}
      {error ? <ErrorBanner error={error} className="mb-3" /> : null}
      <dl className="divide-y divide-line border-t border-line">
        <Prop icon={<Building2 />} label={t("form.department")}>
          {task.department?.name ?? <span className="italic text-fg-3">{t("dept.unrouted")}</span>}
        </Prop>
        <Prop icon={<TruckIcon />} label={t("form.truck")}>
          {task.truck ? (
            <Link href={`/tasks?truck_id=${task.truck.id}`} className="hover:opacity-80">
              <TruckChip unit={task.truck.unit_number} />
            </Link>
          ) : task.truck_unit_raw ? (
            <TruckChip unit={task.truck_unit_raw} unmatched title={t("detail.truck_unmatched_title")} />
          ) : (
            <span className="text-fg-4">—</span>
          )}
        </Prop>
        <Prop icon={<Package />} label={t("detail.load_ref")}>
          {task.load_ref ? <span className="font-mono text-[13px]">{task.load_ref}</span> : <span className="text-fg-4">—</span>}
        </Prop>
        <Prop icon={<FileText />} label={t("form.category")}>
          {f.category(task.category)}
        </Prop>
        <Prop icon={<Send />} label={t("detail.telegram_group")}>
          {task.group?.title ?? <span className="text-fg-4">—</span>}
        </Prop>
        <Prop icon={<Sparkles />} label={t("col.source")}>
          <SourceBadge source={task.source} />
        </Prop>
        {task.confidence !== null ? (
          <Prop icon={<Gauge />} label={t("badge.confidence")}>
            <Confidence value={task.confidence} compact wide />
          </Prop>
        ) : null}
        {participants.length ? (
          <Prop icon={<Users />} label={t("detail.participants")}>
            <AvatarGroup names={participants} max={5} />
          </Prop>
        ) : null}
      </dl>
      {editing ? (
        <Modal open title={t("detail.edit_title", { code: task.code })} icon={<Pencil />} wide onClose={() => setEditing(false)}>
          <EditForm
            task={task}
            refData={refData}
            onCancel={() => setEditing(false)}
            onSaved={(next) => {
              setEditing(false);
              onChange(next);
            }}
          />
        </Modal>
      ) : null}
    </Card>
  );
}

export function KeyDates({ task, now }: { task: TaskDetailOut; now: number }) {
  const f = useFmt();
  const { t } = f;
  const rows: [string, string | null][] = [
    [t("detail.created"), task.created_at],
    [t("detail.updated"), task.updated_at],
    [t("detail.started"), task.started_at],
    [t("detail.due_label"), task.due_at],
    [t("detail.completed"), task.completed_at],
  ];
  return (
    <Card title={t("detail.key_dates")} icon={<CalendarClock />}>
      <dl className="space-y-2 text-sm">
        {rows
          .filter(([, iso]) => iso)
          .map(([label, iso]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-fg-3">{label}</dt>
              <dd className="text-right tabular-nums text-fg" title={f.ago(iso, now)}>
                {f.dateTime(iso)}
              </dd>
            </div>
          ))}
      </dl>
    </Card>
  );
}

function EditForm({
  task,
  refData,
  onCancel,
  onSaved,
}: {
  task: TaskDetailOut;
  refData: Reference;
  onCancel: () => void;
  onSaved: (t: TaskDetailOut) => void;
}) {
  const { tz } = useMe();
  const f = useFmt();
  const { t } = f;
  const initialDue = isoToZonedInput(task.due_at, tz);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [category, setCategory] = useState<TaskCategory>(task.category);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [departmentId, setDepartmentId] = useState(task.department?.id ?? "");
  const [truckId, setTruckId] = useState(task.truck?.id ?? "");
  const [loadRef, setLoadRef] = useState(task.load_ref ?? "");
  const [due, setDue] = useState(initialDue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const translated = Object.keys(task.i18n ?? {}).length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const patch: TaskPatchIn = {};
    if (title.trim() !== task.title) patch.title = title.trim();
    if ((description.trim() || null) !== (task.description ?? null)) patch.description = description.trim() || null;
    if (category !== task.category) patch.category = category;
    if (priority !== task.priority) patch.priority = priority;
    if ((departmentId || null) !== (task.department?.id ?? null)) patch.department_id = departmentId || null;
    if ((truckId || null) !== (task.truck?.id ?? null)) patch.truck_id = truckId || null;
    if ((loadRef.trim() || null) !== (task.load_ref ?? null)) patch.load_ref = loadRef.trim() || null;
    if (due !== initialDue) {
      if (due) {
        const iso = zonedInputToIso(due, tz);
        if (!iso) {
          setError(t("form.invalid_due"));
          return;
        }
        patch.due_at = iso;
      } else {
        patch.due_at = null;
      }
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
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
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {error ? <ErrorBanner error={error} className="sm:col-span-2" /> : null}
      {translated ? <p className="rounded-lg bg-ai-soft px-3 py-2 text-xs text-ai-text sm:col-span-2">{t("detail.edit_original_hint")}</p> : null}
      <Field label={t("form.title")} className="sm:col-span-2">
        {(id) => <input id={id} className={inputCls} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label={t("form.description")} className="sm:col-span-2">
        {(id) => <textarea id={id} className={inputCls} rows={4} maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Field label={t("form.category")}>
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
      <Field label={t("form.priority")}>
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
      <Field label={t("form.department")}>{(id) => <DepartmentSelect id={id} refData={refData} value={departmentId} onChange={setDepartmentId} />}</Field>
      <Field label={t("form.truck")}>{(id) => <TruckSelect id={id} refData={refData} value={truckId} onChange={setTruckId} />}</Field>
      <Field label={t("form.load_ref")}>
        {(id) => <input id={id} className={inputCls} maxLength={64} value={loadRef} onChange={(e) => setLoadRef(e.target.value)} />}
      </Field>
      <Field label={t("form.due_tz", { tz: tzAbbreviation(tz) })} hint={task.due_at && !due ? t("detail.clear_due_hint") : undefined}>
        {(id) => <input id={id} type="datetime-local" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" busy={busy}>
          {t("common.save_changes")}
        </Button>
      </div>
    </form>
  );
}

// --------------------------------------------------------------------------- merge

export function MergeCard({ task }: { task: TaskDetailOut }) {
  const router = useRouter();
  const toast = useToast();
  const f = useFmt();
  const { t } = f;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TaskOut | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function merge() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.merge(task.id, { into_task_id: target.id, reason: reason.trim() || t("merge.default_reason", { code: target.code }) });
      invalidateCache("/api/tasks");
      invalidateCache("/api/dashboard");
      toast(t("toast.merged", { code: task.code, target: result.code }));
      router.push(`/tasks/${result.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card title={t("merge.title")} icon={<GitMerge />}>
      {!open ? (
        <>
          <p className="text-sm text-fg-3">{t("merge.explain")}</p>
          <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>
            <GitMerge />
            {t("merge.start")}
          </Button>
        </>
      ) : target ? (
        <div className="space-y-2.5">
          <p className="text-sm text-fg-2">{t("merge.confirm_text", { code: task.code, target: target.code, title: f.title(target) })}</p>
          <textarea
            className={inputCls}
            rows={2}
            maxLength={2000}
            placeholder={t("merge.reason_placeholder", { reason: t("merge.default_reason", { code: target.code }) })}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label={t("merge.reason_label")}
          />
          {error ? <ErrorBanner error={error} /> : null}
          <div className="flex gap-2">
            <Button variant="danger" busy={busy} onClick={merge}>
              {t("merge.into", { code: target.code })}
            </Button>
            <Button onClick={() => setTarget(null)}>{t("common.back")}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <TaskPicker excludeId={task.id} autoFocus suggest={task.truck ? { truck_id: task.truck.id } : undefined} onPick={setTarget} />
          <Button size="sm" onClick={() => setOpen(false)}>
            {t("common.close")}
          </Button>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- comments

export function CommentBox({ taskId, onChange }: { taskId: string; onChange: (t: TaskDetailOut) => void }) {
  const { t } = useT();
  const { me } = useMe();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.comment(taskId, { text: text.trim() }));
      setText("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-3">
      <Avatar name={me.full_name} size="md" />
      <div className="min-w-0 flex-1 space-y-2">
        <textarea
          className={inputCls}
          rows={2}
          maxLength={4000}
          placeholder={t("comment.placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
          }}
          aria-label={t("comment.label")}
        />
        {error ? <ErrorBanner error={error} /> : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="primary" busy={busy} disabled={!text.trim()}>
            {t("comment.submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
