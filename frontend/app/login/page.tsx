"use client";

import { Lock, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button, ErrorBanner, Field, Skeleton, cx, inputCls } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

function safeNext(raw: string | null): string {
  // only same-site paths, never "//host" or absolute URLs
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") ? raw : "/";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { status, signIn } = useAuth();
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login({ email: email.trim(), password });
      signIn(res.access_token, res.user);
      router.replace(next);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner error={error} />
      <Field label={t("login.email")}>
        {(id) => (
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
            {/* plain text, not type=email: internal addresses (user@company.local) are valid logins */}
            <input
              id={id}
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
              className={cx(inputCls, "h-10 pl-9")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>
        )}
      </Field>
      <Field label={t("login.password")}>
        {(id) => (
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-4" aria-hidden />
            <input
              id={id}
              type="password"
              autoComplete="current-password"
              required
              className={cx(inputCls, "h-10 pl-9")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
      </Field>
      <Button type="submit" variant="primary" size="md" className="h-10 w-full" busy={busy}>
        {t("login.submit")}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const { t } = useT();
  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* brand panel */}
      <aside className="relative hidden overflow-hidden bg-[#0b1020] text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_-10%_-10%,rgba(99,102,241,0.55),transparent_60%),radial-gradient(900px_500px_at_110%_110%,rgba(139,92,246,0.45),transparent_60%)]" aria-hidden />
        <div
          className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:40px_40px]"
          aria-hidden
        />
        <div className="relative flex h-full flex-col p-12">
          <div className="flex items-center gap-3">
            <LogoMark className="size-10" />
            <span className="text-xl font-semibold tracking-tight text-white">{t("crm.product")}</span>
          </div>
          <div className="mt-auto max-w-lg">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">{t("login.one_line")}</h2>
          </div>
          <p className="mt-12 text-xs text-indigo-200/60">© Smart Truck</p>
        </div>
      </aside>

      {/* form */}
      <main className="flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 lg:invisible">
            <LogoMark />
            <span className="text-[15px] font-semibold tracking-tight text-fg">{t("crm.product_short")}</span>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm animate-slide-up">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight text-fg">{t("login.title")}</h1>
            <Suspense
              fallback={
                <div className="space-y-4">
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                  <Skeleton className="h-10" />
                </div>
              }
            >
              <LoginForm />
            </Suspense>
            <p className="mt-5 rounded-xl bg-surface-2 px-4 py-3 text-center text-[15px] text-fg-2">{t("login.ask_lead")}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
