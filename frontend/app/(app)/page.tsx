"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { TelegramBanner } from "@/components/TelegramBanner";
import { Card, Empty, ErrorBox, Loading, PageTitle, STAGE_STATUSES, Tag, cx, taskTitle, timeAgo } from "@/components/ui";
import { paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useApi, useNow } from "@/lib/hooks";
import { useT, type Key } from "@/lib/i18n";
import type { TaskListOut, TaskOut } from "@/lib/types";

type Tab = keyof typeof STAGE_STATUSES;
const TABS: { id: Tab; label: Key; dot: string }[] = [
  { id: "new", label: "stage.new", dot: "bg-blue-500" },
  { id: "doing", label: "stage.doing", dot: "bg-yellow-500" },
  { id: "check", label: "stage.check", dot: "bg-purple-500" },
  { id: "done", label: "stage.done", dot: "bg-green-500" },
];
const LIMIT = 100;

function isTab(v: string | null): v is Tab {
  return v === "new" || v === "doing" || v === "check" || v === "done";
}

function useTab(tab: Tab, mine: boolean) {
  return useApi<TaskListOut>(
    paths.tasks({
      status: STAGE_STATUSES[tab],
      mine: mine || undefined,
      sort: tab === "done" ? "updated_desc" : "created_desc",
      limit: tab === "done" ? 50 : LIMIT,
    }),
    { refreshMs: 30000 },
  );
}

function Row({ task }: { task: TaskOut }) {
  const { t, lang, locale } = useT();
  const now = useNow(60000);
  const details = [
    task.truck ? `#${task.truck.unit_number}` : task.truck_unit_raw ? `#${task.truck_unit_raw}` : null,
    task.department?.name,
    task.assignee?.full_name ?? (task.status === "detected" || task.status === "needs_review" ? null : t("common.nobody")),
    timeAgo(task.created_at, locale, now),
  ].filter(Boolean);
  return (
    <li>
      <Link href={`/tasks/${task.id}`} className="block px-4 py-3 text-gray-900 no-underline hover:bg-gray-50">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{taskTitle(task, lang)}</span>
          {task.priority === "P1" && <Tag color="red">{t("issues.urgent")}</Tag>}
          {task.is_overdue && <Tag color="red">{t("issues.late")}</Tag>}
          {task.status === "blocked" && <Tag color="yellow">{t("stage.waiting")}</Tag>}
        </div>
        <p className="mt-0.5 text-sm text-gray-500">{details.join(" · ")}</p>
      </Link>
    </li>
  );
}

function Issues() {
  const { me } = useMe();
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "new";
  const [mine, setMine] = useState(me.role === "agent");

  // one request per tab so every tab shows its count and switching is instant
  const lists: Record<Tab, ReturnType<typeof useTab>> = {
    new: useTab("new", mine),
    doing: useTab("doing", mine),
    check: useTab("check", mine),
    done: useTab("done", mine),
  };
  const current = lists[tab];
  const items = current.data?.items ?? [];

  return (
    <>
      <PageTitle title={t("issues.title")} subtitle={t("issues.subtitle")} />
      <TelegramBanner />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" className="flex flex-wrap gap-2">
          {TABS.map((it) => {
            const active = it.id === tab;
            const total = lists[it.id].data?.total;
            return (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => router.replace(it.id === "new" ? "/" : `/?tab=${it.id}`, { scroll: false })}
                className={cx(
                  "flex items-center gap-2 rounded-lg border px-4 py-2 font-medium",
                  active ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50",
                )}
              >
                <span className={cx("size-2.5 rounded-full", active ? "bg-white" : it.dot)} aria-hidden />
                {t(it.label)}
                {total !== undefined && <span className={active ? "text-blue-100" : "text-gray-500"}>{total}</span>}
              </button>
            );
          })}
        </div>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-gray-700">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-5 accent-blue-600" />
          {t("issues.only_mine")}
        </label>
      </div>

      <ErrorBox error={current.error} onRetry={current.reload} retryLabel={t("common.retry")} />
      {!current.data && !current.error ? (
        <Loading text={t("common.loading")} />
      ) : current.data && items.length === 0 ? (
        <Empty text={t("issues.empty")} />
      ) : (
        items.length > 0 && (
          <Card>
            <ul className="divide-y divide-gray-100">
              {items.map((task) => (
                <Row key={task.id} task={task} />
              ))}
            </ul>
          </Card>
        )
      )}
      {current.data && current.data.total > items.length && (
        <p className="mt-3 text-center text-sm text-gray-500">{t("issues.more", { n: items.length })}</p>
      )}
    </>
  );
}

export default function IssuesPage() {
  return (
    <Suspense fallback={null}>
      <Issues />
    </Suspense>
  );
}
