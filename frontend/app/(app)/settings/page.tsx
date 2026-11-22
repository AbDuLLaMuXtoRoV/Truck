"use client";

import { ChevronRight, Plug, Send, Settings, SlidersHorizontal, Truck, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { IntegrationsView } from "@/components/crm/Integrations";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ModeSwitch } from "@/components/Shell";
import { SimpleSettings } from "@/components/simple/SimpleSettings";
import { Card, PageHeader, cx, focusRing } from "@/components/ui";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import type { Key } from "@/lib/i18n";
import { useMode } from "@/lib/mode";
import { setTheme, useTheme } from "@/lib/theme";
import type { Permission } from "@/lib/types";

const LINKS: { href: string; title: Key; text: Key; icon: ReactNode; perm: Permission }[] = [
  { href: "/groups", title: "crm.set.groups", text: "crm.set.groups_text", icon: <Send />, perm: "groups.read" },
  { href: "/trucks", title: "crm.set.trucks", text: "crm.set.trucks_text", icon: <Truck />, perm: "dashboard.read" },
  { href: "/integrations", title: "crm.nav.integrations", text: "crm.set.integrations_text", icon: <Plug />, perm: "groups.manage" },
  { href: "/team", title: "crm.nav.team", text: "crm.set.team_text", icon: <Users />, perm: "users.manage" },
];

function CrmSettings() {
  const { can } = useMe();
  const { t } = useFmt();
  const theme = useTheme();
  return (
    <div className="space-y-5">
      <PageHeader icon={<Settings />} title={t("crm.nav.settings")} subtitle={t("crm.settings_sub")} />
      <div className="grid gap-3 md:grid-cols-2">
        {LINKS.filter((l) => can(l.perm)).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cx("flex items-center gap-4 rounded-xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong hover:bg-surface-2", focusRing)}
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text [&_svg]:size-5" aria-hidden>
              {l.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-fg">{t(l.title)}</span>
              <span className="block text-sm text-fg-3">{t(l.text)}</span>
            </span>
            <ChevronRight className="size-5 text-fg-4" aria-hidden />
          </Link>
        ))}
      </div>
      <Card title={t("crm.set.preferences")} icon={<SlidersHorizontal />}>
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-fg-3">{t("lang.switch")}</div>
            <LanguageSwitcher />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-fg-3">{t("theme.label")}</div>
            <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs font-medium">
              {(["light", "dark", "system"] as const).map((th) => (
                <button
                  key={th}
                  type="button"
                  aria-pressed={theme === th}
                  onClick={() => setTheme(th)}
                  className={cx("h-7 rounded-md px-2.5", focusRing, theme === th ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg")}
                >
                  {t(`theme.${th}` as Key)}
                </button>
              ))}
            </div>
          </div>
          <ModeSwitch />
        </div>
      </Card>
    </div>
  );
}

function SettingsView() {
  const sp = useSearchParams();
  const mode = useMode();
  // Google's OAuth callback lands on /settings?tab=integrations&gmail=… in either mode
  if (sp.get("tab") === "integrations") return <IntegrationsView />;
  return mode === "simple" ? <SimpleSettings /> : <CrmSettings />;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsView />
    </Suspense>
  );
}
