"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { EmptyNote, Intro } from "@/components/simple/Homes";
import { TaskCard } from "@/components/simple/TaskCard";
import { usePageTitle } from "@/components/simple/tips";
import { Skeleton } from "@/components/ui";
import { errorMessage, paths } from "@/lib/api";
import { isoToZonedInput, useFmt } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import { useReference } from "@/lib/reference";
import type { TaskListOut, TaskListQuery } from "@/lib/types";

interface Kind {
  title: Key;
  intro: Key;
  empty: Key;
  query: TaskListQuery;
  /** keep only tasks completed today (company time zone) */
  today?: boolean;
}

const KINDS: Record<string, Kind> = {
  new: { title: "s.list_new", intro: "s.list_new_intro", empty: "s.empty_new_text", query: { status: ["detected", "needs_review"], sort: "created_desc" } },
  doing: { title: "s.list_doing", intro: "s.list_doing_intro", empty: "s.empty_team_text", query: { status: ["assigned", "in_progress", "blocked"], sort: "due_asc" } },
  check: { title: "s.list_check", intro: "s.list_check_intro", empty: "s.empty_check_text", query: { status: ["pending_verification"], sort: "updated_desc" } },
  late: { title: "s.list_late", intro: "s.list_late_intro", empty: "s.empty_late_text", query: { overdue: true, sort: "due_asc" } },
  done: { title: "s.list_done", intro: "s.list_done_intro", empty: "s.done_today_empty", query: { status: ["completed"], sort: "updated_desc" }, today: true },
  my_done: { title: "s.list_my_done", intro: "s.list_my_done_intro", empty: "s.list_my_done_empty", query: { mine: true, status: ["completed"], sort: "updated_desc" } },
};

function TaskList() {
  const kindId = useSearchParams().get("kind") ?? "new";
  const kind = KINDS[kindId] ?? KINDS.new;
  const f = useFmt();
  const { t } = f;
  const refData = useReference();
  const now = useNow(60000);
  usePageTitle(t(kind.title));
  const res = useApi<TaskListOut>(paths.tasks({ ...kind.query, limit: 100 }), { refreshMs: 60000 });
  const today = isoToZonedInput(new Date(now).toISOString(), f.tz).slice(0, 10);
  const items = (res.stale ? [] : (res.data?.items ?? [])).filter(
    (x) => !kind.today || (!!x.completed_at && isoToZonedInput(x.completed_at, f.tz).slice(0, 10) === today),
  );

  return (
    <div className="space-y-5">
      <Intro text={t(kind.intro)} />
      {res.error && !res.data ? <p className="rounded-xl bg-danger-soft px-4 py-3 text-base text-danger-text">{errorMessage(res.error)}</p> : null}
      {(!res.data || res.stale) && res.loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-2xl" />
          ))}
        </div>
      ) : null}
      {res.data && !res.stale && items.length === 0 ? <EmptyNote title={t("s.empty_list_title")} text={t(kind.empty)} /> : null}
      <div className="space-y-3">
        {items.map((x) => (
          <TaskCard key={x.id} task={x} refData={refData} onChanged={res.reload} />
        ))}
      </div>
    </div>
  );
}

/** One plain list behind each home tile / menu item: /list?kind=new|doing|check|late|done|my_done. */
export default function ListPage() {
  return (
    <Suspense fallback={null}>
      <TaskList />
    </Suspense>
  );
}
