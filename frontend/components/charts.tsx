"use client";

/**
 * Overview figures and charts, built to the dataviz skill's specs:
 * - KPI tiles: sentence-case label, proportional value, ink-token text; status cue = icon + text;
 * - bars <= 24px thick, 4px rounded data-end, square at the baseline, 2px surface gaps;
 *   2px lines, >= 8px markers with a 2px surface ring; solid hairline grid; one y-axis;
 * - colours by job (validated with validate_palette.js against the card surface, light and dark):
 *   trend = slot-1 blue (AI share strong, rest of "created" one ordinal step lighter) + slot-2
 *   orange line for "completed"; overdue = status critical; priority mix = one-hue ordinal ramp;
 * - hover AND keyboard tooltips; every chart has a table-view twin; legend whenever >= 2 series.
 */

import Link from "next/link";
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { formatCount } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useIsDark } from "@/lib/theme";
import { PRIORITIES, type DepartmentLoad, type Priority, type TrendDay } from "@/lib/types";
import { PriorityBadge } from "./badges";
import { cx, focusRing } from "./ui";

// --------------------------------------------------------------------------- KPI card

type Tone = "default" | "danger" | "accent" | "warning" | "success" | "ai";

const TONE_ICON: Record<Tone, string> = {
  default: "bg-surface-3 text-fg-2",
  accent: "bg-accent-soft text-accent-text",
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  success: "bg-success-soft text-success-text",
  ai: "bg-ai-soft text-ai-text",
};

export function KpiCard({
  label,
  value,
  caption,
  href,
  icon,
  tone = "default",
  alert,
}: {
  label: string;
  value: number | undefined;
  caption?: ReactNode;
  href?: string;
  icon: ReactNode;
  tone?: Tone;
  /** Status cue (critical): icon + text, never colour alone. */
  alert?: string;
}) {
  const { locale } = useT();
  const body = (
    <>
      {tone === "danger" && alert ? <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-danger" aria-hidden /> : null}
      <div className="flex items-start justify-between gap-2">
        <span className={cx("flex size-9 items-center justify-center rounded-lg [&_svg]:size-[18px]", TONE_ICON[tone])}>{icon}</span>
        {alert ? (
          <span className="relative mt-1 flex size-2" title={alert} aria-label={alert}>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-danger" />
          </span>
        ) : null}
      </div>
      <div className="mt-3 truncate text-[13px] font-medium text-fg-3" title={label}>
        {label}
      </div>
      <div className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight text-fg">
        {value === undefined ? "–" : formatCount(value, locale)}
      </div>
      <div className="mt-1 min-h-4 truncate text-xs text-fg-3" title={typeof caption === "string" ? caption : undefined}>
        {caption}
      </div>
    </>
  );
  const cls = "relative block overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card";
  return href ? (
    <Link href={href} className={cx(cls, "transition-all duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-pop", focusRing)}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// --------------------------------------------------------------------------- chart card + tooltip

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  dim,
  icon,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table: ReactNode;
  dim?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useT();
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className={cx("flex flex-col rounded-xl border border-line bg-surface shadow-card", className)}>
      <figcaption className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
        <div className="flex min-w-0 items-start gap-2">
          {icon ? <span className="mt-0.5 text-fg-3 [&_svg]:size-4">{icon}</span> : null}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg">{title}</div>
            {subtitle ? <div className="text-xs text-fg-3">{subtitle}</div> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {legend}
          <button
            type="button"
            className={cx("rounded-md px-2 py-0.5 text-xs font-medium text-fg-3 ring-1 ring-line hover:bg-surface-2 hover:text-fg", focusRing)}
            onClick={() => setShowTable((s) => !s)}
            aria-pressed={showTable}
          >
            {showTable ? t("chart.show_chart") : t("chart.show_table")}
          </button>
        </div>
      </figcaption>
      <div className={cx("flex flex-1 flex-col px-4 pb-4 pt-3 transition-opacity", dim && "opacity-60")}>{showTable ? table : children}</div>
    </figure>
  );
}

export function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-3">
      {line ? (
        <span className={cx("inline-block h-0.5 w-3.5 rounded-full", color)} aria-hidden />
      ) : (
        <span className={cx("inline-block size-2.5 rounded-sm", color)} aria-hidden />
      )}
      {label}
    </span>
  );
}

interface Tip {
  x: number;
  y: number;
  rows: { label: string; value: string; key?: ReactNode }[];
  title?: string;
}

function TooltipBox({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-2 shadow-pop"
      style={{ left: tip.x, top: tip.y - 10 }}
      role="tooltip"
    >
      {tip.title ? <div className="mb-1 whitespace-nowrap text-[11px] font-medium text-fg-3">{tip.title}</div> : null}
      {tip.rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 whitespace-nowrap">
          {r.key}
          <span className="text-sm font-semibold tabular-nums text-fg">{r.value}</span>
          <span className="text-xs text-fg-3">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Per-mark tooltip (bars, segments): pointer move + keyboard focus. Text rendered as text. */
function useMarkTooltip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const place = (clientX: number, clientY: number, rows: Tip["rows"], title?: string) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: clientX - r.left, y: clientY - r.top, rows, title });
  };
  const handlers = (rows: Tip["rows"], title?: string) => ({
    onPointerMove: (e: PointerEvent) => place(e.clientX, e.clientY, rows, title),
    onPointerLeave: () => setTip(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      place(r.left + r.width / 2, r.top, rows, title);
    },
    onBlur: () => setTip(null),
  });
  return { box, handlers, node: <TooltipBox tip={tip} /> };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 2, 4] };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { top, ticks };
}

/** Column path with a 4px rounded data-end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// --------------------------------------------------------------------------- 14-day trend

export function TrendChart({ days, dim }: { days: TrendDay[]; dim?: boolean }) {
  const { t, locale } = useT();
  const { ref, width, height } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const fmtDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  const fmtLong = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const dayLabel = (d: string, long = false) => (long ? fmtLong : fmtDay).format(new Date(`${d}T00:00:00Z`));

  const H = Math.max(220, Math.round(height));
  const M = { top: 14, right: 28, bottom: 26, left: 30 };
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = H - M.top - M.bottom;
  const n = days.length;
  const band = n ? plotW / n : 0;
  const colW = Math.max(3, Math.min(24, band * 0.56));
  const max = Math.max(1, ...days.map((d) => Math.max(d.created, d.completed)));
  const { top, ticks } = niceScale(max);
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const cx0 = (i: number) => M.left + band * i + band / 2;
  const labelEvery = band < 34 ? Math.ceil(34 / Math.max(band, 1)) : 1;
  const totals = days.reduce((s, d) => ({ c: s.c + d.created, done: s.done + d.completed, ai: s.ai + d.ai_created }), { c: 0, done: 0, ai: 0 });
  const last = days[n - 1];

  const linePath = days.map((d, i) => `${i ? "L" : "M"}${cx0(i)},${y(d.completed)}`).join("");

  function onKey(e: KeyboardEvent<SVGSVGElement>) {
    if (!n) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive((a) => (a === null ? 0 : Math.min(n - 1, a + 1)));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => (a === null ? n - 1 : Math.max(0, a - 1)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  }

  const tip: Tip | null =
    active !== null && days[active]
      ? {
          x: cx0(active),
          y: y(Math.max(days[active].created, days[active].completed)),
          title: dayLabel(days[active].date, true),
          rows: [
            { label: t("trend.created"), value: String(days[active].created), key: <span className="h-2.5 w-2.5 rounded-sm bg-viz-1-soft" /> },
            { label: t("trend.ai_created"), value: String(days[active].ai_created), key: <span className="h-2.5 w-2.5 rounded-sm bg-viz-1" /> },
            { label: t("trend.completed"), value: String(days[active].completed), key: <span className="h-0.5 w-2.5 rounded-full bg-viz-2" /> },
          ],
        }
      : null;

  const table = (
    <div className="max-h-[240px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="text-left text-xs text-fg-3">
            <th className="py-1 pr-3 font-medium">{t("trend.day")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("trend.created")}</th>
            <th className="py-1 pr-3 text-right font-medium">{t("trend.ai_created")}</th>
            <th className="py-1 text-right font-medium">{t("trend.completed")}</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {days.map((d) => (
            <tr key={d.date} className="border-t border-line">
              <td className="py-1.5 pr-3 text-fg-2">{dayLabel(d.date, true)}</td>
              <td className="py-1.5 pr-3 text-right">{d.created}</td>
              <td className="py-1.5 pr-3 text-right">{d.ai_created}</td>
              <td className="py-1.5 text-right">{d.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <ChartCard
      className="h-full"
      title={t("trend.title", { n: n || 14 })}
      subtitle={t("trend.subtitle", { created: formatCount(totals.c, locale), ai: formatCount(totals.ai, locale), done: formatCount(totals.done, locale) })}
      dim={dim}
      table={table}
      legend={
        <span className="hidden items-center gap-3 sm:inline-flex">
          <LegendItem color="bg-viz-1-soft" label={t("trend.created")} />
          <LegendItem color="bg-viz-1" label={t("trend.ai_created")} />
          <LegendItem color="bg-viz-2" label={t("trend.completed")} line />
        </span>
      }
    >
      <div className="mb-2 flex flex-wrap gap-3 sm:hidden">
        <LegendItem color="bg-viz-1-soft" label={t("trend.created")} />
        <LegendItem color="bg-viz-1" label={t("trend.ai_created")} />
        <LegendItem color="bg-viz-2" label={t("trend.completed")} line />
      </div>
      <div ref={ref} className="relative min-h-[220px] w-full flex-1">
        {width > 0 && n > 0 ? (
          <svg
            width={width}
            height={H}
            className={cx("absolute inset-0 block overflow-visible rounded-md", focusRing)}
            tabIndex={0}
            role="img"
            aria-label={t("trend.aria", { n })}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
                <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[10px] tabular-nums">
                  {v}
                </text>
              </g>
            ))}
            {active !== null ? <line x1={cx0(active)} x2={cx0(active)} y1={M.top} y2={M.top + plotH} stroke="var(--line-strong)" strokeWidth={1} /> : null}
            {days.map((d, i) => {
              const x = cx0(i) - colW / 2;
              const hC = (d.created / top) * plotH;
              const hA = (d.ai_created / top) * plotH;
              return (
                <g key={d.date}>
                  <path d={columnPath(x, y(d.created), colW, hC)} className="fill-viz-1-soft" opacity={active === null || active === i ? 1 : 0.55} />
                  {/* AI share drawn from the baseline inside the created column; square top where it meets the rest */}
                  {hA > 0 ? (
                    <path
                      d={d.ai_created >= d.created ? columnPath(x, y(d.ai_created), colW, hA) : `M${x},${M.top + plotH}V${y(d.ai_created) + 1}H${x + colW}V${M.top + plotH}Z`}
                      className="fill-viz-1"
                      opacity={active === null || active === i ? 1 : 0.55}
                    />
                  ) : null}
                  {(n - 1 - i) % labelEvery === 0 ? (
                    <text x={cx0(i)} y={H - 8} textAnchor="middle" className="fill-fg-3 text-[10px]">
                      {dayLabel(d.date)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <path d={linePath} fill="none" stroke="var(--viz-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {days.map((d, i) => (
              <circle
                key={d.date}
                cx={cx0(i)}
                cy={y(d.completed)}
                r={active === i ? 5 : 3.5}
                fill="var(--viz-2)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}
            {last ? (
              <text x={cx0(n - 1) + 9} y={y(last.completed)} dy="0.32em" className="fill-fg-2 text-[11px] font-semibold tabular-nums">
                {last.completed}
              </text>
            ) : null}
            {/* hit areas: the whole band is the target (crosshair snaps to the day) */}
            {days.map((d, i) => (
              <rect
                key={d.date}
                x={M.left + band * i}
                y={M.top}
                width={band}
                height={plotH}
                fill="transparent"
                onPointerMove={() => setActive(i)}
              />
            ))}
          </svg>
        ) : null}
        <TooltipBox tip={tip} />
      </div>
    </ChartCard>
  );
}

// --------------------------------------------------------------------------- department load

export function DepartmentLoadChart({ rows, dim, className }: { rows: DepartmentLoad[]; dim?: boolean; className?: string }) {
  const { t } = useT();
  const { box, handlers, node } = useMarkTooltip();
  const max = Math.max(1, ...rows.map((r) => r.open));
  // the backend names the no-department row "Not routed" in English
  const nameOf = (r: DepartmentLoad) => (r.department_id ? r.name : t("dept.unrouted"));
  const hrefOf = (r: DepartmentLoad) => (r.department_id ? `/tasks?department_id=${r.department_id}&open=true` : "/tasks?unrouted=true&open=true");

  const table = (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-fg-3">
          <th className="py-1 pr-3 font-medium">{t("chart.department")}</th>
          <th className="py-1 pr-3 text-right font-medium">{t("chart.open")}</th>
          <th className="py-1 pr-3 text-right font-medium">{t("chart.overdue")}</th>
          <th className="py-1 text-right font-medium">{t("chart.on_time")}</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r) => (
          <tr key={r.code} className="border-t border-line">
            <td className="py-1.5 pr-3">{nameOf(r)}</td>
            <td className="py-1.5 pr-3 text-right">{r.open}</td>
            <td className="py-1.5 pr-3 text-right">{r.overdue}</td>
            <td className="py-1.5 text-right">{r.open - r.overdue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const legend = (
    <>
      <LegendItem color="bg-viz-critical" label={t("chart.overdue")} />
      <LegendItem color="bg-viz-1" label={t("chart.on_time")} />
    </>
  );

  return (
    <ChartCard
      className={className}
      title={t("chart.by_department")}
      subtitle={t("chart.by_department_sub")}
      dim={dim}
      legend={<span className="hidden items-center gap-3 sm:inline-flex">{legend}</span>}
      table={table}
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-3">{t("chart.no_open")}</p>
      ) : (
        <div ref={box} className="relative">
          <div className="mb-2 flex gap-3 sm:hidden">{legend}</div>
          <div className="grid grid-cols-[minmax(4.5rem,7rem)_1fr_auto_auto] items-center gap-x-3 gap-y-3 sm:grid-cols-[minmax(6rem,10rem)_1fr_auto_auto]">
            <span className="text-[11px] font-medium text-fg-3">{t("chart.department")}</span>
            <span />
            <span className="min-w-12 text-right text-[11px] font-medium text-fg-3">{t("chart.open")}</span>
            <span className="min-w-16 text-right text-[11px] font-medium text-fg-3">{t("chart.overdue")}</span>
            {rows.map((r) => {
              const name = nameOf(r);
              const onTime = r.open - r.overdue;
              const width = (r.open / max) * 100;
              const of = t("chart.tip_of_open", { name, open: r.open });
              return (
                <div key={r.code} className="contents">
                  <Link
                    href={hrefOf(r)}
                    className={cx("truncate text-sm hover:text-accent-text hover:underline", r.department_id ? "text-fg" : "italic text-fg-3")}
                    title={name}
                  >
                    {name}
                  </Link>
                  <div className="flex h-3.5 items-center gap-[2px] rounded-sm" style={{ width: `${width}%` }}>
                    {r.overdue > 0 ? (
                      <span
                        tabIndex={0}
                        aria-label={t("chart.aria_overdue", { name, n: r.overdue, open: r.open })}
                        className={cx("h-3.5 bg-viz-critical outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ring)]", onTime > 0 ? "rounded-none" : "rounded-r")}
                        style={{ flexGrow: r.overdue, flexBasis: 0, minWidth: 2 }}
                        {...handlers([{ label: t("chart.overdue"), value: String(r.overdue) }], of)}
                      />
                    ) : null}
                    {onTime > 0 ? (
                      <span
                        tabIndex={0}
                        aria-label={t("chart.aria_on_time", { name, n: onTime, open: r.open })}
                        className="h-3.5 rounded-r bg-viz-1 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                        style={{ flexGrow: onTime, flexBasis: 0, minWidth: 2 }}
                        {...handlers([{ label: t("chart.on_time"), value: String(onTime) }], of)}
                      />
                    ) : null}
                  </div>
                  <span className="min-w-12 text-right text-sm tabular-nums text-fg">{r.open}</span>
                  <span className={cx("min-w-16 text-right text-sm tabular-nums", r.overdue ? "font-semibold text-fg" : "text-fg-4")}>{r.overdue}</span>
                </div>
              );
            })}
          </div>
          {node}
        </div>
      )}
    </ChartCard>
  );
}

// --------------------------------------------------------------------------- priority mix (tall segmented bar)

const PRIORITY_FILL: Record<Priority, string> = { P1: "bg-viz-p1", P2: "bg-viz-p2", P3: "bg-viz-p3", P4: "bg-viz-p4" };
/** Ink inside each fill: white on the dark steps, near-black on the light ones (per theme). */
const PRIORITY_INK_LIGHT: Record<Priority, string> = { P1: "text-white", P2: "text-white", P3: "text-[#0b0b0b]", P4: "text-[#0b0b0b]" };
const PRIORITY_INK_DARK: Record<Priority, string> = { P1: "text-[#0b0b0b]", P2: "text-[#0b0b0b]", P3: "text-white", P4: "text-white" };

export function PriorityMix({ byPriority, dim, className }: { byPriority: Record<string, number>; dim?: boolean; className?: string }) {
  const { t, locale, label } = useT();
  const dark = useIsDark();
  const { box, handlers, node } = useMarkTooltip();
  const { ref, width } = useWidth<HTMLDivElement>();
  const rows = PRIORITIES.map((p: Priority) => ({ p, n: byPriority[p] ?? 0 }));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const share = (n: number) => (total ? n / total : 0);
  const pct = (n: number) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(share(n));
  const ink = dark ? PRIORITY_INK_DARK : PRIORITY_INK_LIGHT;

  const table = (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-fg-3">
          <th className="py-1 pr-3 font-medium">{t("chart.priority")}</th>
          <th className="py-1 pr-3 text-right font-medium">{t("chart.open_tasks")}</th>
          <th className="py-1 text-right font-medium">{t("chart.share")}</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {rows.map((r) => (
          <tr key={r.p} className="border-t border-line">
            <td className="py-1.5 pr-3">{label("priority", r.p)}</td>
            <td className="py-1.5 pr-3 text-right">{r.n}</td>
            <td className="py-1.5 text-right">{pct(r.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard className={className} title={t("chart.by_priority")} subtitle={t("chart.open_total", { n: formatCount(total, locale) })} dim={dim} table={table}>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-fg-3">{t("chart.no_open")}</p>
      ) : (
        <div ref={box} className="relative">
          <div ref={ref} className="flex h-7 w-full gap-[2px]" role="img" aria-label={rows.map((r) => `${r.p}: ${r.n}`).join(", ")}>
            {rows
              .filter((r) => r.n > 0)
              .map((r) => {
                const text = pct(r.n);
                const fits = share(r.n) * width >= text.length * 7 + 14;
                return (
                  <Link
                    key={r.p}
                    href={`/tasks?priority=${r.p}&open=true`}
                    aria-label={t("chart.aria_priority", { p: label("priority", r.p), n: r.n })}
                    className={cx("flex h-7 items-center rounded px-2 text-xs font-semibold tabular-nums hover:brightness-110", PRIORITY_FILL[r.p], ink[r.p], focusRing)}
                    style={{ flexGrow: r.n, flexBasis: 0, minWidth: 3 }}
                    {...handlers([{ label: t("chart.open_tasks"), value: String(r.n) }, { label: t("chart.share"), value: text }], label("priority", r.p))}
                  >
                    {fits ? text : null}
                  </Link>
                );
              })}
          </div>
          <ul className="mt-5 space-y-1">
            {rows.map((r) => (
              <li key={r.p}>
                <Link href={`/tasks?priority=${r.p}&open=true`} className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-2">
                  <span className={cx("size-2.5 shrink-0 rounded-sm", PRIORITY_FILL[r.p])} aria-hidden />
                  <PriorityBadge priority={r.p} />
                  <span className="truncate text-xs text-fg-3">{label("priority", r.p).replace(/^P\d · /, "")}</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums text-fg">{r.n}</span>
                </Link>
              </li>
            ))}
          </ul>
          {node}
        </div>
      )}
    </ChartCard>
  );
}

// --------------------------------------------------------------------------- meter

/** One ratio against its whole: same-hue track, fill carries the value; the figure is printed. */
export function Meter({ value, label, figure }: { value: number | null; label: string; figure: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-fg-3">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-fg">{figure}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-viz-1-soft/35" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(pct * 100)}>
        {value !== null ? <div className="h-full rounded-full bg-viz-1" style={{ width: `${pct * 100}%` }} /> : null}
      </div>
    </div>
  );
}
