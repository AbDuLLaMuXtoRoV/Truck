"use client";

import { deptLabel } from "@/lib/crm";
import { useMemo, useRef, useState } from "react";
import { errorMessage, paths } from "@/lib/api";
import { taskTitle } from "@/lib/format";
import { useApi, useDebounced, useDismiss } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { Reference } from "@/lib/reference";
import type { TaskListOut, TaskListQuery, TaskOut, UUID } from "@/lib/types";
import { PriorityBadge, StatusWithOverdue } from "./badges";
import { cx, inputCls, selectBase, Spinner } from "./ui";

/** Full width unless the caller passes its own w-* class. */
const widthed = (className?: string) => cx(selectBase, /(^|\s)w-/.test(className ?? "") ? "" : "w-full", className);

// --------------------------------------------------------------------------- native selects

export function UserSelect({
  id,
  refData,
  value,
  onChange,
  preferDepartmentId,
  placeholder,
  allowEmpty = true,
  disabled,
  className,
}: {
  id?: string;
  refData: Reference;
  value: UUID | "";
  onChange: (v: UUID | "") => void;
  preferDepartmentId?: UUID | null;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { t, label } = useT();
  const { preferred, others } = useMemo(() => {
    const users = refData.activeUsers;
    if (!preferDepartmentId) return { preferred: [], others: users };
    return {
      preferred: users.filter((u) => u.department_id === preferDepartmentId),
      others: users.filter((u) => u.department_id !== preferDepartmentId),
    };
  }, [refData.activeUsers, preferDepartmentId]);
  const dept = preferDepartmentId ? refData.departmentById.get(preferDepartmentId) : undefined;
  const option = (u: (typeof others)[number]) => (
    <option key={u.id} value={u.id}>
      {u.full_name} · {label("role", u.role)}
    </option>
  );
  return (
    <select id={id} className={widthed(className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty ? <option value="">{placeholder ?? t("picker.choose_assignee")}</option> : null}
      {preferred.length ? (
        <>
          <optgroup label={dept ? deptLabel(dept, t) : t("picker.department_group")}>{preferred.map(option)}</optgroup>
          <optgroup label={t("picker.everyone_else")}>{others.map(option)}</optgroup>
        </>
      ) : (
        others.map(option)
      )}
    </select>
  );
}

export function DepartmentSelect({
  id,
  refData,
  value,
  onChange,
  emptyLabel,
  disabled,
  className,
}: {
  id?: string;
  refData: Reference;
  value: UUID | "";
  onChange: (v: UUID | "") => void;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useT();
  return (
    <select id={id} className={widthed(className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? t("picker.no_department")}</option>
      {refData.departments.map((d) => (
        <option key={d.id} value={d.id}>
          {deptLabel(d, t)}
        </option>
      ))}
    </select>
  );
}

export function TruckSelect({
  id,
  refData,
  value,
  onChange,
  emptyLabel,
  disabled,
  className,
}: {
  id?: string;
  refData: Reference;
  value: UUID | "";
  onChange: (v: UUID | "") => void;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useT();
  return (
    <select id={id} className={widthed(className)} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel ?? t("picker.no_truck")}</option>
      {refData.trucks.map((tr) => (
        <option key={tr.id} value={tr.id}>
          {tr.is_active ? tr.unit_number : t("picker.truck_inactive", { unit: tr.unit_number })}
        </option>
      ))}
    </select>
  );
}

// --------------------------------------------------------------------------- multi-select dropdown

export function MultiSelect<T extends string>({
  label,
  options,
  value,
  onChange,
  renderOption,
}: {
  label: string;
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  renderOption: (v: T) => string;
}) {
  const { t, tp } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const summary =
    value.length === 0 ? t("picker.any") : value.length === 1 ? renderOption(value[0]) : tp("picker.selected", value.length);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          selectBase,
          "flex h-8 min-w-36 items-center justify-between gap-2 text-left",
          value.length ? "border-accent bg-accent-soft" : "",
        )}
      >
        <span className="truncate">
          <span className="text-fg-3">{label}: </span>
          {summary}
        </span>
      </button>
      {open ? (
        <div className="absolute left-0 z-40 mt-1.5 w-64 animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-pop" role="listbox" aria-multiselectable>
          {options.map((o) => {
            const checked = value.includes(o);
            return (
              <label key={o} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-fg-2 hover:bg-surface-3 hover:text-fg">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-line-strong accent-indigo-600"
                  checked={checked}
                  onChange={() => onChange(checked ? value.filter((v) => v !== o) : [...value, o])}
                />
                {renderOption(o)}
              </label>
            );
          })}
          {value.length ? (
            <div className="border-t border-line px-3 pt-1.5 pb-1">
              <button type="button" className="text-xs font-medium text-accent-text hover:underline" onClick={() => onChange([])}>
                {t("common.clear")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- task search (merge target)

export function TaskPicker({
  excludeId,
  suggest,
  onPick,
  autoFocus,
}: {
  excludeId: UUID;
  /** Query used while the search box is empty (e.g. open tasks on the same truck). */
  suggest?: TaskListQuery;
  onPick: (task: TaskOut) => void;
  autoFocus?: boolean;
}) {
  const { t, lang } = useT();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const query: TaskListQuery = dq
    ? { q: dq, open: true, limit: 8, sort: "updated_desc" }
    : { open: true, limit: 8, sort: "updated_desc", ...suggest };
  const { data, loading, error } = useApi<TaskListOut>(paths.tasks(query));
  const items = (data?.items ?? []).filter((x) => x.id !== excludeId);
  return (
    <div>
      <div className="relative">
        <input
          className={inputCls}
          placeholder={t("picker.task_search_placeholder")}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("picker.task_search_label")}
        />
        {loading ? <Spinner className="absolute right-2 top-2 h-4 w-4 text-fg-4" /> : null}
      </div>
      <p className="mt-1 text-xs text-fg-3">
        {dq ? t("picker.matching_open") : suggest ? t("picker.suggestions") : t("picker.recent_open")}
      </p>
      {error ? <p className="mt-1 text-xs text-danger-text">{errorMessage(error)}</p> : null}
      <ul className="mt-1.5 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface">
        {items.length === 0 && !loading ? <li className="px-3 py-2 text-sm text-fg-3">{t("picker.no_open_tasks")}</li> : null}
        {items.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onPick(task)}
              className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent-soft"
            >
              <span className="font-mono text-xs text-fg-3">{task.code}</span>
              <PriorityBadge priority={task.priority} />
              <span className="min-w-0 flex-1 truncate text-fg">{taskTitle(task, lang)}</span>
              {task.truck ? <span className="text-xs text-fg-3">#{task.truck.unit_number}</span> : null}
              <StatusWithOverdue status={task.status} overdue={task.is_overdue} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
