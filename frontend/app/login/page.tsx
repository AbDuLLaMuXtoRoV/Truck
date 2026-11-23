"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button, Card, ErrorBox, LanguageSelect, inputCls } from "@/components/ui";
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
  const { status, signIn, changeLanguage } = useAuth();
  const { t, lang } = useT();
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
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <span className="text-2xl font-bold text-blue-700">{t("app.name")}</span>
          <LanguageSelect value={lang} onChange={(l) => void changeLanguage(l)} />
        </div>
        <Card className="p-6">
          <h1 className="mb-5 text-xl font-bold">{t("login.title")}</h1>
          <form onSubmit={submit} className="space-y-4">
            <ErrorBox error={error} />
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">{t("login.email")}</span>
              {/* plain text, not type=email: internal addresses (user@company.local) are valid logins */}
              <input
                type="text"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">{t("login.password")}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </label>
            <Button type="submit" big disabled={busy} className="w-full">
              {busy ? t("login.wait") : t("login.submit")}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-gray-500">{t("login.hint")}</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
