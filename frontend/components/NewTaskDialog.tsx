"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { tzAbbreviation, useFmt, zonedInputToIso } from "@/lib/format";
import type { Reference } from "@/lib/reference";
import { CATEGORY_DEPARTMENT, PRIORITIES, TASK_CATEGORIES, type Priority, type TaskCategory, type TaskOut } from "@/lib/types";
import { DepartmentSelect, TruckSelect, UserSelect } from "./pickers";
import { Button, ErrorBanner, Field, inputCls, Modal, selectCls } from "./ui";

export function NewTaskDialog({
  open,
  onClose,
  onCreated,
  refData,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (task: TaskOut) => void;
  refData: Reference;
}) {
  const { tz, me, can } = useMe();
  const { t, category: categoryName, priority: priorityName } = useFmt();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TaskCategory>("other");
  const [priority, setPriority] = useState<Priority>("P3");
  const [departmentId, setDepartmentId] = useState<string>("");
  const [deptTouched, setDeptTouched] = useState(false);
  const [truckId, setTruckId] = useState("");
  const [loadRef, setLoadRef] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Mirrors services/tasks.create_task: a task created already assigned skips review, so assigning it
  // to someone else needs lead rights over its department (the backend falls back to the creator's).
  const effectiveDeptId = departmentId || me.department_id;
  const canAssignOthers =
    can("tasks.update_all") || (can("tasks.update_department") && !!me.department_id && effectiveDeptId === me.department_id);
  const effectiveAssignee = canAssignOthers || assigneeId === me.id ? assigneeId : "";

  function reset() {
    setTitle("");
    setDescription("");
    setCategory("other");
    setPriority("P3");
    setDepartmentId("");
    setDeptTouched(false);
    setTruckId("");
    setLoadRef("");
    setAssigneeId("");
    setDue("");
    setError(null);
  }

  function changeCategory(c: TaskCategory) {
    setCategory(c);
    // follow the default category -> department routing until the user picks a department
    if (!deptTouched) {
      const code = CATEGORY_DEPARTMENT[c];
      setDepartmentId(code ? (refData.departmentByCode.get(code)?.id ?? "") : "");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    let dueIso: string | null = null;
    if (due) {
      dueIso = zonedInputToIso(due, tz);
      if (!dueIso) {
        setError(t("form.invalid_due"));
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask({
        title: title.trim(),
        description: description.trim() || null,
        category,
        priority,
        department_id: departmentId || null,
        truck_id: truckId || null,
        load_ref: loadRef.trim() || null,
        assignee_id: effectiveAssignee || null,
        ...(dueIso ? { due_at: dueIso } : {}),
      });
      reset();
      onCreated(task);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const myDept = me.department_id ? refData.departmentById.get(me.department_id) : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("newtask.title")}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" type="submit" form="new-task-form" busy={busy} disabled={!title.trim()}>
            {t("newtask.create")}
          </Button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {error ? <ErrorBanner error={error} className="sm:col-span-2" /> : null}
        <Field label={t("form.title_required")} className="sm:col-span-2">
          {(id) => (
            <input
              id={id}
              className={inputCls}
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("newtask.title_placeholder")}
            />
          )}
        </Field>
        <Field label={t("form.description")} className="sm:col-span-2">
          {(id) => (
            <textarea
              id={id}
              className={inputCls}
              rows={3}
              maxLength={10000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("form.category")}>
          {(id) => (
            <select id={id} className={selectCls} value={category} onChange={(e) => changeCategory(e.target.value as TaskCategory)}>
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryName(c)}
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
                  {priorityName(p)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("form.department")}
          hint={!departmentId && myDept ? t("newtask.dept_default_hint", { name: myDept.name }) : undefined}
        >
          {(id) => (
            <DepartmentSelect
              id={id}
              refData={refData}
              value={departmentId}
              onChange={(v) => {
                setDeptTouched(true);
                setDepartmentId(v);
              }}
              emptyLabel={myDept ? t("newtask.dept_default") : t("picker.no_department")}
            />
          )}
        </Field>
        <Field label={t("form.truck")}>
          {(id) => <TruckSelect id={id} refData={refData} value={truckId} onChange={setTruckId} />}
        </Field>
        <Field label={t("form.load_ref")}>
          {(id) => <input id={id} className={inputCls} maxLength={64} value={loadRef} onChange={(e) => setLoadRef(e.target.value)} />}
        </Field>
        <Field
          label={t("form.assignee")}
          hint={
            effectiveAssignee
              ? t("newtask.assignee_hint_assigned")
              : canAssignOthers
                ? t("newtask.assignee_hint_review")
                : t("newtask.assignee_hint_self")
          }
        >
          {(id) =>
            canAssignOthers ? (
              <UserSelect
                id={id}
                refData={refData}
                value={effectiveAssignee}
                onChange={setAssigneeId}
                preferDepartmentId={effectiveDeptId}
                placeholder={t("common.unassigned")}
              />
            ) : (
              <select id={id} className={selectCls} value={effectiveAssignee} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">{t("common.unassigned")}</option>
                <option value={me.id}>{t("newtask.me", { name: me.full_name })}</option>
              </select>
            )
          }
        </Field>
        <Field label={t("form.due_tz", { tz: tzAbbreviation(tz) })} hint={t("newtask.due_hint")} className="sm:col-span-2">
          {(id) => (
            <input id={id} type="datetime-local" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} />
          )}
        </Field>
      </form>
    </Modal>
  );
}
