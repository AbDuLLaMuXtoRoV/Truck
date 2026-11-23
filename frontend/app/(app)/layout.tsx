"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { Button, ErrorBox, Loading } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/** Signed-in area: sends anonymous visitors to /login, then shows the top bar and the page. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { status, error, retry, signOut } = useAuth();
  const { t } = useT();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      const next = window.location.pathname + window.location.search;
      router.replace(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
    }
  }, [status, router]);

  if (status === "error") {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorBox error={error} onRetry={retry} retryLabel={t("common.retry")} />
        <Button variant="white" onClick={signOut}>
          {t("nav.logout")}
        </Button>
      </div>
    );
  }
  if (status !== "authenticated") return <Loading text={t("common.loading")} />;

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </>
  );
}
