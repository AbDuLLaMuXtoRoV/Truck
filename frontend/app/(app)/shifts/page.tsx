"use client";

import { AlertTriangle, ArrowRightLeft, CalendarClock, CheckCircle2, LogIn, LogOut, ShieldAlert, Users, XCircle } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Avatar } from "@/components/avatars";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { deptLabel } from "@/lib/crm";
import { UserSelect } from "@/components/pickers";
import { useToast } from "@/components/toast";
import { Button, Card, Empty, ErrorBanner, Field, Modal, PageHeader, Skeleton, cx, inputCls } from "@/components/ui";
import { api, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { formatDuration, useFmt } from "@/lib/format";
import { invalidateCache, useApi, useNow } from "@/lib/hooks";
import { useReference } from "@/lib/reference";
import type { CoverageOut, HandoverOut, MyShiftOut } from "@/lib/types";

function refreshShifts() {
  invalidateCache("/api/shifts");
  invalidateCache("/api/dashboard");
}

export default function ShiftsPage() {
  const { can } = useMe();
  const { t } = useFmt();
  const mine = useApi<MyShiftOut>(paths.myShift(), { refreshMs: 15000 });
  const coverage = useApi<CoverageOut[]>(can("dashboard.read") ? paths.coverage() : null, { refreshMs: 30000 });
  const reload = () => {
    refreshShifts();
    mine.reload();
    coverage.reload();
  };
  return (
    <div className="space-y-5">
      <PageHeader icon={<CalendarClock />} title={t("crm.nav.shifts")} subtitle={t("crm.shifts_sub")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <MyShiftCard data={mine.data} error={mine.error} onRetry={mine.reload} onChanged={reload} />
        <HandoversCard data={mine.data} onChanged={reload} />
      </div>
      {can("dashboard.read") ? <CoverageCard data={coverage.data} error={coverage.error} onRetry={coverage.reload} /> : null}
    </div>
  );
}

// --------------------------------------------------------------------------- my shift

function MyShiftCard({ data, error, onRetry, onChanged }: { data: MyShiftOut | undefined; error: unknown; onRetry: () => void; onChanged: () => void }) {
  const f = useFmt();
  const { t } = f;
  const toast = useToast();
  const now = useNow(30000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [ending, setEnding] = useState(false);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      await api.startShift();
      toast(t("crm.shift_started"));
      onChanged();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const active = data?.active ?? null;
  return (
    <Card title={t("crm.my_shift")} icon={<CalendarClock />}>
      {error && !data ? <ErrorBanner error={error} onRetry={onRetry} /> : null}
      {!data && !error ? <Skeleton className="h-28 w-full rounded-lg" /> : null}
      {data ? (
        <div className="space-y-4">
          <div className={cx("rounded-xl border p-4", active ? "border-emerald-500/30 bg-emerald-500/8" : "border-line bg-surface-2")}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className={cx("size-2.5 rounded-full", active ? "bg-emerald-500" : "bg-fg-4")} aria-hidden />
              {active ? t("crm.on_shift") : t("crm.off_shift")}
            </div>
            {active ? (
              <p className="mt-1 text-sm text-fg-2">
                {t("crm.on_shift_since", { time: f.time(active.started_at), d: formatDuration(now - Date.parse(active.started_at), t) })}
              </p>
            ) : (
              <p className="mt-1 text-sm text-fg-3">{t("crm.off_shift_hint")}</p>
            )}
            <p className="mt-2 text-sm text-fg-2">{t("crm.my_open_issues", { n: data.open_tasks })}</p>
          </div>
          {err ? <ErrorBanner error={err} /> : null}
          {active ? (
            <Button variant="danger" size="md" className="w-full" onClick={() => setEnding(true)}>
              <LogOut />
              {t("crm.end_shift")}
            </Button>
          ) : (
            <Button variant="success" size="md" className="w-full" busy={busy} onClick={() => void start()}>
              <LogIn />
              {t("crm.start_shift")}
            </Button>
          )}
          {data.outgoing_pending.length ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 text-sm">
              <div className="font-medium text-fg">{t("crm.handover_waiting")}</div>
              {data.outgoing_pending.map((h) => (
                <div key={h.id} className="mt-1 text-fg-2">
                  {t("crm.handover_to_pending", { name: h.to_user.full_name, n: h.task_count })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {ending && data ? (
        <EndShiftDialog
          openTasks={data.open_tasks}
          onClose={() => setEnding(false)}
          onDone={() => {
            setEnding(false);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

function EndShiftDialog({ openTasks, onClose, onDone }: { openTasks: number; onClose: () => void; onDone: () => void }) {
  const { me } = useMe();
  const { t } = useFmt();
  const toast = useToast();
  const refData = useReference();
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.endShift({ handover_to_user_id: to || null, note: note.trim() || null });
      toast(res.handover ? t("crm.shift_ended_handover", { name: res.handover.to_user.full_name }) : t("crm.shift_ended"));
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
      title={t("crm.end_shift")}
      onClose={onClose}
      icon={<LogOut />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="danger" type="submit" form="crm-end-shift" busy={busy}>
            {to ? t("crm.end_and_handover") : t("crm.end_shift")}
          </Button>
        </>
      }
    >
      <form id="crm-end-shift" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-fg-3">{openTasks ? t("crm.end_shift_explain", { n: openTasks }) : t("crm.end_shift_nothing")}</p>
        <Field label={t("crm.hand_over_to")}>
          {(id) => (
            <UserSelect
              id={id}
              refData={{ ...refData, activeUsers: refData.activeUsers.filter((u) => u.id !== me.id) }}
              value={to}
              onChange={setTo}
              preferDepartmentId={me.department_id}
              placeholder={t("crm.nobody_handover")}
              className="w-full"
            />
          )}
        </Field>
        <Field label={t("crm.handover_note")} hint={t("crm.handover_note_hint")}>
          {(id) => <textarea id={id} className={cx(inputCls, "min-h-24")} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error ? <ErrorBanner error={error} /> : null}
      </form>
    </Modal>
  );
}

// --------------------------------------------------------------------------- handovers

function HandoversCard({ data, onChanged }: { data: MyShiftOut | undefined; onChanged: () => void }) {
  const { t } = useFmt();
  const incoming = data?.incoming_handovers ?? [];
  return (
    <Card title={t("crm.incoming_handovers")} icon={<ArrowRightLeft />} subtitle={t("crm.incoming_handovers_sub")}>
      {!data ? <Skeleton className="h-28 w-full rounded-lg" /> : null}
      {data && incoming.length === 0 ? (
        <Empty illustration="check" compact>
          {t("crm.no_handovers")}
        </Empty>
      ) : null}
      <div className="space-y-3">
        {incoming.map((h) => (
          <HandoverItem key={h.id} h={h} onChanged={onChanged} />
        ))}
      </div>
    </Card>
  );
}

function HandoverItem({ h, onChanged }: { h: HandoverOut; onChanged: () => void }) {
  const f = useFmt();
  const { t } = f;
  const toast = useToast();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const critical = h.tasks.filter((x) => x.priority === "P1");
  async function act(kind: "accept" | "decline") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "accept") await api.acceptHandover(h.id);
      else await api.declineHandover(h.id);
      toast(kind === "accept" ? t("crm.handover_accepted", { n: h.task_count }) : t("crm.handover_declined"));
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }
  return (
    <article className={cx("rounded-xl border p-4", h.status === "pending" ? "border-accent/30 bg-accent-soft/30" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={h.from_user.full_name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fg">{t("crm.handover_from", { name: h.from_user.full_name })}</div>
          <div className="text-xs text-fg-3">
            {f.dateTime(h.created_at)} · {t("crm.n_issues", { n: h.task_count })}
          </div>
        </div>
        {critical.length ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
            <ShieldAlert className="size-3.5" aria-hidden />
            {t("crm.critical_n", { n: critical.length })}
          </span>
        ) : null}
      </div>
      {h.note ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-sm text-fg-2 ring-1 ring-line">{h.note}</p> : null}
      {h.tasks.length ? (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {[...h.tasks]
            .sort((a, b) => (a.priority === "P1" ? -1 : 0) - (b.priority === "P1" ? -1 : 0))
            .map((task) => (
              <li key={task.id} className={cx("flex items-center gap-2 px-3 py-2 text-sm", task.priority === "P1" && "bg-red-500/8")}>
                {task.priority === "P1" ? <AlertTriangle className="size-4 shrink-0 text-red-500" aria-label={t("crm.critical")} /> : null}
                <Link href={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  <span className="mr-1.5 font-mono text-xs text-fg-3">{task.code}</span>
                  {f.title(task)}
                </Link>
                <PriorityBadge priority={task.priority} />
                <StatusBadge status={task.status} />
              </li>
            ))}
        </ul>
      ) : null}
      {error ? (
        <div className="mt-3">
          <ErrorBanner error={error} />
        </div>
      ) : null}
      {h.status === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="success" busy={busy === "accept"} disabled={busy !== null} onClick={() => void act("accept")}>
            <CheckCircle2 />
            {t("crm.accept")}
          </Button>
          <Button busy={busy === "decline"} disabled={busy !== null} onClick={() => void act("decline")}>
            <XCircle />
            {t("crm.decline")}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-fg-3">{h.status === "accepted" ? t("crm.handover_status_accepted") : t("crm.handover_status_declined")}</p>
      )}
    </article>
  );
}

// --------------------------------------------------------------------------- coverage

function CoverageCard({ data, error, onRetry }: { data: CoverageOut[] | undefined; error: unknown; onRetry: () => void }) {
  const f = useFmt();
  const { t } = f;
  const gaps = (data ?? []).filter((c) => c.gap);
  return (
    <Card title={t("crm.coverage")} icon={<Users />} subtitle={t("crm.coverage_sub")}>
      {error && !data ? <ErrorBanner error={error} onRetry={onRetry} /> : null}
      {!data && !error ? <Skeleton className="h-40 w-full rounded-lg" /> : null}
      {gaps.length ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-3 py-2 text-sm text-red-800 dark:text-red-200" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("crm.coverage_gap", { names: gaps.map((g) => deptLabel(g, t)).join(", ") })}
        </div>
      ) : null}
      {data && data.length ? (
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3">
              <tr>
                <th className="px-4 py-2.5">{t("crm.col.department")}</th>
                <th className="px-3 py-2.5">{t("crm.on_duty")}</th>
                <th className="px-3 py-2.5 text-right">{t("crm.os.unresolved")}</th>
                <th className="px-3 py-2.5 text-right">{t("crm.state.unanswered")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((c) => (
                <tr key={c.department_id} className={c.gap ? "bg-red-500/5" : undefined}>
                  <td className="px-4 py-2.5 font-medium text-fg">{deptLabel(c, t)}</td>
                  <td className="px-3 py-2.5">
                    {c.on_duty.length ? (
                      <div className="flex flex-wrap gap-2">
                        {c.on_duty.map((u) => (
                          <span key={u.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 py-0.5 pl-0.5 pr-2 text-xs text-fg">
                            <Avatar name={u.full_name} size="xs" />
                            {u.full_name}
                            <span className="text-fg-3">· {t("crm.since", { time: f.time(u.since) })}</span>
                          </span>
                        ))}
                      </div>
                    ) : c.gap ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 dark:text-red-300">
                        <AlertTriangle className="size-3.5" aria-hidden />
                        {t("crm.nobody_on_duty")}
                      </span>
                    ) : (
                      <span className="text-xs text-fg-4">{t("crm.nobody_on_duty")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{f.count(c.open_issues)}</td>
                  <td className={cx("px-3 py-2.5 text-right tabular-nums", c.unanswered > 0 && "font-semibold text-danger-text")}>{f.count(c.unanswered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && data.length === 0 ? <Empty compact>{t("crm.coverage_empty")}</Empty> : null}
    </Card>
  );
}
