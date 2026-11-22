"use client";

import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  LayoutDashboard,
  Layers,
  ListTodo,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plug,
  Search,
  Send,
  Settings,
  Siren,
  SlidersHorizontal,
  Sun,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { RANGES, setCompanyScope, setRange, useCompanyScope, useRange, type RangeDays } from "@/lib/company";
import { deptLabel } from "@/lib/crm";
import { tzAbbreviation, useFmt } from "@/lib/format";
import { DATA_CHANGED, useApi, useDismiss, useNow } from "@/lib/hooks";
import type { Key } from "@/lib/i18n";
import { setMode, useMode } from "@/lib/mode";
import { useReference } from "@/lib/reference";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import type { BadgesOut, IntegrationsOut, NotificationOut, Permission, TelegramLinkOut, UnreadCountOut } from "@/lib/types";
import { Avatar } from "./avatars";
import { LogoMark } from "./brand";
import { CommandPalette } from "./CommandPalette";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useToast } from "./toast";
import { Button, Dropdown, Empty, IconButton, MenuItem, Skeleton, Toggle, cx, focusRing } from "./ui";

// --------------------------------------------------------------------------- breadcrumb context

export const CrumbContext = createContext<(label: string | null) => void>(() => {});

/** Lets a page add a last breadcrumb segment (e.g. the task code). Kept for pages; the CRM top bar shows the product name. */
export function useCrumb(label: string | null): void {
  const set = useContext(CrumbContext);
  useEffect(() => {
    set(label);
    return () => set(null);
  }, [label, set]);
}

// --------------------------------------------------------------------------- nav model

type BadgeKey = keyof BadgesOut;

interface NavItem {
  href: string;
  label: Key;
  perm?: Permission;
  icon: ReactNode;
  badge?: BadgeKey;
  badgeTone?: "danger" | "accent" | "warning";
  ownerOnly?: boolean;
  /** green dot when an integration is connected */
  dot?: boolean;
}

const NAV_TOP: NavItem[] = [
  { href: "/", label: "crm.nav.dashboard", perm: "dashboard.read", icon: <LayoutDashboard /> },
  { href: "/inbox", label: "crm.nav.inbox", perm: "dashboard.read", icon: <Inbox />, badge: "unanswered", badgeTone: "danger" },
  { href: "/tasks", label: "crm.nav.issues", icon: <ListTodo />, badge: "my_open", badgeTone: "accent" },
  { href: "/escalations", label: "crm.nav.escalations", perm: "dashboard.read", icon: <Siren />, badge: "overdue_responses", badgeTone: "danger" },
  { href: "/companies", label: "crm.nav.companies", icon: <Building2 />, ownerOnly: true },
];

const NAV_BOTTOM: NavItem[] = [
  { href: "/shifts", label: "crm.nav.shifts", icon: <CalendarClock />, badge: "pending_handovers", badgeTone: "warning" },
  { href: "/reports", label: "crm.nav.reports", perm: "dashboard.read", icon: <BarChart3 /> },
  { href: "/team", label: "crm.nav.team", perm: "users.manage", icon: <Users /> },
  { href: "/integrations", label: "crm.nav.integrations", perm: "groups.manage", icon: <Plug />, dot: true },
  { href: "/settings", label: "crm.nav.settings", perm: "groups.read", icon: <Settings /> },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const BADGE_TONE = {
  danger: "bg-red-500 text-white",
  accent: "bg-indigo-500 text-white",
  warning: "bg-amber-400 text-amber-950",
} as const;

const COLLAPSE_KEY = "smart-truck.sidebar";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------- shell

export function Shell({ children }: { children: ReactNode }) {
  const { me, can } = useMe();
  const { t } = useFmt();
  const pathname = usePathname();
  // the shell only renders client-side (after /auth/me), so reading storage here is safe
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const [, setCrumb] = useState<string | null>(null);
  const allowed = (n: NavItem) => (!n.perm || can(n.perm)) && (!n.ownerOnly || me.role === "owner");
  const top = NAV_TOP.filter(allowed);
  const bottom = NAV_BOTTOM.filter(allowed);
  const badges = useApi<BadgesOut>(can("dashboard.read") ? paths.badges() : null, { refreshMs: 15000 });
  const integrations = useApi<IntegrationsOut>(can("groups.manage") ? paths.integrations() : null, { refreshMs: 120000 });
  const { reload: reloadBadges } = badges;
  const connected = integrations.data
    ? integrations.data.telegram.connected || integrations.data.gmail.mailboxes.some((m) => m.status === "connected")
    : false;

  // counts follow local changes right away (approve, transition, group enabled, …), not only the poll
  useEffect(() => {
    window.addEventListener(DATA_CHANGED, reloadBadges);
    return () => window.removeEventListener(DATA_CHANGED, reloadBadges);
  }, [reloadBadges]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // close the mobile drawer whenever the route changes
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawer(false);
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "expanded" : "collapsed");
      } catch {
        /* not persisted */
      }
      return !c;
    });
  }

  const paletteNav = [...top, ...bottom].map((n) => ({ href: n.href, label: t(n.label), icon: n.icon }));

  const sidebar = (mobile: boolean) => (
    <SidebarBody
      top={top}
      bottom={bottom}
      pathname={pathname}
      collapsed={!mobile && collapsed}
      badges={badges.data}
      connected={connected}
      onToggle={mobile ? () => setDrawer(false) : toggleCollapsed}
      mobile={mobile}
    />
  );

  return (
    <CrumbContext.Provider value={setCrumb}>
      <div className="min-h-screen bg-bg">
        <aside
          className={cx(
            "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-nav-line bg-nav transition-[width] duration-200 md:flex",
            collapsed ? "w-16" : "w-60",
          )}
        >
          {sidebar(false)}
        </aside>

        {drawer ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 animate-fade-in bg-slate-950/60" onClick={() => setDrawer(false)} aria-hidden />
            <aside className="absolute inset-y-0 left-0 flex w-72 animate-slide-in-left flex-col bg-nav shadow-pop">{sidebar(true)}</aside>
          </div>
        ) : null}

        <div className={cx("transition-[padding] duration-200", collapsed ? "md:pl-16" : "md:pl-60")}>
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur-md sm:gap-2.5 sm:px-5">
            <IconButton label={t("shell.open_nav")} className="md:hidden" onClick={() => setDrawer(true)}>
              <Menu />
            </IconButton>
            <LogoMark className="size-7 sm:hidden" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="hidden truncate text-[15px] font-semibold text-fg sm:block">{t("crm.product")}</div>
              <div className="hidden truncate text-[11px] text-fg-3 lg:block">{t("crm.tagline")}</div>
            </div>
            <CompanySwitcher />
            <RangeSelect className="hidden lg:block" />
            <IconButton label={t("cmd.search")} title={`${t("cmd.search")} (Ctrl K)`} onClick={() => setPalette(true)} className="hidden sm:inline-flex">
              <Search />
            </IconButton>
            <LanguageSwitcher className="hidden 2xl:inline-flex" />
            <span className="hidden sm:contents">
              <ThemeToggle />
            </span>
            <NotificationBell />
            <ProfileMenu />
          </header>
          <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-5 sm:py-5">{children}</main>
        </div>
        <CommandPalette open={palette} onClose={() => setPalette(false)} nav={paletteNav} />
      </div>
    </CrumbContext.Provider>
  );
}

// --------------------------------------------------------------------------- company switcher / range

/**
 * "All companies (n)" for owners (owner overview + home-company data), or one company, which is then
 * sent as X-Company-Id on every request.
 */
export function CompanySwitcher() {
  const { me, reloadMe } = useMe();
  const { t } = useFmt();
  const scope = useCompanyScope();
  const toast = useToast();
  const companies = me.companies ?? [];
  const isOwner = me.role === "owner";
  if (companies.length <= 1 && !isOwner) return null;
  const current = scope ? companies.find((c) => c.id === scope) : null;
  const label = current ? current.name : isOwner ? t("crm.all_companies", { n: Math.max(companies.length, 1) }) : me.company_name;

  async function pick(id: string | null) {
    if (id === scope) return;
    setCompanyScope(id);
    try {
      await reloadMe();
    } catch (err) {
      toast(errorMessage(err), { kind: "error" });
    }
  }

  return (
    <Dropdown
      label={t("crm.company_switch")}
      panelClassName="w-72 max-h-[70vh] overflow-y-auto"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          title={t("crm.company_switch")}
          className={cx(
            "inline-flex h-8 max-w-[11rem] items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-sm font-medium text-fg shadow-xs hover:bg-surface-2 sm:max-w-[15rem] sm:px-2.5",
            focusRing,
          )}
        >
          <Building2 className="size-4 shrink-0 text-fg-3" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-fg-4" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          {isOwner ? (
            <MenuItem
              icon={<Layers />}
              hint={scope === null ? <Check className="size-4 text-accent-text" /> : undefined}
              onClick={() => {
                close();
                void pick(null);
              }}
            >
              {t("crm.all_companies", { n: Math.max(companies.length, 1) })}
            </MenuItem>
          ) : null}
          {companies.map((c) => {
            const selected = scope === c.id || (scope === null && !isOwner && c.id === me.home_company_id);
            return (
              <MenuItem
                key={c.id}
                icon={<Building2 />}
                hint={selected ? <Check className="size-4 text-accent-text" /> : undefined}
                onClick={() => {
                  close();
                  void pick(c.id === me.home_company_id && !isOwner ? null : c.id);
                }}
              >
                {c.name}
              </MenuItem>
            );
          })}
        </>
      )}
    </Dropdown>
  );
}

const RANGE_KEY: Record<RangeDays, Key> = { 1: "crm.range_today", 7: "crm.range_7", 30: "crm.range_30" };

export function RangeSelect({ className }: { className?: string }) {
  const { t } = useFmt();
  const range = useRange();
  return (
    <select
      aria-label={t("crm.range")}
      value={range}
      onChange={(e) => setRange(Number(e.target.value) as RangeDays)}
      className={cx("h-8 rounded-lg border border-line bg-surface px-2 pr-7 text-sm text-fg shadow-xs", focusRing, className)}
    >
      {RANGES.map((r) => (
        <option key={r} value={r}>
          {t(RANGE_KEY[r])}
        </option>
      ))}
    </select>
  );
}

// --------------------------------------------------------------------------- sidebar

function NavLink({ n, pathname, collapsed, badges, connected }: { n: NavItem; pathname: string; collapsed: boolean; badges: BadgesOut | undefined; connected: boolean }) {
  const { t, count } = useFmt();
  const active = isActive(pathname, n.href);
  const value = n.badge && badges ? (badges[n.badge] ?? 0) : 0;
  const label = t(n.label);
  return (
    <Link
      href={n.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cx(
        "group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0",
        collapsed ? "size-10 justify-center self-center" : "h-9 px-2.5",
        active ? "bg-nav-active text-white" : "text-nav-fg hover:bg-nav-2 hover:text-white",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
      )}
    >
      {active ? <span className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-nav-indicator" aria-hidden /> : null}
      <span className={cx("relative", active ? "text-indigo-300" : "text-nav-muted group-hover:text-nav-fg")}>
        {n.icon}
        {n.dot && connected && collapsed ? <span className="absolute -right-1 -top-1 size-2 rounded-full bg-emerald-400 ring-2 ring-nav" aria-hidden /> : null}
      </span>
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
      {n.dot && connected && !collapsed ? (
        <span className="size-2 rounded-full bg-emerald-400" title={t("crm.integrations_connected")} aria-label={t("crm.integrations_connected")} />
      ) : null}
      {value ? (
        collapsed ? (
          <span className={cx("absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4", BADGE_TONE[n.badgeTone ?? "accent"])}>
            {value > 99 ? "99+" : value}
          </span>
        ) : (
          <span
            className={cx("min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums", BADGE_TONE[n.badgeTone ?? "accent"])}
            title={n.badge ? t(`crm.badgehint.${n.badge}` as Key) : undefined}
          >
            {value > 999 ? count(value) : value}
          </span>
        )
      ) : null}
    </Link>
  );
}

/** Expandable list of departments; each opens Issues filtered by that department. */
function DepartmentsNav({ collapsed }: { collapsed: boolean }) {
  const { t } = useFmt();
  const refData = useReference();
  const pathname = usePathname();
  const current = useSearchParams().get("department_id");
  const onIssues = pathname === "/tasks" && !!current;
  const [open, setOpen] = useState(onIssues);
  const depts = refData.departments;
  if (collapsed) {
    return (
      <Link
        href="/tasks"
        title={t("crm.nav.departments")}
        className="flex size-10 items-center justify-center self-center rounded-lg text-nav-muted hover:bg-nav-2 hover:text-white [&_svg]:size-[18px]"
      >
        <Layers />
      </Link>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          "group flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0",
          onIssues ? "text-white" : "text-nav-fg hover:bg-nav-2 hover:text-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        )}
      >
        <span className="text-nav-muted group-hover:text-nav-fg">
          <Layers />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{t("crm.nav.departments")}</span>
        <ChevronRight className={cx("!size-4 text-nav-muted transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open ? (
        <ul className="ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-nav-line pl-2.5">
          {depts.map((d) => {
            const active = onIssues && current === d.id;
            return (
              <li key={d.id}>
                <Link
                  href={`/tasks?department_id=${d.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "block truncate rounded-md px-2 py-1.5 text-[13px] transition-colors",
                    active ? "bg-nav-active font-medium text-white" : "text-nav-muted hover:bg-nav-2 hover:text-white",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                  )}
                >
                  {deptLabel(d, t)}
                </Link>
              </li>
            );
          })}
          {depts.length === 0 ? <li className="px-2 py-1.5 text-[13px] text-nav-muted">{t("common.loading")}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function SidebarBody({
  top,
  bottom,
  pathname,
  collapsed,
  badges,
  connected,
  onToggle,
  mobile,
}: {
  top: NavItem[];
  bottom: NavItem[];
  pathname: string;
  collapsed: boolean;
  badges: BadgesOut | undefined;
  connected: boolean;
  onToggle: () => void;
  mobile: boolean;
}) {
  const { me, signOut } = useMe();
  const { t, role } = useFmt();
  return (
    <>
      <div className={cx("flex h-14 shrink-0 items-center gap-2.5 border-b border-nav-line", collapsed ? "justify-center px-0" : "px-4")}>
        <LogoMark />
        {!collapsed ? (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-white">{t("crm.product_short")}</span>
            <span className="block truncate text-[11px] text-nav-muted">{me.company_name}</span>
          </span>
        ) : null}
        {mobile ? (
          <button type="button" onClick={onToggle} aria-label={t("common.close")} className="ml-auto rounded-md p-1.5 text-nav-muted hover:bg-nav-2 hover:text-white">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <nav className={cx("flex flex-1 flex-col gap-0.5 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")} aria-label={t("shell.main_nav")}>
        {top.map((n) => (
          <NavLink key={n.href} n={n} pathname={pathname} collapsed={collapsed} badges={badges} connected={connected} />
        ))}
        <Suspense fallback={null}>
          <DepartmentsNav collapsed={collapsed} />
        </Suspense>
        {bottom.map((n) => (
          <NavLink key={n.href} n={n} pathname={pathname} collapsed={collapsed} badges={badges} connected={connected} />
        ))}
      </nav>
      <div className={cx("border-t border-nav-line", collapsed ? "p-2" : "p-3")}>
        {!collapsed ? (
          <div className="mb-2 px-1 text-[11px] text-nav-muted">
            {t("shell.times_in", { abbr: tzAbbreviation(me.company_timezone), tz: me.company_timezone })}
          </div>
        ) : null}
        <div className={cx("flex items-center gap-2.5 rounded-lg", collapsed ? "flex-col" : "bg-nav-2/70 p-2")}>
          <Avatar name={me.full_name} size="md" />
          {!collapsed ? (
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium text-white">{me.full_name}</div>
              <div className="truncate text-xs text-nav-muted">{role(me.role)}</div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={signOut}
            title={t("profile.logout")}
            aria-label={t("profile.logout")}
            className="rounded-md p-1.5 text-nav-muted transition-colors hover:bg-nav-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <LogOut className="size-4" />
          </button>
        </div>
        {!mobile ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? t("shell.expand") : t("shell.collapse")}
            title={collapsed ? t("shell.expand") : t("shell.collapse")}
            className={cx(
              "mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-nav-muted transition-colors hover:bg-nav-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              collapsed && "justify-center",
            )}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed ? t("shell.collapse") : null}
          </button>
        ) : null}
      </div>
    </>
  );
}

// --------------------------------------------------------------------------- theme

const THEME_ICON: Record<Theme, ReactNode> = { light: <Sun />, dark: <Moon />, system: <Monitor /> };

export function ThemeToggle() {
  const theme = useTheme();
  const { t } = useFmt();
  return (
    <Dropdown
      label={t("theme.label")}
      panelClassName="w-44"
      trigger={({ toggle, open }) => (
        <IconButton label={t("theme.label")} onClick={toggle} active={open} aria-haspopup="menu" aria-expanded={open}>
          {THEME_ICON[theme]}
        </IconButton>
      )}
    >
      {(close) =>
        (["light", "dark", "system"] as const).map((th) => (
          <MenuItem
            key={th}
            icon={THEME_ICON[th]}
            onClick={() => {
              setTheme(th);
              close();
            }}
            hint={theme === th ? "✓" : undefined}
          >
            {t(`theme.${th}` as Key)}
          </MenuItem>
        ))
      }
    </Dropdown>
  );
}

// --------------------------------------------------------------------------- notifications

export function NotificationBell() {
  const { t, dateTime, ago } = useFmt();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(60000);
  useDismiss(ref, open, () => setOpen(false));

  const unread = useApi<UnreadCountOut>(paths.unreadCount(), { refreshMs: 60000 });
  const list = useApi<NotificationOut[]>(open ? paths.notifications({ limit: 30 }) : null);
  const count = unread.data?.unread ?? 0;

  async function markAll() {
    setBusy(true);
    try {
      await api.readAllNotifications();
      unread.setData({ unread: 0 });
      list.reload();
    } catch {
      /* the next poll retries */
    } finally {
      setBusy(false);
    }
  }

  function openNotification(n: NotificationOut) {
    if (!n.read_at) {
      const readAt = new Date().toISOString();
      list.setData((prev) => (prev ?? []).map((x) => (x.id === n.id ? { ...x, read_at: readAt } : x)));
      unread.setData((prev) => ({ unread: Math.max(0, (prev?.unread ?? 1) - 1) }));
      api.readNotification(n.id).catch(() => unread.reload());
    }
    if (n.task_id) {
      setOpen(false);
      router.push(`/tasks/${n.task_id}`);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <IconButton
        label={count ? t("notif.label_unread", { n: count }) : t("notif.title")}
        onClick={() => setOpen((o) => !o)}
        active={open}
        aria-expanded={open}
      >
        <Bell />
        {count ? (
          <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-surface">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </IconButton>
      {open ? (
        <div className="absolute right-0 z-50 mt-1.5 w-[min(24rem,calc(100vw-1.5rem))] animate-pop-in overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold text-fg">{t("notif.title")}</span>
            <Button size="xs" variant="ghost" onClick={markAll} busy={busy} disabled={!count}>
              {t("notif.mark_all")}
            </Button>
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {!list.data && list.loading
              ? Array.from({ length: 3 }, (_, i) => (
                  <li key={i} className="flex gap-3 px-4 py-3">
                    <Skeleton className="mt-1 size-2 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-4/5" />
                      <Skeleton className="h-2.5 w-1/3" />
                    </div>
                  </li>
                ))
              : null}
            {list.error ? <li className="px-4 py-3 text-sm text-danger-text">{errorMessage(list.error)}</li> : null}
            {list.data && list.data.length === 0 ? (
              <li>
                <Empty illustration="bell" compact>
                  {t("notif.empty")}
                </Empty>
              </li>
            ) : null}
            {list.data?.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={cx("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2", !n.read_at && "bg-accent-soft/40")}
                >
                  <span
                    className={cx("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")}
                    aria-label={n.read_at ? undefined : t("notif.unread")}
                  />
                  <span className="min-w-0">
                    {/* title and body are rendered by the server in the user's stored language */}
                    <span className={cx("block text-sm", n.read_at ? "text-fg-2" : "font-medium text-fg")}>{n.title}</span>
                    {n.body ? <span className="block truncate text-xs text-fg-3">{n.body}</span> : null}
                    <span className="mt-0.5 block text-xs text-fg-4" title={dateTime(n.created_at)}>
                      {ago(n.created_at, now)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------- profile

/** Connect / re-link Telegram: asks the API for a one-time link and shows it (deep link or code). */
export function TelegramConnect({ big }: { big?: boolean }) {
  const { me } = useMe();
  const { t, dateTime, relDue } = useFmt();
  const [link, setLink] = useState<TelegramLinkOut | null>(null);
  const [linkError, setLinkError] = useState<unknown>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const now = useNow(30000);

  async function connectTelegram() {
    setLinkBusy(true);
    setLinkError(null);
    setCopied(false);
    try {
      setLink(await api.telegramLink());
    } catch (err) {
      setLinkError(err);
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const expiry = link ? relDue(link.expires_at, now) : null;

  return (
    <div>
      {big ? (
        <button
          type="button"
          onClick={connectTelegram}
          disabled={linkBusy}
          className={cx(
            "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 text-[15px] font-semibold text-white shadow-xs transition-colors hover:bg-sky-600 disabled:opacity-60 sm:w-auto",
            focusRing,
          )}
        >
          <Send className="size-4" aria-hidden />
          {t("s.tg_connect")}
        </button>
      ) : (
        <Button size="sm" className="mt-2.5 w-full" onClick={connectTelegram} busy={linkBusy} role="menuitem">
          {me.telegram_linked ? t("tg.relink") : t("tg.connect")}
        </Button>
      )}
      {linkError ? <p className="mt-2 text-xs text-danger-text">{errorMessage(linkError)}</p> : null}
      {link ? (
        <div className={cx("mt-2.5 animate-slide-up rounded-lg border border-line bg-surface-2 p-2.5 text-fg-2", big ? "text-sm" : "text-xs")}>
          {link.deep_link ? (
            <>
              <a href={link.deep_link} target="_blank" rel="noopener noreferrer" className="font-medium break-all text-accent-text hover:underline">
                {t("tg.open_bot")}
              </a>
              <p className="mt-1 text-fg-3">{t("tg.press_start")}</p>
            </>
          ) : (
            <>
              <p>{t("tg.send_code")}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-2 py-1 font-mono text-[11px] text-fg ring-1 ring-line">{link.token}</code>
                <Button size="xs" onClick={() => copyToken(link.token)}>
                  {copied ? t("common.copied") : t("common.copy")}
                </Button>
              </div>
            </>
          )}
          <p className="mt-1.5 text-fg-3">
            {expiry?.overdue ? t("tg.expired") : t("tg.expires", { when: dateTime(link.expires_at), rel: expiry?.text ?? "" })}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Advanced mode on/off. Leaves screens that only exist in the other mode for home; task pages stay. */
export function ModeSwitch() {
  const { me } = useMe();
  const { t } = useFmt();
  const mode = useMode();
  const router = useRouter();
  const pathname = usePathname();
  const advanced = mode === "advanced";
  function flip(next: boolean) {
    setMode(me.id, next ? "advanced" : "simple");
    if (!/^\/tasks\/[^/]+$/.test(pathname)) router.push("/");
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-medium text-fg">
          <SlidersHorizontal className="size-4 text-fg-3" aria-hidden />
          {t("s.advanced_mode")}
        </span>
        <span className="mt-0.5 block text-xs text-fg-3">{advanced ? t("s.advanced_on_hint") : t("s.advanced_off_hint")}</span>
      </span>
      <Toggle checked={advanced} onChange={flip} label={t("s.advanced_mode")} />
    </div>
  );
}

/** Light / dark / system as a three-way switch (simple mode keeps it in the profile menu). */
function ThemeChoice() {
  const theme = useTheme();
  const { t } = useFmt();
  return (
    <div role="group" aria-label={t("theme.label")} className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
      {(["light", "dark", "system"] as const).map((th) => (
        <button
          key={th}
          type="button"
          aria-pressed={theme === th}
          onClick={() => setTheme(th)}
          className={cx(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors [&_svg]:size-4",
            focusRing,
            theme === th ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg",
          )}
        >
          {THEME_ICON[th]}
          {t(`theme.${th}` as Key)}
        </button>
      ))}
    </div>
  );
}

export function ProfileMenu({ simple }: { simple?: boolean }) {
  const { me, signOut } = useMe();
  const { t, role } = useFmt();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx("flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-surface-3", focusRing)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t("profile.menu", { name: me.full_name })}
      >
        <Avatar name={me.full_name} size="md" />
      </button>
      {open ? (
        <div
          className="absolute right-0 z-50 mt-1.5 max-h-[calc(100dvh-4.5rem)] w-[min(21rem,calc(100vw-1.5rem))] animate-pop-in overflow-y-auto rounded-xl border border-line bg-surface shadow-pop"
          role="menu"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Avatar name={me.full_name} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-fg">{me.full_name}</div>
              <div className="truncate text-xs text-fg-3">{me.email}</div>
              <div className="mt-0.5 truncate text-xs text-fg-3">
                {role(me.role)} · {me.company_name}
              </div>
            </div>
          </div>
          {simple ? (
            <div className="border-b border-line px-4 py-3">
              <div className="mb-1.5 text-xs font-medium text-fg-3">{t("theme.label")}</div>
              <ThemeChoice />
            </div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3 2xl:hidden">
                <div className="mb-1.5 text-xs font-medium text-fg-3">{t("lang.switch")}</div>
                <LanguageSwitcher />
              </div>
              <div className="border-b border-line px-4 py-3 sm:hidden">
                <div className="mb-1.5 text-xs font-medium text-fg-3">{t("theme.label")}</div>
                <ThemeChoice />
              </div>
            </>
          )}
          <div className="border-b border-line px-4 py-3">
            <ModeSwitch />
          </div>
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                <Send className="size-4 text-sky-500" aria-hidden />
                {t("tg.notifications")}
              </span>
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  me.telegram_linked ? "bg-success-soft text-success-text" : "bg-surface-3 text-fg-3",
                )}
              >
                {me.telegram_linked ? t("tg.linked") : t("tg.not_linked")}
              </span>
            </div>
            <p className="mt-1 text-xs text-fg-3">{t("tg.explain")}</p>
            <TelegramConnect />
          </div>
          <div className="p-1">
            <MenuItem icon={<LogOut />} onClick={signOut}>
              {t("profile.logout")}
            </MenuItem>
          </div>
        </div>
      ) : null}
    </div>
  );
}
