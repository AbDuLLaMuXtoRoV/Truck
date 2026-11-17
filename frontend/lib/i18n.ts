"use client";

/**
 * Small homegrown i18n: typed flat dictionaries (lib/i18n/*.ts), `t(key, params)` with `{name}`
 * interpolation, plural keys (`base_one`, `base_few`, `base_many`, `base_other`) chosen with
 * Intl.PluralRules, and English fallback for anything missing.
 *
 * The active language lives in a tiny external store backed by localStorage, so every component
 * re-renders on change and server prerendering (default language) never mismatches hydration.
 */

import { useMemo, useSyncExternalStore } from "react";
import { en, type Key } from "./i18n/en";
import { ru } from "./i18n/ru";
import { uz } from "./i18n/uz";

export type { Key } from "./i18n/en";

export const LANGS = ["uz", "ru", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "uz";

/** Locale used for Intl date / number formatting. */
export const LOCALES: Record<Lang, string> = { uz: "uz-Latn-UZ", ru: "ru-RU", en: "en-US" };
/** Value for <html lang>. */
export const HTML_LANG: Record<Lang, string> = { uz: "uz-Latn", ru: "ru", en: "en" };
export const LANG_NAMES: Record<Lang, string> = { uz: "Oʻzbekcha", ru: "Русский", en: "English" };

export type Dict = Record<Key, string> & { [k: `${string}_few` | `${string}_many`]: string };
const DICTS: Record<Lang, Partial<Record<string, string>>> = { uz, ru, en };

export type Params = Record<string, string | number>;
export type PluralBase = { [K in Key]: K extends `${infer B}_other` ? B : never }[Key];

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export function translate(lang: Lang, key: Key, params?: Params): string {
  return interpolate(DICTS[lang][key] ?? en[key] ?? key, params);
}

const pluralRules = new Map<Lang, Intl.PluralRules>();

/** Plural-aware lookup: `tp("tasks.count", 5)` reads tasks.count_one / _few / _many / _other. `{n}` is the formatted count. */
export function translatePlural(lang: Lang, base: PluralBase, n: number, params?: Params): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang]);
    pluralRules.set(lang, rules);
  }
  const cat = rules.select(n);
  const d = DICTS[lang];
  const fallback = en as Partial<Record<string, string>>;
  const s = d[`${base}_${cat}`] ?? d[`${base}_other`] ?? fallback[`${base}_${cat}`] ?? fallback[`${base}_other`] ?? base;
  return interpolate(s, { n: n.toLocaleString(LOCALES[lang]), ...params });
}

/** Label for an enum value (`status.needs_review`), falling back to a humanized value for unknown ones. */
export function enumLabel(lang: Lang, prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  if (key in en) return translate(lang, key as Key);
  const t = value.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// --------------------------------------------------------------------------- language store

const STORAGE_KEY = "smart-truck.lang";
let current: Lang | null = null;
const listeners = new Set<() => void>();

function readStored(): Lang | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

/** Current language outside React (event handlers, error messages). */
export function getLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  if (current === null) current = readStored() ?? DEFAULT_LANG;
  return current;
}

/** True when the user picked a language on this device (stored), false when it is the default. */
export function hasStoredLang(): boolean {
  return typeof window !== "undefined" && readStored() !== null;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
  document.documentElement.lang = HTML_LANG[lang];
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => DEFAULT_LANG);
}

export interface I18n {
  lang: Lang;
  locale: string;
  t: (key: Key, params?: Params) => string;
  tp: (base: PluralBase, n: number, params?: Params) => string;
  label: (prefix: string, value: string) => string;
}

export function useT(): I18n {
  const lang = useLang();
  return useMemo(
    () => ({
      lang,
      locale: LOCALES[lang],
      t: (key, params) => translate(lang, key, params),
      tp: (base, n, params) => translatePlural(lang, base, n, params),
      label: (prefix, value) => enumLabel(lang, prefix, value),
    }),
    [lang],
  );
}
