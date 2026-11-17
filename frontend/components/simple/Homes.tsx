"use client";

import { ArrowRight, BarChart3, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { isoToZonedInput, useFmt } from "@/lib/format";
import { useApi, useNow } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import { setMode } from "@/lib/mode";
import { useReference } from "@/lib/reference";
import { plainDue, stage } from "@/lib/stage";
import type { DashboardSummary, TaskListOut, TaskOut } from "@/lib/types";
import { Avatar } from "../avatars";
import { Skeleton, cx, focusRing } from "../ui";
import { TelegramBanner, WelcomeCard } from "./Onboarding";
import { HOME_TITLE, simpleRole } from "./SimpleShell";
import { TaskCard, truckLabel } from "./TaskCard";
import { usePageTitle } from "./tips";

// --------------------------------------------------------------------------- shared bits

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/** One greeting line + one plain sentence saying what the page is for. */
export function Intro({ greeting, text }: { greeting?: string; text: string }) {
  return (
    <div>
      {greeting ? <h2 className="text-2xl font-bold tracking-tight text-fg">{greeting}</h2> : null}
      <p className={cx("text-base text-fg-2", greeting && "mt-1")}>{text}</p>
    </div>
  );
}

export function Section({
  title,
  count,
  hint,
  children,
  more,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
  more?: { href: string; label: string };
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold text-fg">
          {title}
          {count !== undefined ? <span className="rounded-full bg-surface-3 px-2.5 py-0.5 text-sm font-bold tabular-nums text-fg-2">{count}</span> : null}
        </h3>
        {hint ? <p className="mt-0.5 text-[15px] text-fg-3">{hint}</p> : null}
      </div>
      {children}
      {more ? (
        <Link href={more.href} className={cx("inline-flex min-h-11 items-center gap-1 text-base font-semibold text-accent-text hover:underline", focusRing)}>
          {more.label}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}

/** An empty state that says why it is empty and what will appear here. */
export function EmptyNote({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-6 text-center">
      <p className="text-lg font-semibold text-fg">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[15px] text-fg-3">{text}</p>
    </div>
  );
}

function CardsSkeleton({ n = 2 }: { n?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-2xl" />
      ))}
    </div>
  );
}

function LoadError({ error }: { error: unknown }) {
  return <p className="rounded-xl bg-danger-soft px-4 py-3 text-base text-danger-text">{errorMessage(error)}</p>;
}

function useToday(): (iso: string | null) => boolean {
  const { tz } = useFmt();
  const now = useNow(60000);
  const today = isoToZonedInput(new Date(now).toISOString(), tz).slice(0, 10);
  return (iso) => !!iso && isoToZonedInput(iso, tz).slice(0, 10) === today;
}

/** Late first (most late on top), then by deadline; tasks without a deadline last. */
function lateFirst(a: TaskOut, b: TaskOut): number {
  if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
  const da = a.due_at ? Date.parse(a.due_at) : Infinity;
  const db = b.due_at ? Date.parse(b.due_at) : Infinity;
  return da - db;
}

// --------------------------------------------------------------------------- dispatcher

export function SimpleHome() {
  const { me } = useMe();
  const { t } = useFmt();
  const role = simpleRole(me.role);
  usePageTitle(t(HOME_TITLE[role]));
  if (role === "agent") return <AgentHome />;
  if (role === "lead") return <LeadHome />;
  return <ManagerHome readOnly={role === "viewer"} />;
}

// --------------------------------------------------------------------------- agent

function AgentHome() {
  const { me } = useMe();
  const { t } = useFmt();
  const refData = useReference();
  const isToday = useToday();
  const open = useApi<TaskListOut>(paths.tasks({ mine: true, open: true, sort: "due_asc", limit: 100 }), { refreshMs: 60000 });
  const done = useApi<TaskListOut>(paths.tasks({ mine: true, status: ["completed"], sort: "updated_desc", limit: 50 }), { refreshMs: 120000 });
  const reload = () => {
    open.reload();
    done.reload();
  };

  const items = open.data?.items ?? [];
  const doing = items.filter((x) => stage(x.status) === "doing" || stage(x.status) === "new").sort(lateFirst);
  const check = items.filter((x) => stage(x.status) === "check");
  const doneToday = (done.data?.items ?? []).filter((x) => isToday(x.completed_at));

  return (
    <div className="space-y-7">
      <Intro greeting={t("s.hello", { name: firstName(me.full_name) })} text={t("s.agent_intro")} />
      <WelcomeCard />
      <TelegramBanner />
      {open.error && !open.data ? <LoadError error={open.error} /> : null}
      {!open.data && open.loading ? <CardsSkeleton n={3} /> : null}
      {open.data && items.length === 0 ? <EmptyNote title={t("s.empty_agent_title")} text={t("s.empty_agent_text")} /> : null}
      {doing.length ? (
        <Section title={t("s.sec_doing")} count={doing.length} hint={t("s.sec_doing_hint")}>
          <div className="space-y-3">
            {doing.map((x, i) => (
              <TaskCard key={x.id} task={x} refData={refData} defaultOpen={i < 3} onChanged={reload} />
            ))}
          </div>
        </Section>
      ) : null}
      {check.length ? (
        <Section title={t("s.sec_check_mine")} count={check.length} hint={t("s.sec_check_mine_hint")}>
          <div className="space-y-3">
            {check.map((x) => (
              <TaskCard key={x.id} task={x} refData={refData} onChanged={reload} />
            ))}
          </div>
        </Section>
      ) : null}
      {done.data ? <DoneToday items={doneToday} /> : null}
    </div>
  );
}

function DoneToday({ items }: { items: TaskOut[] }) {
  const f = useFmt();
  const { t } = f;
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx("flex min-h-14 w-full items-center gap-3 rounded-2xl px-4 text-left", focusRing)}
      >
        <CheckCircle2 className="size-6 text-emerald-500" aria-hidden />
        <span className="flex-1 text-lg font-bold text-fg">{t("s.done_today")}</span>
        <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{items.length}</span>
        <ChevronDown className={cx("size-5 text-fg-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        items.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {items.map((x) => (
              <li key={x.id}>
                <Link href={`/tasks/${x.id}`} className={cx("flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2", focusRing)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-fg">{f.title(x)}</span>
                    <span className="block text-sm text-fg-3">{t("s.done_at", { time: f.time(x.completed_at) })}</span>
                  </span>
                  <ChevronRight className="size-5 text-fg-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line px-4 py-4 text-[15px] text-fg-3">{t("s.done_today_empty")}</p>
        )
      ) : null}
    </section>
  );
}

// --------------------------------------------------------------------------- dept lead

const SECTION_LIMIT = 10;

function LeadHome() {
  const { me } = useMe();
  const { t } = useFmt();
  const refData = useReference();
  const fresh = useApi<TaskListOut>(paths.tasks({ status: ["detected", "needs_review"], sort: "created_desc", limit: SECTION_LIMIT }), { refreshMs: 60000 });
  const check = useApi<TaskListOut>(paths.tasks({ status: ["pending_verification"], sort: "updated_desc", limit: SECTION_LIMIT }), { refreshMs: 60000 });
  const team = useApi<TaskListOut>(paths.tasks({ status: ["assigned", "in_progress", "blocked"], sort: "due_asc", limit: 100 }), { refreshMs: 60000 });
  const mine = useApi<TaskListOut>(paths.tasks({ mine: true, open: true, sort: "due_asc", limit: 50 }), { refreshMs: 60000 });
  const reload = () => {
    fresh.reload();
    check.reload();
    team.reload();
    mine.reload();
  };

  const teamItems = (team.data?.items ?? []).filter((x) => x.assignee?.id !== me.id).sort(lateFirst);
  const mineItems = mine.data?.items ?? [];
  const loading = !fresh.data && fresh.loading;
  const error = fresh.error ?? check.error ?? team.error;
  const seeAll = (kind: string, total: number, shown: number) =>
    total > shown ? { href: `/list?kind=${kind}`, label: t("s.see_all", { n: total }) } : undefined;

  return (
    <div className="space-y-8">
      <Intro greeting={t("s.hello", { name: firstName(me.full_name) })} text={t("s.lead_intro")} />
      <WelcomeCard />
      <TelegramBanner />
      {error && !fresh.data ? <LoadError error={error} /> : null}
      {loading ? <CardsSkeleton n={3} /> : null}

      {fresh.data ? (
        <Section
          title={t("s.sec_new")}
          count={fresh.data.total}
          hint={t("s.sec_new_hint")}
          more={seeAll("new", fresh.data.total, fresh.data.items.length)}
        >
          {fresh.data.items.length ? (
            <div className="space-y-3">
              {fresh.data.items.map((x) => (
                <TaskCard key={x.id} task={x} refData={refData} onChanged={reload} />
              ))}
            </div>
          ) : (
            <EmptyNote title={t("s.empty_new_title")} text={t("s.empty_new_text")} />
          )}
        </Section>
      ) : null}

      {check.data ? (
        <Section
          title={t("s.sec_check")}
          count={check.data.total}
          hint={t("s.sec_check_hint")}
          more={seeAll("check", check.data.total, check.data.items.length)}
        >
          {check.data.items.length ? (
            <div className="space-y-3">
              {check.data.items.map((x) => (
                <TaskCard key={x.id} task={x} refData={refData} onChanged={reload} />
              ))}
            </div>
          ) : (
            <EmptyNote title={t("s.empty_check_title")} text={t("s.empty_check_text")} />
          )}
        </Section>
      ) : null}

      {team.data ? (
        <Section
          title={t("s.sec_team")}
          count={teamItems.length}
          hint={t("s.sec_team_hint")}
          more={teamItems.length > SECTION_LIMIT ? { href: "/list?kind=doing", label: t("s.see_all", { n: teamItems.length }) } : undefined}
        >
          {teamItems.length ? (
            <div className="space-y-3">
              {teamItems.slice(0, SECTION_LIMIT).map((x) => (
                <TaskCard key={x.id} task={x} refData={refData} onChanged={reload} />
              ))}
            </div>
          ) : (
            <EmptyNote title={t("s.empty_team_title")} text={t("s.empty_team_text")} />
          )}
        </Section>
      ) : null}

      {mineItems.length ? (
        <Section title={t("s.sec_mine")} count={mineItems.length} hint={t("s.sec_mine_hint")}>
          <div className="space-y-3">
            {mineItems.map((x) => (
              <TaskCard key={x.id} task={x} refData={refData} onChanged={reload} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- manager / owner / viewer

const TILE_STYLE = {
  new: "border-blue-500/25 bg-blue-500/8 text-blue-700 dark:text-blue-300",
  doing: "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  late: "border-red-500/30 bg-red-500/8 text-red-700 dark:text-red-300",
  done: "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
} as const;

function Tile({ kind, label, value }: { kind: keyof typeof TILE_STYLE; label: string; value: number | null }) {
  const { count } = useFmt();
  return (
    <Link
      href={`/list?kind=${kind}`}
      className={cx("flex min-h-28 flex-col justify-between rounded-2xl border p-4 shadow-xs transition-transform active:scale-[0.98]", TILE_STYLE[kind], focusRing)}
    >
      <span className="text-4xl font-bold tabular-nums leading-none">{value === null ? "—" : count(value)}</span>
      <span className="mt-3 flex items-center justify-between gap-1 text-base font-semibold text-fg">
        {label}
        <ChevronRight className="size-5 shrink-0 text-fg-4" aria-hidden />
      </span>
    </Link>
  );
}

function ManagerHome({ readOnly }: { readOnly: boolean }) {
  const { me } = useMe();
  const f = useFmt();
  const { t } = f;
  const router = useRouter();
  const refData = useReference();
  const now = useNow(60000);
  const summary = useApi<DashboardSummary>(paths.summary(), { refreshMs: 60000 });
  const late = useApi<TaskListOut>(paths.tasks({ overdue: true, sort: "due_asc", limit: 5 }), { refreshMs: 60000 });
  const fresh = useApi<TaskListOut>(paths.tasks({ status: ["detected", "needs_review"], sort: "created_desc", limit: 5 }), { refreshMs: 60000 });
  const reload = () => {
    summary.reload();
    late.reload();
    fresh.reload();
  };

  const s = summary.data;
  const by = (keys: string[]) => (s ? keys.reduce((n, k) => n + (s.by_status[k] ?? 0), 0) : null);
  const tiles: { kind: keyof typeof TILE_STYLE; label: Key; value: number | null }[] = [
    { kind: "new", label: "s.tile_new", value: by(["detected", "needs_review"]) },
    { kind: "doing", label: "s.tile_doing", value: by(["assigned", "in_progress", "blocked"]) },
    { kind: "late", label: "s.tile_late", value: s ? s.overdue : null },
    { kind: "done", label: "s.tile_done", value: s ? s.completed_today : null },
  ];

  function openStats() {
    setMode(me.id, "advanced");
    router.push("/");
  }

  return (
    <div className="space-y-8">
      <Intro greeting={t("s.hello", { name: firstName(me.full_name) })} text={t(readOnly ? "s.viewer_intro" : "s.manager_intro")} />
      <WelcomeCard />
      <TelegramBanner />
      {summary.error && !s ? <LoadError error={summary.error} /> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <Tile key={x.kind} kind={x.kind} label={t(x.label)} value={x.value} />
        ))}
      </div>

      <Section
        title={t("s.sec_late")}
        count={late.data?.total}
        hint={t("s.sec_late_hint")}
        more={late.data && late.data.total > late.data.items.length ? { href: "/list?kind=late", label: t("s.see_all", { n: late.data.total }) } : undefined}
      >
        {!late.data && late.loading ? <Skeleton className="h-40 w-full rounded-2xl" /> : null}
        {late.data && late.data.items.length === 0 ? <EmptyNote title={t("s.empty_late_title")} text={t("s.empty_late_text")} /> : null}
        {late.data && late.data.items.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {late.data.items.map((x) => {
              const due = plainDue(x.due_at, x.status, now, f.tz, f.locale, t);
              const truck = truckLabel(x, t);
              return (
                <li key={x.id}>
                  <Link href={`/tasks/${x.id}`} className={cx("flex min-h-16 items-start gap-3 px-4 py-3 hover:bg-surface-2", focusRing)}>
                    {x.assignee ? (
                      <Avatar name={x.assignee.full_name} size="md" className="mt-0.5" />
                    ) : (
                      <span className="mt-0.5 size-8 shrink-0 rounded-full border-2 border-dashed border-line-strong" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-base font-semibold leading-snug text-fg">{f.title(x)}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[15px]">
                        <span className="text-fg-2">{x.assignee ? x.assignee.full_name : t("s.nobody")}</span>
                        <span className="font-semibold text-danger-text">{due.text}</span>
                        {truck ? <span className="text-fg-3">{truck}</span> : null}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-5 shrink-0 text-fg-4" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>

      <Section
        title={t("s.sec_new_manager")}
        count={fresh.data?.total}
        hint={t(readOnly ? "s.sec_new_viewer_hint" : "s.sec_new_hint")}
        more={fresh.data && fresh.data.total > fresh.data.items.length ? { href: "/list?kind=new", label: t("s.see_all", { n: fresh.data.total }) } : undefined}
      >
        {!fresh.data && fresh.loading ? <CardsSkeleton n={2} /> : null}
        {fresh.data && fresh.data.items.length === 0 ? <EmptyNote title={t("s.empty_new_title")} text={t("s.empty_new_text")} /> : null}
        {fresh.data && fresh.data.items.length ? (
          <div className="space-y-3">
            {fresh.data.items.map((x) => (
              <TaskCard key={x.id} task={x} refData={refData} readOnly={readOnly} onChanged={reload} />
            ))}
          </div>
        ) : null}
      </Section>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <button type="button" onClick={openStats} className={cx("inline-flex min-h-11 items-center gap-2 text-base font-semibold text-accent-text hover:underline", focusRing)}>
          <BarChart3 className="size-5" aria-hidden />
          {t("s.stats_link")}
          <ArrowRight className="size-4" aria-hidden />
        </button>
        <p className="mt-0.5 text-[15px] text-fg-3">{t("s.stats_hint")}</p>
      </div>
    </div>
  );
}
