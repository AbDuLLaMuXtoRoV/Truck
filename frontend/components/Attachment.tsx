"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { formatSeconds, useFmt } from "@/lib/format";
import type { AttachmentOut } from "@/lib/types";
import { Spinner, cx } from "./ui";

type Kind = "image" | "pdf" | "audio" | "file";

function kindOf(a: AttachmentOut): Kind {
  const mime = (a.mime_type ?? "").toLowerCase();
  if (mime.startsWith("image/") || a.kind === "photo" || a.kind === "sticker") return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(a.file_name ?? "")) return "pdf";
  if (mime.startsWith("audio/") || a.kind === "voice" || a.kind === "audio") return "audio";
  return "file";
}

/** Fetches the file with the bearer token into an object URL; the URL is revoked on unmount. */
function useAttachmentBlob(id: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const urlRef = useRef<string | null>(null);
  const pending = useRef<Promise<string> | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  const load = useCallback((): Promise<string> => {
    if (urlRef.current) return Promise.resolve(urlRef.current);
    if (pending.current) return pending.current;
    setLoading(true);
    setError(null);
    pending.current = api
      .attachmentFile(id)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        urlRef.current = objectUrl;
        setUrl(objectUrl);
        return objectUrl;
      })
      .catch((err: unknown) => {
        setError(err);
        throw err;
      })
      .finally(() => {
        pending.current = null;
        setLoading(false);
      });
    return pending.current;
  }, [id]);

  return { url, loading, error, load };
}

const chip = "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs";

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-fg-3" fill="currentColor" aria-hidden>
      <path d="M10.5 2.5a2.5 2.5 0 0 0-3.54 0L3 6.46a3.5 3.5 0 0 0 4.95 4.95l3.3-3.3-1.06-1.06-3.3 3.3a2 2 0 1 1-2.83-2.83l3.96-3.96a1 1 0 1 1 1.41 1.41L5.7 8.7l1.06 1.06 3.73-3.72a2.5 2.5 0 0 0 0-3.54Z" />
    </svg>
  );
}

export function AttachmentItem({ attachment: a, telegramLink }: { attachment: AttachmentOut; telegramLink: string | null }) {
  const f = useFmt();
  const { t, label } = f;
  const name = a.file_name ?? label("msgkind", a.kind);
  const meta = [a.duration_seconds ? formatSeconds(a.duration_seconds) : null, a.file_size ? f.bytes(a.file_size) : null]
    .filter(Boolean)
    .join(" · ");

  if (a.status !== "downloaded") {
    const problem = a.status === "too_large" || a.status === "failed";
    return (
      <div
        className={cx(
          chip,
          "max-w-full flex-wrap gap-x-1.5 gap-y-0.5",
          problem ? "border-warning/40 bg-warning-soft text-warning-text" : "border-line bg-surface-2 text-fg-2",
        )}
        title={a.mime_type ?? undefined}
      >
        <span className="inline-flex min-w-0 items-center gap-1">
          <PaperclipIcon />
          <span className="max-w-40 truncate">{name}</span>
          {meta ? <span className="whitespace-nowrap text-fg-3">{meta}</span> : null}
        </span>
        <span className={problem ? "font-medium" : "text-fg-3"}>
          {a.status === "too_large" ? t("att.too_large") : a.status === "failed" ? t("att.failed") : label("attachment", a.status)}
        </span>
        {problem && telegramLink ? (
          <a href={telegramLink} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-medium text-accent-text hover:underline">
            {t("msg.open_in_telegram")}
          </a>
        ) : null}
      </div>
    );
  }

  const kind = kindOf(a);
  if (kind === "image") return <ImageAttachment a={a} name={name} />;
  return <FileAttachment a={a} kind={kind} name={name} meta={meta} />;
}

function ImageAttachment({ a, name }: { a: AttachmentOut; name: string }) {
  const { t } = useFmt();
  const { url, error, load } = useAttachmentBlob(a.id);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (error) {
    return (
      <div className={cx(chip, "border-warning/40 bg-warning-soft text-warning-text")}>
        <PaperclipIcon />
        <span className="max-w-48 truncate">{name}</span>
        <span>· {errorMessage(error)}</span>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        className="group relative block h-24 w-32 overflow-hidden rounded-md border border-line bg-surface-3"
        title={t("att.view_image", { name })}
        aria-label={t("att.view_image", { name })}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from an authenticated fetch
          <img src={url} alt={name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-fg-4">
            <Spinner />
          </span>
        )}
      </button>
      {open && url ? (
        <div className="fixed inset-0 z-[70] flex flex-col bg-gray-950/85 p-4" role="dialog" aria-modal="true" aria-label={name}>
          <div className="flex items-center justify-between gap-2 pb-3 text-sm text-white">
            <span className="truncate">{name}</span>
            <span className="flex shrink-0 gap-3">
              <a href={url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                {t("att.open_tab")}
              </a>
              <button type="button" onClick={() => setOpen(false)} className="underline-offset-2 hover:underline">
                {t("common.close")}
              </button>
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center" onClick={() => setOpen(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL from an authenticated fetch */}
            <img src={url} alt={name} className="max-h-full max-w-full rounded object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function FileAttachment({ a, kind, name, meta }: { a: AttachmentOut; kind: Exclude<Kind, "image">; name: string; meta: string }) {
  const { t } = useFmt();
  const { url, loading, error, load } = useAttachmentBlob(a.id);
  const [playing, setPlaying] = useState(false);

  async function openPdf() {
    // open the tab inside the click so popup blockers allow it, then point it at the file
    const win = window.open("", "_blank");
    try {
      const objectUrl = await load();
      if (win) win.location.href = objectUrl;
      else window.location.assign(objectUrl);
    } catch {
      win?.close();
    }
  }

  async function download() {
    try {
      const objectUrl = await load();
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = a.file_name ?? `attachment-${a.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      /* error shown below */
    }
  }

  async function play() {
    try {
      await load();
      setPlaying(true);
    } catch {
      /* error shown below */
    }
  }

  const action =
    kind === "pdf" ? (
      <button type="button" onClick={openPdf} className="font-medium text-accent-text hover:underline">
        {t("att.open_pdf")}
      </button>
    ) : kind === "audio" ? (
      !playing ? (
        <button type="button" onClick={play} className="font-medium text-accent-text hover:underline">
          {t("att.play")}
        </button>
      ) : null
    ) : (
      <button type="button" onClick={download} className="font-medium text-accent-text hover:underline">
        {t("att.download")}
      </button>
    );

  return (
    <div className="flex flex-col gap-1">
      <div className={cx(chip, "border-line bg-surface-2 text-fg-2")} title={a.mime_type ?? undefined}>
        <PaperclipIcon />
        <span className="max-w-48 truncate">{name}</span>
        {meta ? <span className="text-fg-3">{meta}</span> : null}
        <span className="text-fg-4">·</span>
        {loading ? <Spinner className="h-3 w-3 text-fg-4" /> : action}
      </div>
      {kind === "audio" && playing && url ? (
        <audio controls autoPlay src={url} className="h-8 w-full max-w-xs" />
      ) : null}
      {error ? <span className="text-xs text-danger-text">{errorMessage(error)}</span> : null}
    </div>
  );
}
