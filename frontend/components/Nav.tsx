"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cx, LanguageSelect } from "@/components/ui";
import { paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { setCompanyScope, useCompanyScope } from "@/lib/company";
import { DATA_CHANGED, useApi } from "@/lib/hooks";
import { useT, type Key } from "@/lib/i18n";
import type { BadgesOut } from "@/lib/types";

interface NavItem {
  href: string;
  label: Key;
  count?: number;
}

/** One plain top bar: name, three links, company / language, log out. */
export function Nav() {
  const { me, can, signOut, changeLanguage, reloadMe } = useMe();
  const { t, lang } = useT();
  const pathname = usePathname();
  const scope = useCompanyScope();
  const badges = useApi<BadgesOut>(paths.badges(), { refreshMs: 20000 });
  const reloadBadges = badges.reload;

  useEffect(() => {
    window.addEventListener(DATA_CHANGED, reloadBadges);
    return () => window.removeEventListener(DATA_CHANGED, reloadBadges);
  }, [reloadBadges]);

  const items: NavItem[] = [
    { href: "/", label: "nav.issues" },
    { href: "/messages", label: "nav.messages", count: badges.data?.unanswered },
  ];
  if (can("groups.manage")) items.push({ href: "/settings", label: "nav.settings" });

  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/tasks") : pathname.startsWith(href));

  async function switchCompany(id: string) {
    setCompanyScope(id === me.home_company_id ? null : id);
    await reloadMe();
  }

  const companySelect = (className: string) =>
    me.companies.length > 1 && (
      <select
        aria-label={t("nav.company")}
        value={scope ?? me.home_company_id ?? me.company_id}
        onChange={(e) => void switchCompany(e.target.value)}
        className={cx("rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800", className)}
      >
        {me.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    );

  // phone: [name · language · log out] / [company] / [links]; wide screens: one row
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-blue-700 no-underline">
          {t("app.name")}
        </Link>
        {companySelect("order-last w-full sm:hidden")}
        <nav className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              aria-current={isActive(it.href) ? "page" : undefined}
              className={cx(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium no-underline",
                isActive(it.href) ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-100",
              )}
            >
              {t(it.label)}
              {!!it.count && <span className="rounded-full bg-red-600 px-2 text-xs font-bold leading-5 text-white">{it.count}</span>}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {companySelect("hidden max-w-44 sm:block")}
          <LanguageSelect value={lang} onChange={(l) => void changeLanguage(l)} />
          <span className="hidden text-sm text-gray-600 lg:inline">{me.full_name}</span>
          <button type="button" onClick={signOut} className="rounded-lg px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
            {t("nav.logout")}
          </button>
        </div>
      </div>
    </header>
  );
}
