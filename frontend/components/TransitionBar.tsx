"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { reasonRequired, sortTransitions, transitionKey } from "@/lib/format";
import { useT, type Key } from "@/lib/i18n";
import type { Reference } from "@/lib/reference";
import type { TaskDetailOut, TaskStatus } from "@/lib/types";
import { UserSelect } from "./pickers";
import { Button, cx, ErrorBanner, inputCls } from "./ui";

function variantFor(from: TaskStatus, to: TaskStatus): "primary" | "success" | "danger" | "secondary" {
  if (to === "cancelled") return "danger";
  if (to === "completed") return "success";
  if (to === "blocked") return "secondary";
  if (to === "in_progress" && (from === "pending_verification" || from === "completed")) return "secondary";
  if (to === "assigned") return from === "detected" || from === "needs_review" ? "primary" : "secondary";
  if (to === "in_progress" || to === "pending_verification") return "primary";
  return "secondary";
}

function reasonPromptKey(from: TaskStatus, to: TaskStatus): Key {
  if (to === "blocked") return "tr.prompt_blocked";
  if (to === "cancelled") return "tr.prompt_cancelled";
  if (from === "completed") return "tr.prompt_reopen";
  return "tr.prompt_reject";
}

/**
 * Status actions for a task. Only `allowed_transitions` are rendered. Changes that need a reason
 * (blocked, cancelled, reopen, rejected verification) or an assignee (assigned) open an inline form.
 */
export function TransitionBar({
  task,
  refData,
  onChanged,
  initial,
}: {
  task: TaskDetailOut;
  refData: Reference;
  onChanged: (next: TaskDetailOut) => void;
  /** Open the form for this target right away (e.g. from a board card menu). */
  initial?: TaskStatus;
}) {
  const { t, label } = useT();
  const [pending, setPending] = useState<TaskStatus | null>(initial ?? null);
  const [reason, setReason] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<unknown>(null);

  const from = task.status;
  const targets = sortTransitions(from, task.allowed_transitions);
  if (targets.length === 0) return null;

  const needsForm = (to: TaskStatus) => reasonRequired(from, to) || to === "assigned";

  async function run(to: TaskStatus, body: { reason?: string; assignee_id?: string }) {
    setBusy(to);
    setError(null);
    try {
      const next = await api.transition(task.id, { to_status: to, ...body });
      setPending(null);
      setReason("");
      onChanged(next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  function open(to: TaskStatus) {
    setError(null);
    if (!needsForm(to)) {
      void run(to, {});
      return;
    }
    setPending(to);
    setReason("");
    setAssigneeId(task.assignee?.id ?? "");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    const body: { reason?: string; assignee_id?: string } = {};
    if (reasonRequired(from, pending)) {
      if (!reason.trim()) return;
      body.reason = reason.trim();
    } else if (reason.trim()) {
      body.reason = reason.trim();
    }
    if (pending === "assigned") {
      if (!assigneeId) return;
      body.assignee_id = assigneeId;
    }
    void run(pending, body);
  }

  const needsReason = pending ? reasonRequired(from, pending) : false;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => (
          <Button
            key={to}
            variant={variantFor(from, to)}
            onClick={() => open(to)}
            busy={busy === to}
            disabled={busy !== null}
            aria-expanded={needsForm(to) ? pending === to : undefined}
            className={cx(pending === to && "ring-2 ring-accent/30")}
            title={t("tr.move_to", { status: label("status", to) })}
          >
            {t(transitionKey(from, to))}
          </Button>
        ))}
      </div>
      {pending ? (
        <form onSubmit={submit} className="mt-3 animate-slide-up space-y-2.5 rounded-xl border border-line bg-surface-2 p-3.5">
          <div className="text-xs font-medium text-fg-2">
            {t(transitionKey(from, pending))} → <span className="text-fg">{label("status", pending)}</span>
          </div>
          {pending === "assigned" ? (
            <UserSelect
              refData={refData}
              value={assigneeId}
              onChange={setAssigneeId}
              preferDepartmentId={task.department?.id}
              placeholder={t("tr.choose_assignee_required")}
            />
          ) : null}
          {needsReason || pending === "assigned" ? (
            <textarea
              className={inputCls}
              rows={2}
              maxLength={2000}
              autoFocus={pending !== "assigned"}
              required={needsReason}
              placeholder={needsReason ? t(reasonPromptKey(from, pending)) : t("tr.note_optional")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label={t("tr.reason")}
            />
          ) : null}
          {error ? <ErrorBanner error={error} /> : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              variant={variantFor(from, pending)}
              busy={busy === pending}
              disabled={(needsReason && !reason.trim()) || (pending === "assigned" && !assigneeId)}
            >
              {t("common.confirm")}
            </Button>
            <Button onClick={() => setPending(null)}>{t("common.close")}</Button>
          </div>
        </form>
      ) : error ? (
        <ErrorBanner error={error} className="mt-2" />
      ) : null}
    </div>
  );
}
