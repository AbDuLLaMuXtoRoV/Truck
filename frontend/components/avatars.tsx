import { initials } from "@/lib/format";
import { cx } from "./ui";

/** Hues that keep white initials readable (>= 4.5:1) in both themes. */
const AVATAR_BG = [
  "bg-indigo-600",
  "bg-sky-700",
  "bg-emerald-700",
  "bg-amber-700",
  "bg-rose-600",
  "bg-violet-600",
  "bg-teal-700",
  "bg-orange-700",
  "bg-fuchsia-700",
  "bg-blue-600",
];

/** Telegram-like gradients for group avatars. */
const GROUP_BG = [
  "from-rose-400 to-red-600",
  "from-amber-400 to-orange-600",
  "from-violet-400 to-purple-600",
  "from-emerald-400 to-green-600",
  "from-cyan-400 to-sky-600",
  "from-blue-400 to-indigo-600",
  "from-pink-400 to-fuchsia-600",
];

export function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
} as const;

export function Avatar({
  name,
  size = "md",
  className,
  title,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title ?? name}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
        AVATAR_BG[hashOf(name) % AVATAR_BG.length],
        SIZES[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarGroup({ names, max = 4, size = "sm" }: { names: string[]; max?: number; size?: keyof typeof SIZES }) {
  const unique = [...new Set(names)];
  const shown = unique.slice(0, max);
  const rest = unique.length - shown.length;
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((n) => (
        <Avatar key={n} name={n} size={size} className="ring-2 ring-surface" />
      ))}
      {rest > 0 ? (
        <span className={cx("inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-fg-2 ring-2 ring-surface", SIZES[size])}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/** Telegram-style round avatar with the first letter of the chat title. */
export function GroupAvatar({ title, className }: { title: string; className?: string }) {
  const letter = (title.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "#").toUpperCase();
  return (
    <span
      className={cx(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-base font-semibold text-white shadow-xs",
        GROUP_BG[hashOf(title) % GROUP_BG.length],
        className,
      )}
      aria-hidden
    >
      {letter}
    </span>
  );
}
