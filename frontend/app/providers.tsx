"use client";

import { useEffect, type ReactNode } from "react";
import { ToastProvider } from "@/components/toast";
import { AuthProvider } from "@/lib/auth";
import { HTML_LANG, useLang } from "@/lib/i18n";

/** Keeps <html lang> in step with the chosen UI language. */
function HtmlLang() {
  const lang = useLang();
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>
        <HtmlLang />
        {children}
      </ToastProvider>
    </AuthProvider>
  );
}
