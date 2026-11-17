"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { useDismiss } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { Illustration, type IllustrationName } from "./illustrations";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]";

// --------------------------------------------------------------------------- form controls

const control =
  "block rounded-lg border border-line bg-surface text-sm text-fg shadow-xs transition-colors placeholder:text-fg-4 hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-[var(--ring)]/30 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3";

export const inputCls = cx(control, "w-full px-3 py-1.5");
/** Select without a width (for inline filter bars); selectCls is the full-width form version. */
export const selectBase = cx(control, "py-1.5 pl-3 pr-8");
export const selectCls = cx(selectBase, "w-full");
export const labelCls = "mb-1.5 block text-xs font-medium text-fg-2";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      {children(id)}
      {hint ? <p className="mt-1.5 text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success" | "subtle";
type Size = "xs" | "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-xs hover:bg-accent-hover border border-transparent",
  success: "bg-success text-white shadow-xs hover:brightness-110 border border-transparent",
  secondary: "bg-surface text-fg border border-line shadow-xs hover:bg-surface-2 hover:border-line-strong",
  danger: "bg-surface text-danger-text border border-line shadow-xs hover:bg-danger-soft hover:border-danger/40",
  ghost: "bg-transparent text-fg-2 border border-transparent hover:bg-surface-3 hover:text-fg",
  subtle: "bg-accent-soft text-accent-text border border-transparent hover:brightness-95 dark:hover:brightness-125",
};
const SIZE: Record<Size, string> = {
  xs: "h-7 px-2 text-xs gap-1 rounded-md",
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-9 px-4 text-sm gap-2 rounded-lg",
};

export function Button({
  variant = "secondary",
  size = "sm",
  busy = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        focusRing,
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {busy ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg active:scale-95 [&_svg]:size-[18px]",
        active && "bg-surface-3 text-fg",
        focusRing,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        focusRing,
        checked ? "bg-success" : "bg-line-strong",
      )}
    >
      <span
        className={cx(
          "inline-block size-4 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-4.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[11px] font-medium text-fg-3 shadow-xs",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// --------------------------------------------------------------------------- layout

export function Card({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  subtitle,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface shadow-card", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? <span className="text-fg-3 [&_svg]:size-4">{icon}</span> : null}
            <div className="min-w-0">
              {title ? <h2 className="truncate text-sm font-semibold text-fg">{title}</h2> : null}
              {subtitle ? <p className="truncate text-xs text-fg-3">{subtitle}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="hidden size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-accent-text shadow-xs sm:flex [&_svg]:size-5">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-fg-3">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// --------------------------------------------------------------------------- feedback

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin text-current", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton rounded-md", className)} aria-hidden />;
}

/** Generic content placeholder: a few lines of shimmering text. */
export function Loading({ label, rows = 3 }: { label?: string; rows?: number }) {
  const { t } = useT();
  return (
    <div className="space-y-3 px-1 py-4" role="status" aria-label={label ?? t("common.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className={cx("h-3", i % 2 ? "w-2/5" : "w-3/5")} />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  const { t } = useT();
  return (
    <div className="divide-y divide-line" role="status" aria-label={t("common.loading")}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cx("h-3", c === 1 ? "w-56 flex-1" : "w-16")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useT();
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cx(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger-text",
        className,
      )}
    >
      <span>{typeof error === "string" ? error : errorMessage(error)}</span>
      {onRetry ? (
        <Button size="xs" variant="secondary" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/** Empty state: small illustration, a title and a helpful line. */
export function Empty({
  children,
  title,
  illustration = "inbox",
  action,
  compact,
}: {
  children?: ReactNode;
  title?: ReactNode;
  illustration?: IllustrationName;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center px-4 text-center", compact ? "py-6" : "py-10")}>
      <Illustration name={illustration} className={compact ? "h-14 w-20" : "h-20 w-28"} />
      {title ? <p className="mt-3 text-sm font-semibold text-fg">{title}</p> : null}
      {children ? <p className={cx("max-w-sm text-sm text-fg-3", title ? "mt-1" : "mt-3")}>{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function NoAccess({ message }: { message: string }) {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <Empty illustration="lock" title={message}>
        {t("access.ask_admin")}
      </Empty>
    </div>
  );
}

// --------------------------------------------------------------------------- dropdown

/** Button + floating panel; closes on outside click / Escape. `children` gets a close() callback. */
export function Dropdown({
  trigger,
  children,
  align = "right",
  panelClassName,
  label,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  panelClassName?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cx(
            "absolute z-50 mt-1.5 animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-pop",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  children,
  onClick,
  icon,
  danger,
  disabled,
  hint,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        danger ? "text-danger-text hover:bg-danger-soft" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
        focusRing,
      )}
    >
      {icon ? <span className={danger ? "" : "text-fg-3"}>{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="text-xs text-fg-4">{hint}</span> : null}
    </button>
  );
}

// --------------------------------------------------------------------------- dialog

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  icon,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
}) {
  const { t } = useT();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // runs only when the dialog opens/closes, so parent re-renders never move the focus
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const first =
      panel.current?.querySelector<HTMLElement>("input, select, textarea") ?? panel.current?.querySelector<HTMLElement>("button");
    first?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 pt-[8vh]">
      <div className="fixed inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-[2px]" aria-hidden onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx("relative w-full animate-pop-in rounded-2xl border border-line bg-surface shadow-pop", wide ? "max-w-2xl" : "max-w-lg")}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            {icon ? (
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent-text [&_svg]:size-4">{icon}</span>
            ) : null}
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
          </div>
          <IconButton label={t("common.close")} onClick={onClose}>
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
