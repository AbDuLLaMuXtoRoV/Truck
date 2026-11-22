"use client";

import { ChevronRight, Send, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Intro } from "./Homes";
import { usePageTitle } from "./tips";
import { ModeSwitch } from "../Shell";
import { NoAccess, cx, focusRing } from "../ui";
import { useMe } from "@/lib/auth";
import { useT, type Key } from "@/lib/i18n";

const LINKS: { href: string; title: Key; text: Key; icon: ReactNode }[] = [
  { href: "/groups", title: "s.set_groups", text: "s.set_groups_text", icon: <Send /> },
  { href: "/trucks", title: "s.set_trucks", text: "s.set_trucks_text", icon: <Truck /> },
];

/** Owner / admin settings: Telegram groups and trucks behind one menu item. */
export function SimpleSettings() {
  const { me } = useMe();
  const { t } = useT();
  usePageTitle(t("s.nav_settings"));
  if (me.role !== "owner" && me.role !== "admin") return <NoAccess message={t("s.settings_no_access")} />;
  return (
    <div className="space-y-5">
      <Intro text={t("s.settings_intro")} />
      <ul className="space-y-3">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className={cx("flex min-h-20 items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:bg-surface-2", focusRing)}
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text [&_svg]:size-6" aria-hidden>
                {l.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold text-fg">{t(l.title)}</span>
                <span className="block text-[15px] text-fg-3">{t(l.text)}</span>
              </span>
              <ChevronRight className="size-5 text-fg-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <ModeSwitch />
      </div>
    </div>
  );
}
