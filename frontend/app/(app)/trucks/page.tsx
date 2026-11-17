"use client";

import { AlarmClock, ArrowUpRight, CircleCheck, ListTodo, Plus, Search, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useToast } from "@/components/toast";
import { Button, Empty, ErrorBanner, Field, Modal, NoAccess, PageHeader, Skeleton, cx, focusRing, inputCls } from "@/components/ui";
import { api, paths } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFmt } from "@/lib/format";
import { invalidateCache, useApi } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import type { TruckOut } from "@/lib/types";

type Show = "all" | "open" | "overdue";

export default function TrucksPage() {
  const { can } = useMe();
  const { t } = useT();
  if (!can("dashboard.read")) return <NoAccess message={t("access.trucks")} />;
  return <Trucks />;
}

function tone(x: TruckOut) {
  if (x.overdue_tasks > 0) return { tile: "bg-danger-soft text-danger-text", bar: "bg-danger", key: "trucks.state_overdue" as const };
  if (x.open_tasks > 0) return { tile: "bg-warning-soft text-warning-text", bar: "bg-warning", key: "trucks.state_open" as const };
  return { tile: "bg-success-soft text-success-text", bar: "bg-success", key: "trucks.state_clear" as const };
}

function Trucks() {
  const { can } = useMe();
  const { t } = useFmt();
  const res = useApi<TruckOut[]>(paths.trucks());
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (res.data ?? []).filter(
      (x) =>
        (show === "all" || (show === "open" ? x.open_tasks > 0 : x.overdue_tasks > 0)) &&
        (!term || x.unit_number.toLowerCase().includes(term) || (x.plate ?? "").toLowerCase().includes(term) || (x.vin ?? "").toLowerCase().includes(term)),
    );
  }, [res.data, q, show]);

  const totals = useMemo(() => {
    const all = res.data ?? [];
    return { all: all.length, open: all.filter((x) => x.open_tasks > 0).length, overdue: all.filter((x) => x.overdue_tasks > 0).length };
  }, [res.data]);

  return (
    <>
      <PageHeader
        icon={<Truck />}
        title={t("trucks.title")}
        subtitle={res.data ? t("trucks.summary", { total: totals.all, open: totals.open, overdue: totals.overdue }) : t("trucks.subtitle")}
        actions={
          can("fleet.manage") ? (
            <Button variant="primary" size="md" onClick={() => setAdding(true)}>
              <Plus />
              {t("trucks.add")}
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
          <input type="search" className={cx(inputCls, "pl-8")} placeholder={t("trucks.search_placeholder")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("trucks.search_label")} />
        </div>
        <div className="inline-flex h-8 rounded-lg border border-line bg-surface-2 p-0.5 text-sm" role="group" aria-label={t("trucks.show")}>
          {(
            [
              ["all", "filter.all", totals.all],
              ["open", "trucks.with_open", totals.open],
              ["overdue", "trucks.with_overdue", totals.overdue],
            ] as const
          ).map(([v, key, n]) => (
            <button
              key={v}
              type="button"
              aria-pressed={show === v}
              onClick={() => setShow(v)}
              className={cx("rounded-md px-2.5 transition-colors", focusRing, show === v ? "bg-surface text-fg shadow-xs ring-1 ring-line" : "text-fg-3 hover:text-fg")}
            >
              {t(key)} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner error={res.error} onRetry={res.reload} className="mb-3" />

      {!res.data && res.loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : null}

      {res.data && rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <Empty
            illustration={res.data.length === 0 ? "truck" : "search"}
            title={res.data.length === 0 ? t("trucks.empty") : t("trucks.no_match")}
            action={
              res.data.length === 0 && can("fleet.manage") ? (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <Plus />
                  {t("trucks.add")}
                </Button>
              ) : undefined
            }
          >
            {res.data.length === 0 ? t("trucks.empty_hint") : null}
          </Empty>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {rows.map((x) => (
          <TruckCard key={x.id} truck={x} />
        ))}
      </div>

      {can("fleet.manage") ? (
        <AddTruckDialog
          open={adding}
          onClose={() => setAdding(false)}
          onCreated={(truck) => {
            res.setData((prev) => [truck, ...(prev ?? [])]);
            invalidateCache("/api/trucks");
            setAdding(false);
          }}
        />
      ) : null}
    </>
  );
}

function TruckCard({ truck: x }: { truck: TruckOut }) {
  const { t } = useFmt();
  const s = tone(x);
  return (
    <Link
      href={`/tasks?truck_id=${x.id}`}
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop",
        focusRing,
        !x.is_active && "opacity-70",
      )}
    >
      <span className={cx("absolute inset-x-0 top-0 h-1", s.bar)} aria-hidden />
      <div className="flex items-start gap-3">
        <span className={cx("flex size-11 shrink-0 items-center justify-center rounded-xl", s.tile)}>
          <Truck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold tabular-nums tracking-tight text-fg">{x.unit_number}</span>
            {!x.is_active ? <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fg-3">{t("trucks.inactive")}</span> : null}
          </div>
          <div className="truncate text-xs text-fg-3">{[x.plate, x.vin].filter(Boolean).join(" · ") || t("trucks.no_plate")}</div>
        </div>
        <ArrowUpRight className="size-4 text-fg-4 transition-colors group-hover:text-accent-text" aria-hidden />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-1 text-[11px] font-medium text-fg-3">
            <ListTodo className="size-3" aria-hidden />
            {t("chart.open")}
          </div>
          <div className="text-lg font-semibold tabular-nums text-fg">{x.open_tasks}</div>
        </div>
        <div className={cx("rounded-lg px-3 py-2", x.overdue_tasks ? "bg-danger-soft" : "bg-surface-2")}>
          <div className={cx("flex items-center gap-1 text-[11px] font-medium", x.overdue_tasks ? "text-danger-text" : "text-fg-3")}>
            <AlarmClock className="size-3" aria-hidden />
            {t("chart.overdue")}
          </div>
          <div className={cx("text-lg font-semibold tabular-nums", x.overdue_tasks ? "text-danger-text" : "text-fg")}>{x.overdue_tasks}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-fg-3">
        {x.overdue_tasks || x.open_tasks ? <span className={cx("size-1.5 rounded-full", s.bar)} aria-hidden /> : <CircleCheck className="size-3.5 text-success" aria-hidden />}
        {t(s.key)}
      </div>
    </Link>
  );
}

function AddTruckDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: TruckOut) => void }) {
  const toast = useToast();
  const { t } = useT();
  const [unit, setUnit] = useState("");
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!unit.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const truck = await api.createTruck({ unit_number: unit.trim(), plate: plate.trim() || null, vin: vin.trim() || null });
      toast(t("toast.truck_added", { unit: truck.unit_number }));
      setUnit("");
      setPlate("");
      setVin("");
      onCreated(truck);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("trucks.add")}
      icon={<Truck />}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" form="add-truck-form" variant="primary" busy={busy} disabled={!unit.trim()}>
            {t("common.add")}
          </Button>
        </>
      }
    >
      <form id="add-truck-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error ? <ErrorBanner error={error} className="sm:col-span-2" /> : null}
        <Field label={t("trucks.unit_required")} className="sm:col-span-2">
          {(id) => <input id={id} className={inputCls} required maxLength={32} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t("trucks.unit_placeholder")} />}
        </Field>
        <Field label={t("trucks.col_plate")}>{(id) => <input id={id} className={inputCls} maxLength={32} value={plate} onChange={(e) => setPlate(e.target.value)} />}</Field>
        <Field label="VIN">{(id) => <input id={id} className={inputCls} maxLength={32} value={vin} onChange={(e) => setVin(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
