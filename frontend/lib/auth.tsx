"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, clearToken, getToken, setToken } from "./api";
import { getCompanyScope, setCompanyScope } from "./company";
import { getLang, hasStoredLang, isLang, setLang, type Lang } from "./i18n";
import type { MeOut, Permission } from "./types";

type Status = "loading" | "authenticated" | "anonymous" | "error";

interface AuthContextValue {
  status: Status;
  me: MeOut | null;
  /** Error from loading the session (render it with errorMessage). */
  error: unknown;
  /** Company time zone (IANA name) used for every displayed time. */
  tz: string;
  can: (perm: Permission) => boolean;
  signIn: (token: string, me: MeOut) => void;
  signOut: () => void;
  retry: () => void;
  /** Re-read /auth/me (after switching company: name, time zone and permissions follow the scope). */
  reloadMe: () => Promise<void>;
  /** Switch the UI language; when signed in it is also saved on the server (PATCH /api/me). */
  changeLanguage: (lang: Lang) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Set when the user picks a language on the login page: that choice wins over the stored server value. */
let pickedBeforeSignIn = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<MeOut | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    if (!getToken()) {
      // Deferred so the state update does not run synchronously inside the effect body.
      queueMicrotask(() => setStatus("anonymous"));
      return;
    }
    api
      .me(ctrl.signal)
      .then((user) => {
        // the device's own choice wins; otherwise follow the account (e.g. a new browser)
        if (!hasStoredLang() && isLang(user.language)) setLang(user.language);
        setMe(user);
        setError(null);
        setStatus("authenticated");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // a remembered company this account cannot open (another user signed in): back to the home company
        if (getCompanyScope() && err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 400)) {
          setCompanyScope(null);
          setAttempt((a) => a + 1);
          return;
        }
        if (!getToken()) {
          setStatus("anonymous"); // 401: token was cleared
        } else {
          setError(err);
          setStatus("error");
        }
      });
    return () => ctrl.abort();
  }, [attempt]);

  const signIn = useCallback((token: string, user: MeOut) => {
    setCompanyScope(null); // a new session starts in the home company
    setToken(token);
    setMe(user);
    setError(null);
    setStatus("authenticated");
    const current = getLang();
    if (pickedBeforeSignIn) {
      // chosen on the login page: keep it and store it on the account
      if (user.language !== current) {
        api
          .patchMe({ language: current })
          .then(setMe)
          .catch(() => {});
      }
    } else if (isLang(user.language) && user.language !== current) {
      setLang(user.language);
    }
    pickedBeforeSignIn = false;
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    // full reload on purpose: clears the in-memory response cache so no data outlives the session
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, []);

  const reloadMe = useCallback(async () => {
    setMe(await api.me());
  }, []);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((a) => a + 1);
  }, []);

  const changeLanguage = useCallback(
    async (lang: Lang) => {
      setLang(lang);
      if (status !== "authenticated") {
        pickedBeforeSignIn = true;
        return;
      }
      setMe(await api.patchMe({ language: lang }));
    },
    [status],
  );

  const value = useMemo<AuthContextValue>(() => {
    const perms = new Set(me?.permissions ?? []);
    return {
      status,
      me,
      error,
      tz: me?.company_timezone || "UTC",
      can: (perm) => perms.has(perm),
      signIn,
      signOut,
      retry,
      reloadMe,
      changeLanguage,
    };
  }, [status, me, error, signIn, signOut, retry, reloadMe, changeLanguage]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Same as useAuth but `me` is guaranteed (use inside the signed-in shell only). */
export function useMe(): AuthContextValue & { me: MeOut } {
  const ctx = useAuth();
  if (!ctx.me) throw new Error("useMe used before sign-in");
  return ctx as AuthContextValue & { me: MeOut };
}
