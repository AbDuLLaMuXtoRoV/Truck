"use client";

import { useEffect, type ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { SimpleShell } from "@/components/simple/SimpleShell";
import { Button, Empty, Skeleton } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useMode } from "@/lib/mode";

/** Signed-in area: waits for /auth/me, redirects anonymous visitors to /login. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, error, retry } = useAuth();
  const { t } = useT();
  const mode = useMode();

  useEffect(() => {
    if (status === "anonymous") {
      const next = window.location.pathname + window.location.search;
      window.location.replace(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
    }
  }, [status]);

  if (status === "authenticated") return mode === "simple" ? <SimpleShell>{children}</SimpleShell> : <Shell>{children}</Shell>;
  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface shadow-card">
          <Empty
            illustration="lock"
            title={t("session.load_failed")}
            action={
              <Button variant="primary" onClick={retry}>
                {t("common.try_again")}
              </Button>
            }
          >
            {errorMessage(error)}
          </Empty>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-bg" role="status" aria-label={t("common.loading")}>
      <div className="fixed inset-y-0 left-0 hidden w-60 border-r border-nav-line bg-nav p-4 md:block">
        <div className="h-8 w-32 rounded-lg bg-nav-2" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-8 rounded-lg bg-nav-2/70" />
          ))}
        </div>
      </div>
      <div className="md:pl-60">
        <div className="h-14 border-b border-line bg-surface" />
        <div className="mx-auto max-w-[1480px] space-y-4 px-6 py-6">
          <Skeleton className="h-7 w-64" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
