"use client";

import { Ban, Check, CheckCheck, Pause, Play, Undo2, UserCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, errorMessage } from "@/lib/api";
import { invalidateCache } from "@/lib/hooks";
import { useT, type Key } from "@/lib/i18n";
import type { Reference } from "@/lib/reference";
import { simpleActions, type SimpleAction } from "@/lib/stage";
import type { TaskDetailOut, TaskStatus } from "@/lib/types";
import { UserSelect } from "../pickers";
import { useToast } from "../toast";
import { cx, inputCls } from "../ui";
import { BigButton, ChoiceChips, Sheet } from "./parts";
import { TipBubble, useOneTimeTip } from "./tips";

const TARGET: Record<Exclude<SimpleAction, "assign">, TaskStatus> = {
  start: "in_progress",
  done: "pending_verification",
  stuck: "blocked",
  continue: "in_progress",
  not_task: "cancelled",
  confirm: "completed",
  send_back: "in_progress",
};

const LABEL: Record<SimpleAction, Key> = {
  start: "s.btn_start",
  done: "s.btn_done",
  stuck: "s.btn_stuck",
  continue: "s.btn_continue",
  assign: "s.btn_assign",
  not_task: "s.btn_not_task",
  confirm: "s.btn_confirm",
  send_back: "s.btn_send_back",
};

const ICON: Record<SimpleAction, ReactNode> = {
  start: <Play />,
  done: <Check />,
  stuck: <Pause />,
  continue: <Play />,
  assign: <UserCheck />,
  not_task: <Ban />,
  confirm: <CheckCheck />,
  send_back: <Undo2 />,
};

/** Reason presets per action (the chip text is sent as the reason, in the user's language). */
const REASONS: Partial<Record<SimpleAction, { title: Key; options: Key[]; otherNeedsText?: string }>> = {
  stuck: { title: "s.sheet_stuck", options: ["s.r_part", "s.r_driver", "s.r_money"] },
  not_task: { title: "s.sheet_not_task", options: ["s.r_not_task", "s.r_duplicate", "s.r_solved"] },
  send_back: { title: "s.sheet_send_back", options: ["s.r_unfinished", "s.r_need_doc", "s.r_other"], otherNeedsText: "s.r_other" },
};

/** One-time hint above a card's main button. */
const TIP: Partial<Record<SimpleAction, Key>> = {
  start: "s.tip_start",
  done: "s.tip_done",
  continue: "s.tip_continue",
  assign: "s.tip_assign",
  confirm: "s.tip_confirm",
};

const TOAST: Record<SimpleAction, Key> = {
  start: "s.toast_started",
  done: "s.toast_done",
  stuck: "s.toast_stuck",
  continue: "s.toast_continue",
  assign: "s.toast_assigned",
  not_task: "s.toast_not_task",
  confirm: "s.toast_confirmed",
  send_back: "s.toast_sent_back",
};

/**
 * Big plain buttons for a task. Only actions whose target is in `allowed_transitions` appear; the
 * first one is the primary action.
 */
export function SimpleActions({ task, refData, onChanged }: { task: TaskDetailOut; refData: Reference; onChanged: (next: TaskDetailOut) => void }) {
  const { t } = useT();
  const toast = useToast();
  const actions = simpleActions(task.status, task.allowed_transitions);
  const [busy, setBusy] = useState<SimpleAction | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<SimpleAction | null>(null);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const defaultAssignee = task.department ? refData.departmentById.get(task.department.id)?.default_assignee_user_id : null;
  const [assignee, setAssignee] = useState<string>(defaultAssignee && refData.activeUsers.some((u) => u.id === defaultAssignee) ? defaultAssignee : "");
  const primary = actions[0];
  const tip = useOneTimeTip(primary && TIP[primary] ? `action.${primary}` : null);

  if (actions.length === 0) return null;

  async function run(action: SimpleAction, reason?: string) {
    setBusy(action);
    setError(null);
    try {
      const next =
        action === "assign"
          ? await api.transition(task.id, { to_status: "assigned", assignee_id: assignee })
          : await api.transition(task.id, { to_status: TARGET[action], ...(reason ? { reason } : {}) });
      setSheet(null);
      invalidateCache("/api/tasks");
      invalidateCache("/api/dashboard");
      toast(t(TOAST[action], { code: task.code, name: next.assignee?.full_name ?? "" }));
      onChanged(next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  function press(action: SimpleAction) {
    if (REASONS[action]) {
      setChoice("");
      setNote("");
      setError(null);
      setSheet(action);
      return;
    }
    void run(action);
  }

  const sheetCfg = sheet ? REASONS[sheet] : undefined;
  const reasonText = () => {
    const chip = choice ? t(choice as Key) : "";
    return [chip, note.trim()].filter(Boolean).join(" — ");
  };
  const needsText = !!sheetCfg?.otherNeedsText && choice === sheetCfg.otherNeedsText && !note.trim();
  const tipText = tip.show && TIP[primary] ? t(TIP[primary]) : null;

  return (
    <div className="space-y-3">
      {tipText ? <TipBubble text={tipText} onDismiss={tip.dismiss} /> : null}
      {actions.includes("assign") ? (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <label className="mb-1.5 block text-base font-semibold text-fg">{t("s.who")}</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <UserSelect
              refData={refData}
              value={assignee}
              onChange={setAssignee}
              preferDepartmentId={task.department?.id}
              placeholder={t("s.who_placeholder")}
              className="min-h-12 flex-1 text-[15px]"
            />
            <BigButton variant="primary" icon={ICON.assign} busy={busy === "assign"} disabled={!assignee} onClick={() => void run("assign")}>
              {t(LABEL.assign)}
            </BigButton>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {actions
          .filter((a) => a !== "assign")
          .map((a) => (
            <BigButton
              key={a}
              icon={ICON[a]}
              busy={busy === a}
              disabled={busy !== null}
              variant={a === primary ? (a === "confirm" ? "success" : "primary") : a === "not_task" ? "danger" : "secondary"}
              onClick={() => press(a)}
            >
              {t(LABEL[a])}
            </BigButton>
          ))}
      </div>
      {error && !sheet ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">{errorMessage(error)}</p> : null}

      <Sheet open={!!sheetCfg} title={sheetCfg ? t(sheetCfg.title) : ""} onClose={() => setSheet(null)}>
        {sheetCfg && sheet ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!choice && !note.trim()) return;
              if (needsText) return;
              void run(sheet, reasonText());
            }}
            className="space-y-4"
          >
            <ChoiceChips options={sheetCfg.options.map((k) => ({ id: k, label: t(k) }))} value={choice} onChange={setChoice} />
            <div>
              <label htmlFor="simple-note" className="mb-1.5 block text-sm font-medium text-fg-2">
                {needsText || (sheetCfg.otherNeedsText && choice === sheetCfg.otherNeedsText) ? t("s.note_required") : t("s.note_optional")}
              </label>
              <textarea id="simple-note" className={cx(inputCls, "min-h-20 text-[15px]")} value={note} maxLength={1500} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error ? <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text">{errorMessage(error)}</p> : null}
            <BigButton type="submit" variant={sheet === "not_task" ? "danger" : "primary"} busy={busy === sheet} disabled={(!choice && !note.trim()) || needsText}>
              {t(LABEL[sheet])}
            </BigButton>
          </form>
        ) : null}
      </Sheet>
    </div>
  );
}
