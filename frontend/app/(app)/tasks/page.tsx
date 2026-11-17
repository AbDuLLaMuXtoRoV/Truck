"use client";

import { Bookmark, BookmarkPlus, Ellipsis, ExternalLink, LayoutList, ListTodo, Plus, Search, SquareKanban, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar, AvatarGroup } from "@/components/avatars";
import { PriorityBadge, SourceBadge, StatusWithOverdue, TruckChip, statusDot } from "@/components/badges";
import { DueChip } from "@/components/due";
import { NewTaskDialog } from "@/components/NewTaskDialog";
import { MultiSelect, TruckSelect, UserSelect } from "@/components/pickers";
import { useToast } from "@/components/toast";
import { TransitionBar } from "@/components/TransitionBar";
import {
  Button,
  Dropdown,
  Empty,
  ErrorBanner,
  IconButton,
  MenuItem,
  Modal,
  PageHeader,
  Skeleton,
  SkeletonTable,
  cx,
  focusRing,
  inputCls,
  selectBase,
} from "@/components/ui";
import { api, buildQuery, errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { isoToZonedInput, reasonRequired, sortTransitions, transitionKey, useFmt } from "@/lib/format";
import { invalidateCache, useApi, useDebounced, useNow, type UseApiResult } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import { useReference } from "@/lib/reference";
import {
  PRIORITIES,
  TASK_CATEGORIES,
  TASK_SORTS,
  TASK_SOURCES,
  TASK_STATUSES,
  type Priority,
  type TaskCategory,
  type TaskDetailOut,
  type TaskListOut,
  type TaskListQuery,
  type TaskOut,
  type TaskSort,
  type TaskSource,
  type TaskStatus,
} from "@/lib/types";

const PAGE_SIZE = 50;
const UNROUTED = "__unrouted";
const SAVED_KEY = "smart-truck.saved-views";

const SORT_KEY: Record<TaskSort, Key> = {
  created_desc: "sort.created_desc",
  created_asc: "sort.created_asc",
  due_asc: "sort.due_asc",
  priority: "sort.priority",
  updated_desc: "sort.updated_desc",
};

interface Filters {
  status: TaskStatus[];
  open: "" | "true" | "false";
  overdue: boolean;
  category: TaskCategory[];
  priority: Priority[];
  department_id: string;
  unrouted: boolean;
  truck_id: string;
  group_id: string;
  assignee_id: string;
  mine: boolean;
  source: TaskSource | "";
  q: string;
  sort: TaskSort;
  page: number;
}

type View = "table" | "board";

function pick<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function parseFilters(sp: URLSearchParams): Filters {
  const open = sp.get("open");
  const sort = sp.get("sort") ?? "";
  const source = sp.get("source") ?? "";
  const unrouted = sp.get("unrouted") === "true";
  return {
    status: pick(sp.getAll("status"), TASK_STATUSES),
    open: open === "true" || open === "false" ? open : "",
    overdue: sp.get("overdue") === "true",
    category: pick(sp.getAll("category"), TASK_CATEGORIES),
    priority: pick(sp.getAll("priority"), PRIORITIES),
    department_id: unrouted ? "" : (sp.get("department_id") ?? ""),
    unrouted,
    truck_id: sp.get("truck_id") ?? "",
    group_id: sp.get("group_id") ?? "",
    assignee_id: sp.get("assignee_id") ?? "",
    mine: sp.get("mine") === "true",
    source: (TASK_SOURCES as readonly string[]).includes(source) ? (source as TaskSource) : "",
    q: sp.get("q") ?? "",
    sort: (TASK_SORTS as readonly string[]).includes(sort) ? (sort as TaskSort) : "created_desc",
    page: Math.max(0, Number(sp.get("page")) || 0),
  };
}

function toQuery(f: Filters): TaskListQuery {
  return {
    status: f.status.length ? f.status : undefined,
    open: f.open === "" ? undefined : f.open === "true",
    overdue: f.overdue || undefined,
    category: f.category.length ? f.category : undefined,
    priority: f.priority.length ? f.priority : undefined,
    department_id: f.department_id || undefined,
    unrouted: f.unrouted || undefined,
    truck_id: f.truck_id || undefined,
    group_id: f.group_id || undefined,
    assignee_id: f.assignee_id || undefined,
    mine: f.mine || undefined,
    source: f.source || undefined,
    q: f.q.trim() || undefined,
    sort: f.sort,
    limit: PAGE_SIZE,
    offset: f.page * PAGE_SIZE,
  };
}

/** URL form of the filters: same names as the API query params, defaults omitted. */
function toSearch(f: Filters, view: View = "table"): string {
  const { limit: _limit, offset: _offset, ...q } = toQuery(f);
  void _limit;
  void _offset;
  return buildQuery({ ...q, sort: f.sort === "created_desc" ? undefined : f.sort, page: f.page || undefined, view: view === "board" ? "board" : undefined });
}

function activeFilterCount(f: Filters): number {
  return (
    f.status.length +
    f.category.length +
    f.priority.length +
    [f.open, f.department_id, f.truck_id, f.group_id, f.assignee_id, f.source, f.q.trim()].filter(Boolean).length +
    (f.unrouted ? 1 : 0) +
    (f.overdue ? 1 : 0) +
    (f.mine ? 1 : 0)
  );
}

// --------------------------------------------------------------------------- saved views

interface SavedView {
  name: string;
  search: string;
}

const PRESETS: { key: Key; search: string }[] = [
  { key: "views.open", search: "?open=true" },
  { key: "views.mine", search: "?open=true&mine=true" },
  { key: "views.overdue", search: "?overdue=true&sort=due_asc" },
  { key: "views.p1", search: "?priority=P1&open=true" },
  { key: "views.review", search: "?status=detected&status=needs_review&sort=created_asc" },
  { key: "views.verification", search: "?status=pending_verification" },
];

function canonical(search: string): string {
  const f = parseFilters(new URLSearchParams(search));
  return toSearch({ ...f, page: 0 });
}

function loadSaved(): SavedView[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && typeof x.search === "string") : [];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------- page

export default function TasksPage() {
  return (
    <Suspense fallback={<SkeletonTable />}>
      <TasksScreen />
    </Suspense>
  );
}

function TasksScreen() {
  const router = useRouter();
  const sp = useSearchParams();
  const filters = parseFilters(new URLSearchParams(sp.toString()));
  const view: View = sp.get("view") === "board" ? "board" : "table";
  const wantNew = sp.get("new") === "1";
  const { can } = useMe();
  const f = useFmt();
  const { t, tp } = f;
  const refData = useReference();
  const toast = useToast();
  const [creating, setCreating] = useState(wantNew);
  const [seenNew, setSeenNew] = useState(wantNew);
  if (wantNew !== seenNew) {
    setSeenNew(wantNew);
    if (wantNew) setCreating(true);
  }
  const [moreFilters, setMoreFilters] = useState(false);

  const setFilters = (patch: Partial<Filters>, nextView: View = view) => {
    const next = { ...filters, ...patch, page: patch.page ?? 0 };
    router.replace(`/tasks${toSearch(next, nextView)}`, { scroll: false });
  };

  // search box: local state, pushed to the URL after a short pause
  const [q, setQ] = useState(filters.q);
  const dq = useDebounced(q, 300);
  const [lastUrlQ, setLastUrlQ] = useState(filters.q);
  if (filters.q !== lastUrlQ) {
    setLastUrlQ(filters.q);
    // URL changed from outside (back button, "clear filters"): adopt it. A change we pushed
    // ourselves equals the debounced text and must not overwrite newer keystrokes.
    if (filters.q !== dq) setQ(filters.q);
  }
  useEffect(() => {
    if (dq !== filters.q) setFilters({ q: dq });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [dq]);

  const list = useApi<TaskListOut>(view === "table" ? paths.tasks(toQuery(filters)) : null);
  const data = list.data;
  const total = data?.total ?? 0;
  const nFilters = activeFilterCount(filters);
  const nSecondary =
    filters.category.length +
    (filters.unrouted ? 1 : 0) +
    [filters.department_id, filters.truck_id, filters.assignee_id, filters.source, filters.group_id].filter(Boolean).length;
  const truckName = filters.truck_id ? refData.truckById.get(filters.truck_id)?.unit_number : undefined;
  const deptValue = filters.unrouted ? UNROUTED : filters.department_id;

  const closeNew = () => {
    setCreating(false);
    if (wantNew) router.replace(`/tasks${toSearch(filters, view)}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        icon={<ListTodo />}
        title={truckName ? t("tasks.title_truck", { unit: truckName }) : t("tasks.title")}
        subtitle={view === "table" ? (data ? tp("tasks.match", total) : " ") : t("board.subtitle")}
        actions={
          <>
            <div className="inline-flex h-9 rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label={t("board.view")}>
              {(
                [
                  ["table", <LayoutList key="t" />, "board.table"],
                  ["board", <SquareKanban key="b" />, "board.board"],
                ] as const
              ).map(([v, icon, key]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setFilters({}, v)}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors [&_svg]:size-4",
                    focusRing,
                    view === v ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg",
                  )}
                >
                  {icon}
                  {t(key)}
                </button>
              ))}
            </div>
            {can("tasks.create") ? (
              <Button variant="primary" size="md" onClick={() => setCreating(true)}>
                <Plus />
                {t("tasks.new")}
              </Button>
            ) : null}
          </>
        }
      />

      <SavedViews current={toSearch({ ...filters, page: 0 })} onApply={(search) => router.replace(`/tasks${search === "" ? "" : search}${view === "board" ? `${search ? "&" : "?"}view=board` : ""}`, { scroll: false })} />

      {/* filters: one row above the content they scope */}
      <div className="mb-4 rounded-xl border border-line bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
            <input
              type="search"
              className={cx(inputCls, "pl-8")}
              placeholder={t("tasks.search_placeholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label={t("tasks.search_label")}
            />
          </div>
          {view === "table" ? (
            <div className="inline-flex h-8 rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="group" aria-label={t("filter.open_closed")}>
              {(
                [
                  ["", "filter.all"],
                  ["true", "filter.open"],
                  ["false", "filter.closed"],
                ] as const
              ).map(([v, key]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={filters.open === v}
                  onClick={() => setFilters({ open: v })}
                  className={cx("rounded-md px-2.5 transition-colors", focusRing, filters.open === v ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg")}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          ) : null}
          {view === "table" ? (
            <MultiSelect label={t("filter.status")} options={TASK_STATUSES} value={filters.status} onChange={(status) => setFilters({ status })} renderOption={(s) => f.status(s)} />
          ) : null}
          <div className="inline-flex gap-1" role="group" aria-label={t("filter.priority")}>
            {PRIORITIES.map((p) => {
              const on = filters.priority.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  title={f.priority(p)}
                  onClick={() => setFilters({ priority: on ? filters.priority.filter((x) => x !== p) : [...filters.priority, p] })}
                  className={cx(
                    "h-8 rounded-lg border px-2.5 text-xs font-semibold tabular-nums transition-colors",
                    focusRing,
                    on ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-surface text-fg-2 hover:border-line-strong",
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>
          <Chip checked={filters.overdue} onChange={(v) => setFilters({ overdue: v })} danger>
            {t("filter.overdue")}
          </Chip>
          <Chip checked={filters.mine} onChange={(v) => setFilters({ mine: v })}>
            {t("filter.mine")}
          </Chip>
          <Button size="sm" variant="ghost" className="sm:hidden" aria-expanded={moreFilters} onClick={() => setMoreFilters((m) => !m)}>
            {moreFilters ? t("filter.fewer") : nSecondary ? t("filter.more_n", { n: nSecondary }) : t("filter.more")}
          </Button>
        </div>
        <div className={cx("mt-2 flex-wrap items-center gap-2", moreFilters ? "flex" : "hidden sm:flex")}>
          <MultiSelect label={t("filter.category")} options={TASK_CATEGORIES} value={filters.category} onChange={(category) => setFilters({ category })} renderOption={(c) => f.category(c)} />
          <select
            className={cx(selectBase, "h-8 w-auto min-w-40", deptValue && "border-accent bg-accent-soft")}
            value={deptValue}
            onChange={(e) => setFilters(e.target.value === UNROUTED ? { unrouted: true, department_id: "" } : { unrouted: false, department_id: e.target.value })}
            aria-label={t("filter.department")}
          >
            <option value="">{t("filter.all_departments")}</option>
            <option value={UNROUTED}>{t("dept.unrouted")}</option>
            {refData.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <TruckSelect
            refData={refData}
            value={filters.truck_id}
            onChange={(truck_id) => setFilters({ truck_id })}
            emptyLabel={t("filter.all_trucks")}
            className={cx("h-8 w-auto min-w-32", filters.truck_id && "border-accent bg-accent-soft")}
          />
          <UserSelect
            refData={refData}
            value={filters.assignee_id}
            onChange={(assignee_id) => setFilters({ assignee_id })}
            placeholder={t("filter.any_assignee")}
            className={cx("h-8 w-auto min-w-40", filters.assignee_id && "border-accent bg-accent-soft")}
          />
          <select
            className={cx(selectBase, "h-8 w-auto min-w-32", filters.source && "border-accent bg-accent-soft")}
            value={filters.source}
            onChange={(e) => setFilters({ source: e.target.value as TaskSource | "" })}
            aria-label={t("filter.source")}
          >
            <option value="">{t("filter.any_source")}</option>
            {TASK_SOURCES.map((s) => (
              <option key={s} value={s}>
                {f.source(s)}
              </option>
            ))}
          </select>
          {view === "table" ? (
            <select className={cx(selectBase, "h-8 w-auto min-w-40")} value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as TaskSort })} aria-label={t("filter.sort")}>
              {TASK_SORTS.map((s) => (
                <option key={s} value={s}>
                  {t("filter.sort_option", { label: t(SORT_KEY[s]) })}
                </option>
              ))}
            </select>
          ) : null}
          {filters.group_id ? (
            <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-accent-soft px-2.5 text-xs font-medium text-accent-text">
              {t("filter.group_chip")}
              <button type="button" onClick={() => setFilters({ group_id: "" })} aria-label={t("filter.remove_group")} className="rounded p-0.5 hover:bg-accent/15">
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
          {nFilters ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setQ("");
                router.replace(view === "board" ? "/tasks?view=board" : "/tasks", { scroll: false });
              }}
            >
              <X />
              {t("filter.clear_n", { n: nFilters })}
            </Button>
          ) : null}
        </div>
      </div>

      {view === "table" ? (
        <TaskTable list={list} filters={filters} nFilters={nFilters} onPage={(page) => setFilters({ page })} onCreate={can("tasks.create") ? () => setCreating(true) : undefined} />
      ) : (
        <Board filters={filters} />
      )}

      {can("tasks.create") ? (
        <NewTaskDialog
          open={creating}
          onClose={closeNew}
          refData={refData}
          onCreated={(task) => {
            closeNew();
            invalidateCache("/api/tasks");
            invalidateCache("/api/dashboard");
            toast(t("toast.task_created", { code: task.code }), { href: `/tasks/${task.id}` });
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function Chip({ checked, onChange, children, danger }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors",
        focusRing,
        checked
          ? danger
            ? "border-danger/40 bg-danger-soft text-danger-text"
            : "border-accent bg-accent-soft text-accent-text"
          : "border-line bg-surface text-fg-2 hover:border-line-strong",
      )}
    >
      <span className={cx("size-1.5 rounded-full", checked ? (danger ? "bg-danger" : "bg-accent") : "bg-fg-4")} aria-hidden />
      {children}
    </button>
  );
}

// --------------------------------------------------------------------------- saved views

function SavedViews({ current, onApply }: { current: string; onApply: (search: string) => void }) {
  const { t } = useFmt();
  const [saved, setSaved] = useState<SavedView[]>(loadSaved);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function persist(next: SavedView[]) {
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* not persisted */
    }
  }

  const canSave = current !== "" && !saved.some((v) => canonical(v.search) === current) && !PRESETS.some((p) => canonical(p.search) === current);
  const chip = (activeChip: boolean) =>
    cx(
      "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
      focusRing,
      activeChip ? "border-accent bg-accent text-white shadow-xs" : "border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg",
    );

  return (
    <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label={t("views.label")}>
      {PRESETS.map((p) => {
        const on = canonical(p.search) === current;
        return (
          <button key={p.key} type="button" className={chip(on)} aria-pressed={on} onClick={() => onApply(on ? "" : canonical(p.search))}>
            {t(p.key)}
          </button>
        );
      })}
      {saved.map((v) => {
        const on = canonical(v.search) === current;
        return (
          <span key={v.name} className={cx(chip(on), "pr-1")}>
            <button type="button" className="inline-flex items-center gap-1" onClick={() => onApply(on ? "" : canonical(v.search))} aria-pressed={on}>
              <Bookmark className="size-3" aria-hidden />
              {v.name}
            </button>
            <button
              type="button"
              aria-label={t("views.remove", { name: v.name })}
              onClick={() => persist(saved.filter((x) => x.name !== v.name))}
              className={cx("rounded-full p-0.5", on ? "hover:bg-white/20" : "hover:bg-surface-3")}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      {naming ? (
        <form
          className="flex shrink-0 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            persist([...saved.filter((v) => v.name !== n), { name: n, search: current }]);
            setName("");
            setNaming(false);
          }}
        >
          <input autoFocus className={cx(inputCls, "h-7 w-40 py-0 text-xs")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("views.name_placeholder")} aria-label={t("views.name_placeholder")} maxLength={40} />
          <Button size="xs" type="submit" variant="primary" disabled={!name.trim()}>
            {t("common.save")}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setNaming(false)}>
            {t("common.cancel")}
          </Button>
        </form>
      ) : canSave ? (
        <button type="button" className={cx(chip(false), "border-dashed")} onClick={() => setNaming(true)}>
          <BookmarkPlus className="size-3.5" aria-hidden />
          {t("views.save")}
        </button>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- table

function TaskTable({
  list,
  filters,
  nFilters,
  onPage,
  onCreate,
}: {
  list: UseApiResult<TaskListOut>;
  filters: Filters;
  nFilters: number;
  onPage: (page: number) => void;
  onCreate?: () => void;
}) {
  const router = useRouter();
  const f = useFmt();
  const { t } = f;
  const now = useNow();
  const data = list.data;
  const total = data?.total ?? 0;
  const from = total ? filters.page * PAGE_SIZE + 1 : 0;
  const to = Math.min(total, (filters.page + 1) * PAGE_SIZE);

  return (
    <>
      <ErrorBanner error={list.error} onRetry={list.reload} className="mb-3" />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className={cx("relative max-h-[calc(100vh-17rem)] min-h-64 overflow-auto transition-opacity", list.loading && data && "opacity-60")}>
          <table className="w-full min-w-[980px] text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface-2/95 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-3 backdrop-blur">
              <tr className="[&>th]:border-b [&>th]:border-line [&>th]:px-2.5 [&>th]:py-2.5">
                <th>{t("col.code")}</th>
                <th>{t("col.title")}</th>
                <th>{t("col.truck")}</th>
                <th>{t("col.department")}</th>
                <th>{t("col.priority")}</th>
                <th>{t("col.status")}</th>
                <th>{t("col.assignee")}</th>
                <th>{t("col.due")}</th>
                <th>{t("col.source")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((task) => {
                const title = f.title(task);
                return (
                  <tr
                    key={task.id}
                    className="group cursor-pointer transition-colors hover:bg-surface-2"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a")) return;
                      router.push(`/tasks/${task.id}`);
                    }}
                  >
                    <td className="whitespace-nowrap px-2.5 py-2.5 font-mono text-xs font-medium text-fg-3">
                      <Link href={`/tasks/${task.id}`} className="hover:text-accent-text hover:underline">
                        {task.code}
                      </Link>
                    </td>
                    <td className="max-w-[14rem] px-2.5 py-2.5">
                      <Link href={`/tasks/${task.id}`} className="block truncate font-medium text-fg group-hover:text-accent-text" title={title}>
                        {title}
                      </Link>
                      <span className="block truncate text-xs text-fg-3">
                        {f.category(task.category)}
                        {task.group ? ` · ${task.group.title}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5">
                      {task.truck ? (
                        <TruckChip unit={task.truck.unit_number} />
                      ) : task.truck_unit_raw ? (
                        <TruckChip unit={task.truck_unit_raw} unmatched title={t("tasks.truck_unmatched")} />
                      ) : (
                        <span className="text-fg-4">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5 text-fg-2">{task.department?.name ?? <span className="italic text-fg-4">{t("dept.unrouted")}</span>}</td>
                    <td className="px-2.5 py-2.5">
                      <PriorityBadge priority={task.priority} />
                    </td>
                    <td className="px-2.5 py-2.5">
                      <StatusWithOverdue status={task.status} overdue={task.is_overdue} />
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5">
                      {task.assignee ? (
                        <span className="inline-flex items-center gap-2">
                          <Avatar name={task.assignee.full_name} size="sm" />
                          <span className="max-w-24 truncate text-fg-2">{task.assignee.full_name}</span>
                        </span>
                      ) : (
                        <span className="text-fg-4">{t("common.unassigned")}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2.5">
                      <DueChip createdAt={task.created_at} dueAt={task.due_at} status={task.status} now={now} />
                    </td>
                    <td className="px-2.5 py-2.5">
                      <SourceBadge source={task.source} iconOnly />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data && list.loading ? <SkeletonTable cols={7} /> : null}
          {data && data.items.length === 0 ? (
            <Empty
              illustration={nFilters ? "search" : "inbox"}
              title={nFilters ? t("tasks.empty_filtered") : t("tasks.empty")}
              action={
                !nFilters && onCreate ? (
                  <Button variant="primary" onClick={onCreate}>
                    <Plus />
                    {t("tasks.new")}
                  </Button>
                ) : undefined
              }
            >
              {nFilters ? t("tasks.empty_filtered_hint") : t("tasks.empty_hint")}
            </Empty>
          ) : null}
        </div>
        {data && total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-xs text-fg-3">
            <span className="tabular-nums">{t("tasks.range", { from: f.count(from), to: f.count(to), total: f.count(total) })}</span>
            <span className="flex gap-2">
              <Button size="xs" disabled={filters.page === 0} onClick={() => onPage(filters.page - 1)}>
                {t("common.previous")}
              </Button>
              <Button size="xs" disabled={to >= total} onClick={() => onPage(filters.page + 1)}>
                {t("common.next")}
              </Button>
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

// --------------------------------------------------------------------------- board

interface Column {
  id: string;
  label: Key;
  status: TaskStatus[];
  sort: TaskSort;
  dot: string;
  doneToday?: boolean;
}

const COLUMNS: Column[] = [
  { id: "review", label: "board.col_review", status: ["detected", "needs_review"], sort: "created_asc", dot: statusDot("needs_review") },
  { id: "assigned", label: "board.col_assigned", status: ["assigned"], sort: "priority", dot: statusDot("assigned") },
  { id: "in_progress", label: "board.col_in_progress", status: ["in_progress"], sort: "priority", dot: statusDot("in_progress") },
  { id: "blocked", label: "board.col_blocked", status: ["blocked"], sort: "priority", dot: statusDot("blocked") },
  { id: "verification", label: "board.col_verification", status: ["pending_verification"], sort: "updated_desc", dot: statusDot("pending_verification") },
  { id: "done", label: "board.col_done", status: ["completed"], sort: "updated_desc", dot: statusDot("completed"), doneToday: true },
];

function Board({ filters }: { filters: Filters }) {
  const [version, setVersion] = useState(0);
  const refresh = () => {
    invalidateCache("/api/dashboard");
    setVersion((v) => v + 1);
  };
  return (
    <div className="-mx-3 overflow-x-auto px-3 pb-3 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-3">
        {COLUMNS.map((c) => (
          <BoardColumn key={c.id} column={c} filters={filters} version={version} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({ column, filters, version, onChanged }: { column: Column; filters: Filters; version: number; onChanged: () => void }) {
  const f = useFmt();
  const { t, tz } = f;
  const now = useNow();
  const { status: _s, open: _o, sort: _sort, limit: _l, offset: _off, ...rest } = toQuery(filters);
  void _s;
  void _o;
  void _sort;
  void _l;
  void _off;
  const path = `${paths.tasks({ ...rest, status: column.status, sort: column.sort, limit: 50 })}&_v=${version}`;
  const res = useApi<TaskListOut>(path);
  const today = isoToZonedInput(new Date(now).toISOString(), tz).slice(0, 10);
  const items = useMemo(
    () =>
      (res.data?.items ?? []).filter((x) => !column.doneToday || (x.completed_at && isoToZonedInput(x.completed_at, tz).slice(0, 10) === today)),
    [res.data, column.doneToday, tz, today],
  );
  const count = column.doneToday ? items.length : (res.data?.total ?? 0);
  const assignees = items.map((x) => x.assignee?.full_name).filter((n): n is string => !!n);

  return (
    <section className="flex w-[17.5rem] shrink-0 flex-col rounded-xl border border-line bg-surface-2/70" aria-label={t(column.label)}>
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className={cx("size-2 rounded-full", column.dot)} aria-hidden />
        <h2 className="truncate text-sm font-semibold text-fg">{t(column.label)}</h2>
        <span className="rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold tabular-nums text-fg-2">{res.data ? count : "·"}</span>
        <span className="ml-auto">{assignees.length ? <AvatarGroup names={assignees} max={3} size="xs" /> : null}</span>
      </header>
      <div className={cx("flex max-h-[calc(100vh-19rem)] min-h-40 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-opacity", res.loading && res.data && "opacity-70")}>
        {res.error && !res.data ? <ErrorBanner error={res.error} onRetry={res.reload} /> : null}
        {!res.data && res.loading
          ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
          : null}
        {res.data && items.length === 0 ? <p className="px-2 py-6 text-center text-xs text-fg-4">{t("board.empty")}</p> : null}
        {items.map((task) => (
          <BoardCard key={task.id} task={task} now={now} onChanged={onChanged} />
        ))}
        {!column.doneToday && res.data && res.data.total > items.length ? (
          <p className="px-2 py-1 text-center text-[11px] text-fg-4">{t("board.more", { n: res.data.total - items.length })}</p>
        ) : null}
      </div>
    </section>
  );
}

function BoardCard({ task, now, onChanged }: { task: TaskOut; now: number; onChanged: () => void }) {
  const f = useFmt();
  const { t } = f;
  const router = useRouter();
  const toast = useToast();
  const refData = useReference();
  const [detail, setDetail] = useState<TaskDetailOut | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [formFor, setFormFor] = useState<TaskStatus | null>(null);
  const title = f.title(task);

  function loadDetail() {
    if (detail) return;
    setLoadError(null);
    api.getTask(task.id).then(setDetail).catch(setLoadError);
  }

  async function quick(to: TaskStatus) {
    try {
      await api.transition(task.id, { to_status: to });
      toast(t("board.moved", { code: task.code, status: f.status(to) }));
      onChanged();
    } catch (err) {
      toast(errorMessage(err), { kind: "error" });
    }
  }

  return (
    <article className="group relative rounded-lg border border-line bg-surface p-3 shadow-xs transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-card">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] font-medium text-fg-3">{task.code}</span>
        <PriorityBadge priority={task.priority} />
        {task.is_overdue ? <span className="size-1.5 rounded-full bg-danger" title={t("badge.overdue")} aria-label={t("badge.overdue")} /> : null}
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          <Dropdown
            label={t("board.actions")}
            panelClassName="w-60"
            trigger={({ toggle, open }) => (
              <IconButton
                label={t("board.actions")}
                className="size-6 opacity-60 group-hover:opacity-100 [&_svg]:size-4"
                active={open}
                onClick={() => {
                  loadDetail();
                  toggle();
                }}
              >
                <Ellipsis />
              </IconButton>
            )}
          >
            {(close) => (
              <div>
                <MenuItem
                  icon={<ExternalLink />}
                  onClick={() => {
                    close();
                    router.push(`/tasks/${task.id}`);
                  }}
                >
                  {t("board.open")}
                </MenuItem>
                <div className="my-1 h-px bg-line" />
                {loadError ? <p className="px-2.5 py-1.5 text-xs text-danger-text">{errorMessage(loadError)}</p> : null}
                {!detail && !loadError ? (
                  <div className="space-y-1.5 p-1.5">
                    <Skeleton className="h-6" />
                    <Skeleton className="h-6" />
                  </div>
                ) : null}
                {detail && detail.allowed_transitions.length === 0 ? <p className="px-2.5 py-1.5 text-xs text-fg-3">{t("board.no_actions")}</p> : null}
                {detail
                  ? sortTransitions(detail.status, detail.allowed_transitions).map((to) => (
                      <MenuItem
                        key={to}
                        danger={to === "cancelled"}
                        icon={<span className={cx("block size-2 rounded-full", statusDot(to))} />}
                        onClick={() => {
                          close();
                          if (reasonRequired(detail.status, to) || to === "assigned") setFormFor(to);
                          else void quick(to);
                        }}
                      >
                        {t(transitionKey(detail.status, to))}
                      </MenuItem>
                    ))
                  : null}
              </div>
            )}
          </Dropdown>
        </span>
      </div>
      <Link href={`/tasks/${task.id}`} className="mt-1.5 line-clamp-2 block text-[13px] font-medium leading-snug text-fg hover:text-accent-text" title={title}>
        {title}
      </Link>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {task.truck ? <TruckChip unit={task.truck.unit_number} /> : task.truck_unit_raw ? <TruckChip unit={task.truck_unit_raw} unmatched /> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {task.status !== "completed" ? <DueChip createdAt={task.created_at} dueAt={task.due_at} status={task.status} now={now} /> : null}
          {task.assignee ? <Avatar name={task.assignee.full_name} size="sm" /> : null}
        </span>
      </div>
      {formFor && detail ? (
        <Modal open title={`${task.code} · ${t(transitionKey(detail.status, formFor))}`} onClose={() => setFormFor(null)}>
          <TransitionBar
            task={detail}
            refData={refData}
            initial={formFor}
            onChanged={(next) => {
              setFormFor(null);
              setDetail(next);
              toast(t("board.moved", { code: task.code, status: f.status(next.status) }));
              onChanged();
            }}
          />
        </Modal>
      ) : null}
    </article>
  );
}
