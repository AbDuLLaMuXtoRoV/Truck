"use client";

import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LANG_NAMES, LANGS, useT } from "@/lib/i18n";
import { useToast } from "./toast";
import { cx, focusRing } from "./ui";

/** UZ / RU / EN segmented switch. Saves locally; when signed in also on the account (PATCH /api/me). */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, t } = useT();
  const { changeLanguage } = useAuth();
  const toast = useToast();

  return (
    <div
      role="group"
      aria-label={t("lang.switch")}
      className={cx(className ?? "inline-flex", "h-8 items-center rounded-lg border border-line bg-surface-2 p-0.5 text-[11px] font-semibold")}
    >
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l === "uz" ? "uz-Latn" : l}
          title={LANG_NAMES[l]}
          aria-label={LANG_NAMES[l]}
          aria-pressed={lang === l}
          onClick={() => {
            if (l === lang) return;
            changeLanguage(l).catch((err: unknown) => toast(t("lang.save_failed", { error: errorMessage(err) }), { kind: "error" }));
          }}
          className={cx(
            "h-full rounded-md px-2 uppercase tracking-wide transition-colors",
            focusRing,
            lang === l ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
