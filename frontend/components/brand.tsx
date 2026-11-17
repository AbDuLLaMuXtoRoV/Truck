import { cx } from "./ui";

/** Smart Truck mark: a truck silhouette with an AI spark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-white shadow-[0_2px_8px_-2px_rgb(79_70_229/0.6)] ring-1 ring-inset ring-white/15",
        className ?? "size-8",
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 15.5V8.2a1 1 0 0 1 1-1h8.8a1 1 0 0 1 1 1v7.3" />
        <path d="M13.3 10.2h3.6l3.6 3.6v1.7h-7.2" />
        <circle cx="7" cy="17" r="1.8" fill="currentColor" stroke="none" />
        <circle cx="16.8" cy="17" r="1.8" fill="currentColor" stroke="none" />
        <path d="M7.9 3.2l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z" fill="currentColor" strokeWidth={0.8} />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("text-[15px] font-semibold tracking-tight", className)}>
      Smart<span className="text-indigo-300">Truck</span>
    </span>
  );
}
