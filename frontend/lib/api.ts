/** Small typed fetch wrapper around the FastAPI backend. */

import { getCompanyScope } from "./company";
import { getLang, translate, type Key } from "./i18n";
import type {
  ClockOut,
  CompanyCreateIn,
  CompanyOut,
  ConversationOut,
  CoverageOut,
  EscalationOut,
  GmailConnectIn,
  GmailConnectOut,
  HandoverOut,
  InboxQuery,
  IntegrationsOut,
  LoadImportOut,
  LoadOut,
  MailboxOut,
  MailboxPatchIn,
  MessageToTaskIn,
  MyShiftOut,
  OwnerOverviewOut,
  ResponseStatsOut,
  ShiftEndIn,
  ShiftEndOut,
  ShiftOut,
  TelegramIdentityOut,
  TelegramIdentityPatchIn,
  ThreadOut,
  UserCreateIn,
  UserPatchIn,
  ApiErrorBody,
  AssignIn,
  CommentIn,
  DashboardSummary,
  DepartmentOut,
  GroupOut,
  GroupPatchIn,
  GroupsQuery,
  LoginIn,
  MeOut,
  MePatchIn,
  MergeIn,
  NotificationOut,
  NotificationsQuery,
  TaskCreateIn,
  TaskDetailOut,
  TaskListOut,
  TaskListQuery,
  TaskOut,
  TaskPatchIn,
  TelegramLinkOut,
  TokenOut,
  TransitionIn,
  TruckCreateIn,
  TruckOut,
  UnreadCountOut,
  UserOut,
  UsersQuery,
  UUID,
  ValidationErrorItem,
} from "./types";

/**
 * Base URL of the API. Empty (the default) means same origin: the browser calls /api/... on the
 * dashboard's own host and next.config.ts rewrites it to BACKEND_URL. Set NEXT_PUBLIC_API_URL only
 * to call a backend on another origin directly (that backend must then allow CORS).
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/+$/, "");

const TOKEN_KEY = "smart-truck.token";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable: the session lasts until reload */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Backend `detail.code` values that have a translated message. */
const KNOWN_CODES = new Set([
  "invalid_credentials",
  "too_many_attempts",
  "unauthorized",
  "forbidden",
  "not_found",
  "reason_required",
  "assignee_required",
  "invalid_transition",
  "no_op",
  "invalid_assignee",
  "invalid_department",
  "invalid_truck",
  "invalid_merge",
  "closed",
  "email_taken",
  "duplicate_unit",
  "password_too_long",
  "ai_forbidden",
  "not_downloaded",
  "gone",
]);

/** Message for any thrown value, in the user's language; unknown codes fall back to the server's message. */
export function errorMessage(err: unknown): string {
  const lang = getLang();
  const t = (key: Key, params?: Record<string, string | number>) => translate(lang, key, params);
  if (err instanceof ApiError) {
    if (err.code === "forbidden") {
      // a few forbidden cases carry a specific, useful reason
      if (/four-eyes/i.test(err.message)) return t("error.four_eyes");
      if (/only assign new tasks to yourself/i.test(err.message)) return t("error.assign_self_only");
      if (/only an owner/i.test(err.message)) return t("error.owner_only");
    }
    if (KNOWN_CODES.has(err.code)) return t(`error.${err.code}` as Key);
    if (err.code === "validation_error") return t("error.validation", { details: err.message });
    if (err.code === "network_error") return t("error.network");
    if (err.code === "http_error") return err.status >= 500 ? t("error.server", { status: err.status }) : t("error.request", { status: err.status });
    return err.message || t("error.generic");
  }
  if (err instanceof Error && err.message) return err.message;
  return t("error.generic");
}

function isValidationList(detail: unknown): detail is ValidationErrorItem[] {
  return Array.isArray(detail) && detail.every((d) => d && typeof d === "object" && "msg" in d);
}

function parseError(status: number, body: unknown): ApiError {
  const detail = (body as Partial<ApiErrorBody> | null)?.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail) && "message" in detail) {
    return new ApiError(status, String(detail.code ?? "error"), String(detail.message), body);
  }
  if (isValidationList(detail)) {
    const message = detail
      .map((d) => {
        const loc = (d.loc ?? []).filter((p) => p !== "body" && p !== "query" && p !== "path").join(".");
        return loc ? `${loc}: ${d.msg}` : d.msg;
      })
      .join("; ");
    return new ApiError(status, "validation_error", message, body);
  }
  if (typeof detail === "string") return new ApiError(status, "error", detail, body);
  return new ApiError(status, status === 401 ? "unauthorized" : "http_error", "", body);
}

type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[];
export type Query = Record<string, QueryValue>;

/** Builds "?a=1&status=x&status=y" (arrays repeat the key, as FastAPI expects); empty values are dropped. */
export function buildQuery(query?: object): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

let redirecting = false;

function redirectToLogin(): void {
  clearToken();
  if (typeof window === "undefined" || redirecting) return;
  if (window.location.pathname.startsWith("/login")) return;
  redirecting = true;
  const next = window.location.pathname + window.location.search;
  // full reload on purpose: drops every in-memory cache of the expired session
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export interface RequestOptions {
  query?: object;
  body?: unknown;
  signal?: AbortSignal;
  /** Do not redirect to /login on 401 (used by the login call itself). */
  noAuthRedirect?: boolean;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const company = getCompanyScope();
  if (company) headers["X-Company-Id"] = company;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const url = `${API_URL}${path}${buildQuery(opts.query)}`;
  const send = () =>
    fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });

  let res: Response;
  try {
    res = await send();
    // The same-origin proxy answers a plain-text 500 when its pooled connection to the backend was
    // just closed (keep-alive race). A GET is safe to repeat once.
    if (method === "GET" && res.status === 500 && !(res.headers.get("content-type") ?? "").includes("json")) {
      await new Promise((r) => setTimeout(r, 150));
      res = await send();
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Cannot reach the server");
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.noAuthRedirect) redirectToLogin();
    // a proxy in front of a stopped backend answers 5xx with an HTML page
    if (res.status >= 502 && res.status <= 504 && typeof body === "string") {
      throw new ApiError(res.status, "network_error", "Cannot reach the server", body);
    }
    throw parseError(res.status, body);
  }
  return body as T;
}

/** GET a binary resource with the bearer token (for files a plain <a href> cannot authenticate). */
export async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const company = getCompanyScope();
  if (company) headers["X-Company-Id"] = company;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers, signal, cache: "no-store" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Cannot reach the server");
  }
  if (!res.ok) {
    if (res.status === 401) redirectToLogin();
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    throw parseError(res.status, body);
  }
  return res.blob();
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>("GET", path, { signal });
}

// --------------------------------------------------------------------------- GET paths (for useApi)

export const paths = {
  me: () => "/api/auth/me",
  summary: () => "/api/dashboard/summary",
  badges: () => "/api/dashboard/badges",
  trend: (days = 14) => `/api/dashboard/trend?days=${days}`,
  activity: (limit = 20) => `/api/dashboard/activity?limit=${limit}`,
  aiStats: () => "/api/dashboard/ai",
  tasks: (q: TaskListQuery = {}) => `/api/tasks${buildQuery(q)}`,
  task: (id: UUID) => `/api/tasks/${encodeURIComponent(id)}`,
  departments: () => "/api/departments",
  trucks: () => "/api/trucks",
  users: (q: UsersQuery = {}) => `/api/users${buildQuery(q)}`,
  groups: (q: GroupsQuery = {}) => `/api/groups${buildQuery(q)}`,
  notifications: (q: NotificationsQuery = {}) => `/api/notifications${buildQuery(q)}`,
  unreadCount: () => "/api/notifications/unread-count",
  // CRM
  companies: () => "/api/companies",
  ownerOverview: () => "/api/owner/overview",
  inbox: (q: InboxQuery = {}) => `/api/inbox${buildQuery(q)}`,
  thread: (key: string) => `/api/inbox/thread${buildQuery({ key })}`,
  responseStats: (days = 7) => `/api/dashboard/response?days=${days}`,
  escalations: (limit = 50) => `/api/escalations?limit=${limit}`,
  myShift: () => "/api/shifts/me",
  coverage: () => "/api/shifts/coverage",
  integrations: () => "/api/integrations/status",
  mailboxes: () => "/api/mailboxes",
  loads: (q = "") => `/api/loads${buildQuery({ q: q || undefined })}`,
  rosterTelegram: () => "/api/roster/telegram",
};

// --------------------------------------------------------------------------- typed endpoints

export const api = {
  login: (body: LoginIn) => request<TokenOut>("POST", "/api/auth/login", { body, noAuthRedirect: true }),
  me: (signal?: AbortSignal) => request<MeOut>("GET", paths.me(), { signal }),
  patchMe: (body: MePatchIn) => request<MeOut>("PATCH", "/api/me", { body }),
  telegramLink: () => request<TelegramLinkOut>("POST", "/api/me/telegram-link"),

  notifications: (q: NotificationsQuery = {}) => request<NotificationOut[]>("GET", "/api/notifications", { query: q }),
  unreadCount: () => request<UnreadCountOut>("GET", paths.unreadCount()),
  readNotification: (id: UUID) => request<void>("POST", `/api/notifications/${encodeURIComponent(id)}/read`),
  readAllNotifications: () => request<void>("POST", "/api/notifications/read-all"),

  summary: () => request<DashboardSummary>("GET", paths.summary()),

  listTasks: (q: TaskListQuery = {}, signal?: AbortSignal) =>
    request<TaskListOut>("GET", "/api/tasks", { query: q, signal }),
  getTask: (id: UUID, signal?: AbortSignal) => request<TaskDetailOut>("GET", paths.task(id), { signal }),
  createTask: (body: TaskCreateIn) => request<TaskOut>("POST", "/api/tasks", { body }),
  patchTask: (id: UUID, body: TaskPatchIn) => request<TaskDetailOut>("PATCH", paths.task(id), { body }),
  transition: (id: UUID, body: TransitionIn) =>
    request<TaskDetailOut>("POST", `${paths.task(id)}/transition`, { body }),
  assign: (id: UUID, body: AssignIn) => request<TaskDetailOut>("POST", `${paths.task(id)}/assign`, { body }),
  comment: (id: UUID, body: CommentIn) => request<TaskDetailOut>("POST", `${paths.task(id)}/comments`, { body }),
  /** Closes `id` as a duplicate of `body.into_task_id`; returns the target task. */
  merge: (id: UUID, body: MergeIn) => request<TaskDetailOut>("POST", `${paths.task(id)}/merge`, { body }),

  departments: () => request<DepartmentOut[]>("GET", paths.departments()),
  trucks: () => request<TruckOut[]>("GET", paths.trucks()),
  createTruck: (body: TruckCreateIn) => request<TruckOut>("POST", "/api/trucks", { body }),
  users: (q: UsersQuery = {}) => request<UserOut[]>("GET", "/api/users", { query: q }),

  /** Raw attachment file (404 when not visible, 409 not_downloaded when the bot could not fetch it). */
  attachmentFile: (id: UUID, signal?: AbortSignal) => requestBlob(`/api/attachments/${encodeURIComponent(id)}/file`, signal),

  groups: (q: GroupsQuery = {}) => request<GroupOut[]>("GET", "/api/groups", { query: q }),

  // ------------------------------------------------------------------ CRM
  companies: () => request<CompanyOut[]>("GET", paths.companies()),
  createCompany: (body: CompanyCreateIn) => request<CompanyOut>("POST", "/api/companies", { body }),
  ownerOverview: () => request<OwnerOverviewOut>("GET", paths.ownerOverview()),

  inbox: (q: InboxQuery = {}) => request<ConversationOut[]>("GET", "/api/inbox", { query: q }),
  thread: (key: string) => request<ThreadOut>("GET", "/api/inbox/thread", { query: { key } }),
  noResponse: (clockId: UUID, reason: string) =>
    request<ClockOut>("POST", `/api/inbox/clocks/${encodeURIComponent(clockId)}/no-response`, { body: { reason } }),
  messageToTask: (messageId: UUID, body: MessageToTaskIn) =>
    request<TaskOut>("POST", `/api/inbox/messages/${encodeURIComponent(messageId)}/task`, { body }),
  linkMessage: (taskId: UUID, messageId: UUID) =>
    request<TaskDetailOut>("POST", `${paths.task(taskId)}/link-message`, { body: { message_id: messageId } }),
  escalate: (taskId: UUID, reason: string) => request<TaskDetailOut>("POST", `${paths.task(taskId)}/escalate`, { body: { reason } }),

  responseStats: (days = 7) => request<ResponseStatsOut>("GET", paths.responseStats(days)),
  escalations: (limit = 50) => request<EscalationOut[]>("GET", paths.escalations(limit)),

  myShift: () => request<MyShiftOut>("GET", paths.myShift()),
  startShift: () => request<ShiftOut>("POST", "/api/shifts/start"),
  endShift: (body: ShiftEndIn) => request<ShiftEndOut>("POST", "/api/shifts/end", { body }),
  coverage: () => request<CoverageOut[]>("GET", paths.coverage()),
  acceptHandover: (id: UUID) => request<HandoverOut>("POST", `/api/handovers/${encodeURIComponent(id)}/accept`),
  declineHandover: (id: UUID) => request<HandoverOut>("POST", `/api/handovers/${encodeURIComponent(id)}/decline`),

  integrations: () => request<IntegrationsOut>("GET", paths.integrations()),
  mailboxes: () => request<MailboxOut[]>("GET", paths.mailboxes()),
  patchMailbox: (id: UUID, body: MailboxPatchIn) => request<MailboxOut>("PATCH", `/api/mailboxes/${encodeURIComponent(id)}`, { body }),
  syncMailbox: (id: UUID) => request<MailboxOut>("POST", `/api/mailboxes/${encodeURIComponent(id)}/sync`),
  deleteMailbox: (id: UUID) => request<void>("DELETE", `/api/mailboxes/${encodeURIComponent(id)}`),
  gmailConnect: (body: GmailConnectIn) => request<GmailConnectOut>("POST", "/api/integrations/gmail/connect", { body }),

  importLoads: (csv: string) => request<LoadImportOut>("POST", "/api/loads/import", { body: { csv } }),
  loads: (q = "") => request<LoadOut[]>("GET", paths.loads(q)),

  rosterTelegram: () => request<TelegramIdentityOut[]>("GET", paths.rosterTelegram()),
  patchTelegramIdentity: (id: UUID, body: TelegramIdentityPatchIn) =>
    request<TelegramIdentityOut>("PATCH", `/api/roster/telegram/${encodeURIComponent(id)}`, { body }),

  createUser: (body: UserCreateIn) => request<UserOut>("POST", "/api/users", { body }),
  patchUser: (id: UUID, body: UserPatchIn) => request<UserOut>("PATCH", `/api/users/${encodeURIComponent(id)}`, { body }),
  patchGroup: (id: UUID, body: GroupPatchIn) =>
    request<GroupOut>("PATCH", `/api/groups/${encodeURIComponent(id)}`, { body }),
};
