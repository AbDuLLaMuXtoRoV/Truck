"use client";

import { CheckCheck, CircleHelp, Clock, Home, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { DATA_CHANGED, useApi } from "@/lib/hooks";
import { useT, type Key } from "@/lib/i18n";
import type { BadgesOut, Role } from "@/lib/types";
import { LogoMark } from "../brand";
import { CommandPalette } from "../CommandPalette";
import { LanguageSwitcher } from "../LanguageSwitcher";
import { NotificationBell, ProfileMenu } from "../Shell";
import { cx, focusRing } from "../ui";
import { HelpContext, HelpSheet } from "./Onboarding";
import { TitleContext } from "./tips";

interface SimpleNavItem {
  href: string;
  label: Key;
  icon: ReactNode;
  /** The one red count in the menu: things waiting for this user. */
  badge?: keyof BadgesOut;
}

export type SimpleRole = "agent" | "lead" | "manager" | "viewer";

export function simpleRole(role: Role): SimpleRole {
  if (role === "agent") return "agent";
  if (role === "dept_lead") return "lead";
  if (role === "viewer") return "viewer";
  return "manager";
}

export const HOME_TITLE: Record<SimpleRole, Key> = {
  agent: "s.nav_my_tasks",
  lead: "s.nav_today",
  manager: "s.nav_home",
  viewer: "s.nav_home",
};

function navFor(role: Role): SimpleNavItem[] {
  const r = simpleRole(role);
  const items: SimpleNavItem[] = [];
  if (r === "agent") {
    items.push({ href: "/", label: HOME_TITLE.agent, icon: <Home /> });
    items.push({ href: "/list?kind=my_done", label: "s.nav_done", icon: <CheckCheck /> });
  } else {
    items.push({ href: "/", label: HOME_TITLE[r], icon: <Home />, badge: r === "viewer" ? undefined : "needs_review" });
    items.push({ href: "/list?kind=late", label: "s.nav_late", icon: <Clock /> });
  }
  if (role === "owner" || role === "admin") items.push({ href: "/settings", label: "s.nav_settings", icon: <Settings /> });
  return items;
}

/** Top-bar title for pages that do not set one themselves (settings sub-pages, advanced pages). */
const FALLBACK_TITLE: [string, Key][] = [
  ["/inbox", "crm.nav.inbox"],
  ["/groups", "nav.groups"],
  ["/trucks", "nav.trucks"],
  ["/review", "nav.review"],
  ["/tasks", "nav.tasks"],
];

/** Pages that keep their wide advanced layout inside the simple frame. */
const WIDE = ["/groups", "/trucks", "/review", "/inbox", "/integrations", "/team", "/shifts", "/escalations", "/reports", "/companies"];

function isActive(pathname: string, kind: string | null, href: string): boolean {
  const [path, query] = href.split("?");
  if (path === "/") return pathname === "/";
  if (query) return pathname === path && `kind=${kind}` === query;
  return pathname === path || pathname.startsWith(`${path}/`) || (path === "/settings" && (pathname === "/groups" || pathname === "/trucks"));
}

function NavLinks({ items, badges, variant }: { items: SimpleNavItem[]; badges: BadgesOut | undefined; variant: "side" | "tab" }) {
  const { t } = useT();
  const pathname = usePathname();
  const kind = useSearchParams().get("kind");
  return (
    <>
      {items.map((n) => {
        const active = isActive(pathname, kind, n.href);
        const count = n.badge && badges ? badges[n.badge] : 0;
        const label = t(n.label);
        if (variant === "tab") {
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[12px] font-semibold leading-tight [&_svg]:size-6",
                focusRing,
                active ? "text-accent-text" : "text-fg-3",
              )}
            >
              <span className="relative">
                {n.icon}
                {count ? (
                  <span className="absolute -right-3 -top-1.5 min-w-5 rounded-full bg-red-500 px-1 text-center text-[11px] font-bold leading-5 text-white ring-2 ring-surface">
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        }
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-semibold transition-colors [&_svg]:size-5",
              focusRing,
              active ? "bg-accent-soft text-accent-text" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
            )}
          >
            {n.icon}
            <span className="flex-1 truncate">{label}</span>
            {count ? <span className="min-w-6 rounded-full bg-red-500 px-1.5 text-center text-xs font-bold leading-6 text-white">{count > 99 ? "99+" : count}</span> : null}
          </Link>
        );
      })}
    </>
  );
}

/** The simple-mode frame: logo, page title, language, bell, avatar; 3-4 menu items. */
export function SimpleShell({ children }: { children: ReactNode }) {
  const { me, can } = useMe();
  const { t } = useT();
  const pathname = usePathname();
  const [title, setTitle] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [palette, setPalette] = useState(false);
  const items = navFor(me.role);
  const badges = useApi<BadgesOut>(can("dashboard.read") ? paths.badges() : null, { refreshMs: 60000 });
  const { reload: reloadBadges } = badges;

  useEffect(() => {
    window.addEventListener(DATA_CHANGED, reloadBadges);
    return () => window.removeEventListener(DATA_CHANGED, reloadBadges);
  }, [reloadBadges]);

  // the search box is hidden in simple mode, but Ctrl+K still opens it
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

  const fallback = FALLBACK_TITLE.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  const shownTitle = title ?? (fallback ? t(fallback[1]) : pathname === "/" ? t(HOME_TITLE[simpleRole(me.role)]) : "");
  const wide = WIDE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const paletteNav = items.map((n) => ({ href: n.href, label: t(n.label), icon: n.icon }));

  return (
    <TitleContext.Provider value={setTitle}>
      <HelpContext.Provider value={() => setHelp(true)}>
        <div className="min-h-screen bg-bg text-base">
          {/* desktop: minimal sidebar */}
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface md:flex">
            <Link href="/" className={cx("flex h-16 items-center gap-2.5 px-5", focusRing)}>
              <LogoMark />
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold tracking-tight text-fg">
                  {t("crm.product_short")}
                </span>
                <span className="block truncate text-xs text-fg-3">{me.company_name}</span>
              </span>
            </Link>
            <nav aria-label={t("s.menu")} className="flex flex-1 flex-col gap-1 px-3 py-3">
              <Suspense fallback={null}>
                <NavLinks items={items} badges={badges.data} variant="side" />
              </Suspense>
              <button
                type="button"
                onClick={() => setHelp(true)}
                className={cx(
                  "flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-base font-semibold text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-5",
                  focusRing,
                )}
              >
                <CircleHelp />
                {t("s.nav_help")}
              </button>
            </nav>
          </aside>

          <div className="md:pl-60">
            <header className="sticky top-0 z-20 flex h-16 items-center gap-1.5 border-b border-line bg-surface/90 px-2.5 backdrop-blur-md sm:gap-3 sm:px-6">
              <Link href="/" aria-label={t("s.nav_home")} className={cx("shrink-0 rounded-lg md:hidden", focusRing)}>
                <LogoMark />
              </Link>
              <h1 className="min-w-0 flex-1 truncate text-base font-bold text-fg sm:text-lg">{shownTitle}</h1>
              <LanguageSwitcher className="inline-flex shrink-0" />
              <NotificationBell />
              <ProfileMenu simple />
            </header>
            <main
              className={cx(
                "mx-auto w-full px-4 pb-28 pt-5 sm:px-6 md:pb-12",
                wide ? "max-w-[1480px]" : "max-w-3xl",
              )}
            >
              {children}
            </main>
          </div>

          {/* phones: bottom tab bar */}
          <nav
            aria-label={t("s.menu")}
            className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgb(0_0_0/0.05)] backdrop-blur-md md:hidden"
          >
            <Suspense fallback={null}>
              <NavLinks items={items} badges={badges.data} variant="tab" />
            </Suspense>
            <button
              type="button"
              onClick={() => setHelp(true)}
              className={cx("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[12px] font-semibold text-fg-3 [&_svg]:size-6", focusRing)}
            >
              <CircleHelp />
              {t("s.nav_help")}
            </button>
          </nav>

          <HelpSheet open={help} onClose={() => setHelp(false)} />
          <CommandPalette open={palette} onClose={() => setPalette(false)} nav={paletteNav} />
        </div>
      </HelpContext.Provider>
    </TitleContext.Provider>
  );
}
