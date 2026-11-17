"use client";

import { CornerDownLeft, FileText, Languages, Monitor, Moon, Plus, Search, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { paths } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { useApi, useDebounced } from "@/lib/hooks";
import { LANG_NAMES, LANGS } from "@/lib/i18n";
import { setTheme } from "@/lib/theme";
import type { TaskListOut } from "@/lib/types";
import { PriorityBadge, StatusBadge } from "./badges";
import { Kbd, Skeleton, cx } from "./ui";

export interface PaletteNavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface Item {
  id: string;
  group: string;
  label: string;
  icon: ReactNode;
  meta?: ReactNode;
  run: () => void;
}

/** ⌘K / Ctrl+K: jump to pages, search tasks (GET /api/tasks?q=), switch theme or language. */
export function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: PaletteNavItem[] }) {
  if (!open) return null;
  return <Palette onClose={onClose} nav={nav} />;
}

function Palette({ onClose, nav }: { onClose: () => void; nav: PaletteNavItem[] }) {
  const router = useRouter();
  const f = useFmt();
  const { t } = f;
  const { can, changeLanguage } = useAuth();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q.trim(), 200);
  const tasks = useApi<TaskListOut>(dq ? paths.tasks({ q: dq, limit: 8, sort: "updated_desc" }) : null);

  useEffect(() => {
    input.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const match = (s: string) => !term || s.toLowerCase().includes(term);
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const out: Item[] = [];
    for (const n of nav) {
      if (match(n.label)) out.push({ id: `nav:${n.href}`, group: t("cmd.group_pages"), label: n.label, icon: n.icon, run: go(n.href) });
    }
    if (can("tasks.create") && match(t("tasks.new"))) {
      out.push({ id: "new-task", group: t("cmd.group_actions"), label: t("tasks.new"), icon: <Plus />, run: go("/tasks?new=1") });
    }
    const themes = [
      { id: "light", label: t("theme.light"), icon: <Sun /> },
      { id: "dark", label: t("theme.dark"), icon: <Moon /> },
      { id: "system", label: t("theme.system"), icon: <Monitor /> },
    ] as const;
    for (const th of themes) {
      const label = t("cmd.theme", { theme: th.label });
      if (match(label)) {
        out.push({
          id: `theme:${th.id}`,
          group: t("cmd.group_actions"),
          label,
          icon: th.icon,
          run: () => {
            setTheme(th.id);
            onClose();
          },
        });
      }
    }
    for (const l of LANGS) {
      const label = t("cmd.language", { lang: LANG_NAMES[l] });
      if (match(label) || match(LANG_NAMES[l])) {
        out.push({
          id: `lang:${l}`,
          group: t("cmd.group_actions"),
          label,
          icon: <Languages />,
          run: () => {
            changeLanguage(l).catch(() => {});
            onClose();
          },
        });
      }
    }
    for (const task of tasks.data?.items ?? []) {
      out.push({
        id: `task:${task.id}`,
        group: t("cmd.group_tasks"),
        label: f.title(task),
        icon: <FileText />,
        meta: (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-fg-3">{task.code}</span>
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
          </span>
        ),
        run: go(`/tasks/${task.id}`),
      });
    }
    return out;
  }, [q, nav, tasks.data, can, changeLanguage, f, t, onClose, router]);

  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
      <div className="fixed inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("cmd.title")}
        className="relative w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-fg-3" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder={t("cmd.placeholder")}
            aria-label={t("cmd.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={items[current] ? `cmd-${current}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] text-fg placeholder:text-fg-4 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="cmd-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header ? <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-4">{header}</div> : null}
                <button
                  type="button"
                  id={`cmd-${i}`}
                  role="option"
                  aria-selected={i === current}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={item.run}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm [&_svg]:size-4",
                    i === current ? "bg-accent-soft text-fg" : "text-fg-2",
                  )}
                >
                  <span className={cx("shrink-0", i === current ? "text-accent-text" : "text-fg-3")}>{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.meta}
                  {i === current ? <CornerDownLeft className="text-fg-4" aria-hidden /> : null}
                </button>
              </div>
            );
          })}
          {dq && tasks.loading && !tasks.data ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : null}
          {items.length === 0 && !(dq && tasks.loading) ? <p className="px-3 py-8 text-center text-sm text-fg-3">{t("cmd.no_results")}</p> : null}
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-xs text-fg-3">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t("cmd.hint_move")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> {t("cmd.hint_open")}
          </span>
          <span className="ml-auto hidden sm:inline">{t("cmd.hint_search")}</span>
        </div>
      </div>
    </div>
  );
}
