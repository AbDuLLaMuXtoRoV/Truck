"use client";

import { CircleHelp, Send, X } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useMe } from "@/lib/auth";
import { useT, type Key } from "@/lib/i18n";
import type { TaskStatus } from "@/lib/types";
import { Illustration, type IllustrationName } from "../illustrations";
import { TelegramConnect } from "../Shell";
import { cx, focusRing } from "../ui";
import { BigButton, Sheet, StagePill } from "./parts";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* hidden for this visit only */
  }
}

// --------------------------------------------------------------------------- help

export const HelpContext = createContext<() => void>(() => {});

/** Opens the "?" help panel from anywhere inside the simple shell. */
export function useOpenHelp(): () => void {
  return useContext(HelpContext);
}

const HELP_STAGES: { status: TaskStatus; text: Key }[] = [
  { status: "needs_review", text: "s.help_stage_new" },
  { status: "in_progress", text: "s.help_stage_doing" },
  { status: "blocked", text: "s.help_stage_stuck" },
  { status: "pending_verification", text: "s.help_stage_check" },
  { status: "completed", text: "s.help_stage_done" },
];

const HELP_BUTTONS: { label: Key; text: Key }[] = [
  { label: "s.btn_start", text: "s.help_btn_start" },
  { label: "s.btn_done", text: "s.help_btn_done" },
  { label: "s.btn_stuck", text: "s.help_btn_stuck" },
  { label: "s.btn_continue", text: "s.help_btn_continue" },
  { label: "s.btn_assign", text: "s.help_btn_assign" },
  { label: "s.btn_confirm", text: "s.help_btn_confirm" },
  { label: "s.btn_send_back", text: "s.help_btn_send_back" },
];

function HelpBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-base font-bold text-fg">{title}</h3>
      {children}
    </section>
  );
}

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  return (
    <Sheet open={open} title={t("s.help_title")} onClose={onClose}>
      <div className="space-y-6 text-base">
        <HelpBlock title={t("s.help_stages")}>
          <ul className="space-y-2.5">
            {HELP_STAGES.map((s) => (
              <li key={s.status} className="flex flex-col gap-1">
                <span>
                  <StagePill status={s.status} />
                </span>
                <span className="text-[15px] text-fg-2">{t(s.text)}</span>
              </li>
            ))}
          </ul>
        </HelpBlock>
        <HelpBlock title={t("s.help_buttons")}>
          <ul className="space-y-2">
            {HELP_BUTTONS.map((b) => (
              <li key={b.label} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
                <span className="block font-semibold text-fg">{t(b.label)}</span>
                <span className="block text-[15px] text-fg-2">{t(b.text)}</span>
              </li>
            ))}
          </ul>
        </HelpBlock>
        <HelpBlock title={t("s.help_who_title")}>
          <p className="text-[15px] text-fg-2">{t("s.help_who")}</p>
        </HelpBlock>
        <HelpBlock title={t("s.help_tg_title")}>
          <p className="text-[15px] text-fg-2">{t("s.help_tg")}</p>
        </HelpBlock>
        <BigButton variant="primary" onClick={onClose}>
          {t("s.help_close")}
        </BigButton>
      </div>
    </Sheet>
  );
}

/** Round "?" button that opens the help panel. */
export function HelpButton({ className }: { className?: string }) {
  const { t } = useT();
  const openHelp = useOpenHelp();
  return (
    <button
      type="button"
      onClick={openHelp}
      aria-label={t("s.help_title")}
      title={t("s.help_title")}
      className={cx("inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-fg-2 shadow-xs hover:bg-surface-2", focusRing, className)}
    >
      <CircleHelp className="size-5" aria-hidden />
    </button>
  );
}

// --------------------------------------------------------------------------- welcome

const STEPS: { ill: IllustrationName; title: Key; text: Key }[] = [
  { ill: "chat", title: "s.welcome_1", text: "s.welcome_1_text" },
  { ill: "inbox", title: "s.welcome_2", text: "s.welcome_2_text" },
  { ill: "check", title: "s.welcome_3", text: "s.welcome_3_text" },
];

/** First-visit card with the three steps; dismissing it is remembered in this browser. */
export function WelcomeCard() {
  const { me } = useMe();
  const { t } = useT();
  const openHelp = useOpenHelp();
  const key = `smart-truck.welcome.${me.id}`;
  const [hidden, setHidden] = useState(() => readFlag(key));
  if (hidden) return null;
  const close = () => {
    writeFlag(key);
    setHidden(true);
  };
  return (
    <section aria-labelledby="welcome-title" className="relative animate-fade-in overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft via-surface to-surface p-5 shadow-card">
      <button
        type="button"
        onClick={close}
        aria-label={t("s.welcome_close")}
        className={cx("absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-full text-fg-3 hover:bg-surface-3", focusRing)}
      >
        <X className="size-5" aria-hidden />
      </button>
      <h2 id="welcome-title" className="pr-10 text-xl font-bold text-fg">
        {t("s.welcome_title")}
      </h2>
      <p className="mt-1 text-base text-fg-2">{t("s.welcome_sub")}</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-col sm:items-start">
            <Illustration name={s.ill} className="h-14 w-20 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wide text-accent-text">{t("s.step_n", { n: i + 1 })}</div>
              <div className="text-base font-semibold leading-snug text-fg">{t(s.title)}</div>
              <p className="mt-0.5 text-sm text-fg-3">{t(s.text)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <BigButton variant="primary" onClick={close}>
          {t("s.welcome_ok")}
        </BigButton>
        <BigButton onClick={openHelp} icon={<CircleHelp />}>
          {t("s.help_more")}
        </BigButton>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- telegram banner

/** Shown until the user links Telegram (or hides it). */
export function TelegramBanner() {
  const { me } = useMe();
  const { t } = useT();
  const key = `smart-truck.tgbanner.${me.id}`;
  const [hidden, setHidden] = useState(() => readFlag(key));
  if (me.telegram_linked || hidden) return null;
  return (
    <section className="relative flex animate-fade-in gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/8 p-4 pr-12">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white" aria-hidden>
        <Send className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium leading-snug text-fg">{t("s.tg_banner")}</p>
        <div className="mt-3">
          <TelegramConnect big />
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          writeFlag(key);
          setHidden(true);
        }}
        aria-label={t("s.tg_banner_close")}
        className={cx("absolute right-2 top-2 inline-flex size-10 items-center justify-center rounded-full text-fg-3 hover:bg-surface-3", focusRing)}
      >
        <X className="size-5" aria-hidden />
      </button>
    </section>
  );
}
