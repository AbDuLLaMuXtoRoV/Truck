/**
 * API contract types. Mirrors backend/app/api/schemas.py, backend/app/domain/enums.py and
 * backend/app/core/rbac.py exactly. UUIDs and datetimes travel as strings (ISO-8601, UTC with offset).
 *
 * Output models: Pydantic fields with defaults are always serialized, so they are required here
 * (`T | null` where the Python type is optional). Input models: fields with defaults are optional (`?`).
 */

export type UUID = string;
export type ISODateTime = string;

/** UI / notification language (uz = Uzbek, Latin script). */
export type Language = "uz" | "ru" | "en";

// --------------------------------------------------------------------------- enums (domain/enums.py)

export const ROLES = ["owner", "admin", "manager", "dept_lead", "agent", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const TASK_STATUSES = [
  "detected",
  "needs_review",
  "assigned",
  "in_progress",
  "blocked",
  "pending_verification",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const OPEN_STATUSES: readonly TaskStatus[] = [
  "detected",
  "needs_review",
  "assigned",
  "in_progress",
  "blocked",
  "pending_verification",
];

export const TASK_CATEGORIES = [
  "eld",
  "dispatch",
  "fleet_maintenance",
  "accounting",
  "documents",
  "safety_compliance",
  "hr",
  "trailer",
  "other",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/** Default category -> department code routing (spec v1.1 §3, enums.CATEGORY_DEPARTMENT). */
export const CATEGORY_DEPARTMENT: Record<TaskCategory, string | null> = {
  eld: "ELD",
  dispatch: "DISPATCH",
  fleet_maintenance: "FLEET",
  accounting: "ACCOUNTING",
  documents: "ACCOUNTING",
  safety_compliance: "SAFETY",
  hr: "HR",
  trailer: "TRAILER",
  other: null,
};

export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_SOURCES = ["ai", "manual", "telegram_command"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export const ACTOR_KINDS = ["user", "ai", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const TASK_EVENT_TYPES = [
  "created",
  "status_changed",
  "reopened",
  "assigned",
  "updated",
  "comment",
  "message_linked",
  "ai_update",
  "merged",
  "reminder",
  "escalated",
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const TASK_MESSAGE_RELATIONS = ["source", "context", "update", "duplicate", "evidence"] as const;
export type TaskMessageRelation = (typeof TASK_MESSAGE_RELATIONS)[number];

export const GROUP_KINDS = ["truck", "department", "dispatch", "other"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const BOT_MEMBERSHIPS = ["member", "administrator", "left", "kicked"] as const;
export type BotMembership = (typeof BOT_MEMBERSHIPS)[number];

export const MESSAGE_KINDS = ["text", "voice", "audio", "photo", "document", "video", "sticker", "other"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const ANALYSIS_STATUSES = ["pending", "done", "skipped", "failed"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ATTACHMENT_STATUSES = ["pending", "downloaded", "too_large", "failed"] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export const TRANSCRIPT_STATUSES = ["not_needed", "pending", "done", "unavailable", "failed"] as const;
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

export const NOTIFICATION_KINDS = [
  "assigned",
  "review_needed",
  "reminder",
  "escalation",
  "verification_needed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "read"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const TASK_UPDATE_KINDS = ["progress", "completion_claim", "blocker", "duplicate_report"] as const;
export type TaskUpdateKind = (typeof TASK_UPDATE_KINDS)[number];

// --------------------------------------------------------------------------- permissions (core/rbac.py)

export const PERMISSIONS = [
  "dashboard.read",
  "tasks.read_all",
  "tasks.read_department",
  "tasks.create",
  "tasks.update_all",
  "tasks.update_department",
  "tasks.review",
  "tasks.verify",
  "tasks.cancel",
  "messages.read",
  "groups.read",
  "groups.manage",
  "fleet.manage",
  "users.manage",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// --------------------------------------------------------------------------- refs

export interface DepartmentRef {
  id: UUID;
  code: string;
  name: string;
}

export interface TruckRef {
  id: UUID;
  unit_number: string;
}

export interface UserRef {
  id: UUID;
  full_name: string;
  role: Role;
  department_id: UUID | null;
}

export interface GroupRef {
  id: UUID;
  title: string;
}

// --------------------------------------------------------------------------- auth / users

export interface LoginIn {
  email: string;
  password: string;
}

export interface UserOut extends UserRef {
  email: string;
  is_active: boolean;
  telegram_linked: boolean;
  language: Language;
}

export interface MeOut extends UserOut {
  company_id: UUID;
  company_name: string;
  company_timezone: string;
  permissions: string[];
  /** the user's own company; company_id above is the one this request is scoped to (X-Company-Id) */
  home_company_id: UUID | null;
  /** every company this user may switch to */
  companies: CompanyRef[];
}

/** PATCH /api/me: fields left out are unchanged. */
export interface MePatchIn {
  /** null is rejected (422) */
  full_name?: string | null;
  /** null is rejected (422) */
  language?: Language | null;
}

export interface TokenOut {
  access_token: string;
  token_type: string;
  user: MeOut;
}

export interface UserCreateIn {
  email: string;
  full_name: string;
  password: string;
  role?: Role;
  department_id?: UUID | null;
  language?: Language;
}

export interface UserPatchIn {
  full_name?: string | null;
  role?: Role | null;
  department_id?: UUID | null;
  is_active?: boolean | null;
  /** null is rejected (422) */
  language?: Language | null;
}

export interface TelegramLinkOut {
  deep_link: string | null;
  token: string;
  expires_at: ISODateTime;
}

// --------------------------------------------------------------------------- fleet / org

export interface DepartmentOut extends DepartmentRef {
  lead_user_id: UUID | null;
  default_assignee_user_id: UUID | null;
}

export interface DepartmentPatchIn {
  lead_user_id?: UUID | null;
  default_assignee_user_id?: UUID | null;
}

export interface TruckOut extends TruckRef {
  vin: string | null;
  plate: string | null;
  is_active: boolean;
  open_tasks: number;
  overdue_tasks: number;
}

export interface TruckCreateIn {
  unit_number: string;
  vin?: string | null;
  plate?: string | null;
}

// --------------------------------------------------------------------------- groups

export interface GroupOut extends GroupRef {
  tg_chat_id: number;
  chat_type: string;
  kind: GroupKind;
  truck: TruckRef | null;
  department: DepartmentRef | null;
  is_enabled: boolean;
  bot_status: BotMembership;
  last_message_at: ISODateTime | null;
  created_at: ISODateTime;
  message_count: number;
  open_tasks: number;
  /** inbound messages waiting for a human reply */
  unanswered: number;
  supervisor_id: UUID | null;
  manager_id: UUID | null;
  backup_id: UUID | null;
}

/** Fields left out are unchanged; explicit null clears truck/department (null on is_enabled/kind is a 422). */
export interface GroupPatchIn {
  is_enabled?: boolean | null;
  kind?: GroupKind | null;
  truck_id?: UUID | null;
  department_id?: UUID | null;
  supervisor_id?: UUID | null;
  manager_id?: UUID | null;
  backup_id?: UUID | null;
  /** move the group to another company (needs access to both) */
  company_id?: UUID | null;
}

// --------------------------------------------------------------------------- tasks

export interface TaskOut {
  id: UUID;
  code: string;
  number: number;
  title: string;
  description: string | null;
  category: TaskCategory;
  priority: Priority;
  status: TaskStatus;
  is_overdue: boolean;
  department: DepartmentRef | null;
  truck: TruckRef | null;
  truck_unit_raw: string | null;
  load_ref: string | null;
  issue_type: string | null;
  amount: number | null;
  trailer_ref: string | null;
  driver_name: string | null;
  next_action_at: ISODateTime | null;
  source_channel: Source | null;
  mailbox: MailboxRef | null;
  /** state of the reply to the source message (null when none was needed) */
  response_status: "unanswered" | "overdue" | "answered" | null;
  /** earliest pending reply deadline: drives the live countdown in the issues table */
  response_due_at: ISODateTime | null;
  response_critical: boolean;
  assignee: UserRef | null;
  source: TaskSource;
  confidence: number | null;
  group: GroupRef | null;
  due_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  started_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  reopen_count: number;
  escalation_level: number;
  cancel_reason: string | null;
  blocked_reason: string | null;
  merged_into_id: UUID | null;
  /** Localised title/summary per language (schema: dict[str, dict[str, str | None]]; AI tasks get uz and ru); may be empty. title/description stay the English originals. */
  i18n: Partial<Record<Language, TaskTranslation>>;
}

export interface TaskTranslation {
  title: string;
  summary: string | null;
}

export interface TaskListOut {
  items: TaskOut[];
  total: number;
}

export interface TaskEventOut {
  id: UUID;
  /** One of TaskEventType (typed as str in the schema). */
  type: string;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  /** One of ActorKind (typed as str in the schema). */
  actor_kind: string;
  actor: UserRef | null;
  reason: string | null;
  data: Record<string, unknown>;
  created_at: ISODateTime;
}

export interface AttachmentOut {
  id: UUID;
  kind: string;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  duration_seconds: number | null;
  status: string;
}

export interface MessageOut {
  id: UUID;
  group: GroupRef;
  sent_at: ISODateTime;
  edited_at: ISODateTime | null;
  sender_name: string;
  kind: string;
  text: string | null;
  transcript: string | null;
  transcript_status: string;
  analysis_status: string;
  telegram_link: string | null;
  attachments: AttachmentOut[];
}

export interface LinkedMessageOut extends MessageOut {
  /** One of TaskMessageRelation (typed as str in the schema). */
  relation: string;
}

export interface TaskDetailOut extends TaskOut {
  source_text: string | null;
  events: TaskEventOut[];
  messages: LinkedMessageOut[];
  allowed_transitions: TaskStatus[];
  can_edit: boolean;
  can_assign: boolean;
  escalations: EscalationOut[];
  response: TaskResponseInfo | null;
}

export interface TaskCreateIn {
  title: string;
  description?: string | null;
  category?: TaskCategory;
  priority?: Priority;
  department_id?: UUID | null;
  truck_id?: UUID | null;
  load_ref?: string | null;
  assignee_id?: UUID | null;
  due_at?: ISODateTime | null;
}

/** Fields left out are unchanged; null clears optional fields. title/category/priority reject null (422). */
export interface TaskPatchIn {
  title?: string | null;
  description?: string | null;
  category?: TaskCategory | null;
  priority?: Priority | null;
  department_id?: UUID | null;
  truck_id?: UUID | null;
  load_ref?: string | null;
  due_at?: ISODateTime | null;
  issue_type?: string | null;
  amount?: number | null;
  trailer_ref?: string | null;
  driver_name?: string | null;
  next_action_at?: ISODateTime | null;
}

export interface TransitionIn {
  to_status: TaskStatus;
  reason?: string | null;
  assignee_id?: UUID | null;
}

export interface AssignIn {
  assignee_id: UUID;
}

export interface CommentIn {
  text: string;
}

export interface MergeIn {
  into_task_id: UUID;
  reason?: string | null;
}

// --------------------------------------------------------------------------- dashboard

export interface DepartmentLoad {
  department_id: UUID | null;
  code: string;
  name: string;
  open: number;
  overdue: number;
}

export interface DashboardSummary {
  connected_groups: number;
  enabled_groups: number;
  pending_groups: number;
  open_tasks: number;
  overdue: number;
  needs_review: number;
  pending_verification: number;
  completed_today: number;
  created_today: number;
  by_department: DepartmentLoad[];
  by_priority: Record<string, number>;
  by_status: Record<string, number>;
}

/** GET /api/dashboard/badges: sidebar counts, scoped to what the user may see. */
export interface BadgesOut {
  needs_review: number;
  overdue: number;
  my_open: number;
  pending_groups: number;
  /** messages waiting for a human reply */
  unanswered: number;
  /** more than 5 minutes without a reply */
  overdue_responses: number;
  /** handovers waiting for me to accept */
  pending_handovers: number;
}

/** One company-time-zone day of GET /api/dashboard/trend. */
export interface TrendDay {
  /** YYYY-MM-DD in the company time zone */
  date: string;
  created: number;
  completed: number;
  ai_created: number;
}

export interface TrendOut {
  days: TrendDay[];
}

export interface ActivityTask {
  id: UUID;
  code: string;
  title: string;
  i18n: Partial<Record<Language, TaskTranslation>>;
  priority: Priority;
  status: TaskStatus;
}

/** GET /api/dashboard/activity item (newest first). type/actor_kind as on the task timeline. */
export interface ActivityOut {
  id: UUID;
  type: string;
  created_at: ISODateTime;
  actor_kind: string;
  actor_name: string | null;
  from_status: TaskStatus | null;
  to_status: TaskStatus | null;
  reason: string | null;
  data: Record<string, unknown>;
  task: ActivityTask;
}

/** GET /api/dashboard/ai: the last window_days of AI work. */
export interface AIStatsOut {
  window_days: number;
  messages_analyzed: number;
  model_calls: number;
  failed_calls: number;
  avg_latency_ms: number | null;
  ai_tasks: number;
  approved: number;
  rejected: number;
  pending_review: number;
  avg_confidence: number | null;
}

// --------------------------------------------------------------------------- misc

/** GET /api/notifications/unread-count */
export interface UnreadCountOut {
  unread: number;
}

export interface NotificationOut {
  id: UUID;
  kind: string;
  title: string;
  body: string | null;
  task_id: UUID | null;
  status: string;
  created_at: ISODateTime;
  read_at: ISODateTime | null;
}

export interface ExtractionOut {
  id: UUID;
  group_id: UUID | null;
  message_ids: unknown[];
  model: string;
  prompt_version: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  latency_ms: number | null;
  tasks_created: number;
  updates_applied: number;
  error: string | null;
  raw_output: Record<string, unknown> | null;
  created_at: ISODateTime;
}

export interface AuditOut {
  id: UUID;
  actor_kind: string;
  actor_user_id: UUID | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: ISODateTime;
}

export interface MetaOut {
  statuses: string[];
  open_statuses: string[];
  categories: string[];
  priorities: string[];
  roles: string[];
  group_kinds: string[];
  transitions: Record<string, string[]>;
}

// --------------------------------------------------------------------------- errors & query params

/** Error body raised by the backend: {"detail": {"code", "message"}}. */
export interface ApiErrorDetail {
  code: string;
  message: string;
}

/** FastAPI's default request-validation error item (422). */
export interface ValidationErrorItem {
  loc: (string | number)[];
  msg: string;
  type: string;
}

export interface ApiErrorBody {
  detail: ApiErrorDetail | ValidationErrorItem[] | string;
}

/** Sort keys accepted by GET /api/tasks (routes/tasks.py SORTS). */
export const TASK_SORTS = ["created_desc", "created_asc", "due_asc", "priority", "updated_desc"] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** Query parameters of GET /api/tasks. */
export interface TaskListQuery {
  status?: TaskStatus[];
  open?: boolean;
  overdue?: boolean;
  category?: TaskCategory[];
  priority?: Priority[];
  department_id?: UUID;
  /** tasks with no department (the dashboard "Not routed" row) */
  unrouted?: boolean;
  truck_id?: UUID;
  group_id?: UUID;
  assignee_id?: UUID;
  mine?: boolean;
  source?: TaskSource;
  q?: string;
  sort?: TaskSort;
  /** 1..200, default 50 */
  limit?: number;
  offset?: number;
}

export interface NotificationsQuery {
  unread_only?: boolean;
  limit?: number;
}

export interface UsersQuery {
  department_id?: UUID;
  /** default true; false returns inactive users as well */
  active?: boolean;
}

export interface GroupsQuery {
  enabled?: boolean;
}

// =========================================================================== CRM (backend/app/api/schemas_crm.py)

export type Source = "telegram" | "email";

export interface CompanyRef {
  id: UUID;
  name: string;
}

export interface MailboxRef {
  id: UUID;
  email_address: string;
}

export interface Ref {
  id: UUID;
  full_name: string;
}

export interface TaskBrief {
  id: UUID;
  code: string;
  title: string;
  i18n: Partial<Record<Language, TaskTranslation>>;
  status: TaskStatus;
  priority: Priority;
}

// --------------------------------------------------------------------------- companies / owner view

export interface CompanyOut {
  id: UUID;
  name: string;
  timezone: string;
  is_home: boolean;
  telegram_groups: number;
  mailboxes: number;
}

export interface CompanyCreateIn {
  name: string;
  timezone?: string;
}

export interface CompanyStats {
  company_id: UUID;
  name: string;
  telegram_groups: number;
  gmail_accounts: number;
  /** waiting for a human reply, 0-5 min */
  unanswered: number;
  /** no reply after 5 min */
  overdue_responses: number;
  open_issues: number;
  resolved_24h: number;
  escalations_24h: number;
  median_response_seconds_24h: number | null;
  within_sla_pct_24h: number | null;
}

export interface OwnerOverviewOut {
  companies: number;
  telegram_groups: number;
  gmail_accounts: number;
  unanswered: number;
  overdue_responses: number;
  open_issues: number;
  resolved_24h: number;
  escalations_24h: number;
  per_company: CompanyStats[];
}

// --------------------------------------------------------------------------- response clocks / inbox

export type ClockStatus = "pending" | "answered" | "not_needed";
export type SenderKind = "staff" | "external" | "bot" | "automated";

export interface ClockOut {
  id: UUID;
  status: ClockStatus;
  started_at: ISODateTime;
  due_at: ISODateTime;
  /** negative when overdue (only meaningful while pending) */
  seconds_left: number;
  /** 0 none, 1 team reminded (3 min), 2 supervisor (5 min), 3 manager/owner (10 min) */
  level: number;
  critical: boolean;
  answered_at: ISODateTime | null;
  answered_by_name: string | null;
  response_seconds: number | null;
  closed_reason: string | null;
}

export interface InboxMessageBrief {
  id: UUID;
  sender_name: string;
  sender_kind: SenderKind;
  direction: "inbound" | "outbound";
  preview: string;
  sent_at: ISODateTime;
}

export interface ConversationOut {
  /** thread key: tg:<group id> | mail:<mailbox id>:<thread id> */
  key: string;
  source: Source;
  channel_id: UUID;
  channel_name: string;
  department: DepartmentRef | null;
  subject: string | null;
  last_message: InboxMessageBrief;
  unanswered: number;
  oldest_pending: ClockOut | null;
  task: TaskBrief | null;
  updated_at: ISODateTime;
}

export interface ThreadMessageOut {
  id: UUID;
  direction: "inbound" | "outbound";
  sender_name: string;
  sender_kind: SenderKind;
  classification: string | null;
  subject: string | null;
  text: string | null;
  transcript: string | null;
  sent_at: ISODateTime;
  telegram_link: string | null;
  attachments: AttachmentOut[];
  clock: ClockOut | null;
  task_codes: string[];
}

export interface ThreadOut {
  key: string;
  source: Source;
  channel_id: UUID;
  channel_name: string;
  subject: string | null;
  department: DepartmentRef | null;
  messages: ThreadMessageOut[];
  tasks: TaskOut[];
}

export interface NoResponseIn {
  reason: string;
}

export interface MessageToTaskIn {
  title?: string | null;
  category?: TaskCategory;
  priority?: Priority;
}

export interface LinkMessageIn {
  message_id: UUID;
}

export type InboxState = "all" | "unanswered" | "overdue" | "answered";

export interface InboxQuery {
  source?: "all" | Source;
  state?: InboxState;
  department_id?: UUID;
  q?: string;
  limit?: number;
}

// --------------------------------------------------------------------------- response dashboard

export interface ResponseTrendDay {
  date: string;
  /** messages that needed a reply */
  inbound: number;
  answered: number;
  /** answered within 5 minutes */
  within_sla: number;
  median_seconds: number | null;
}

export interface DepartmentResponse {
  department_id: UUID | null;
  code: string;
  name: string;
  unanswered: number;
  overdue: number;
}

export interface ResponseStatsOut {
  unanswered_0_5: number;
  overdue_5_plus: number;
  escalated_10_plus: number;
  answered_today: number;
  median_response_seconds_today: number | null;
  within_sla_pct_today: number | null;
  trend: ResponseTrendDay[];
  by_department: DepartmentResponse[];
}

// --------------------------------------------------------------------------- escalations

export type EscalationKind = "reminder" | "overdue" | "escalated" | "critical" | "manual";

export interface EscalationClockBrief {
  id: UUID;
  channel_name: string;
  sender_name: string | null;
  preview: string | null;
}

export interface EscalationOut {
  id: UUID;
  created_at: ISODateTime;
  level: number;
  kind: EscalationKind;
  reason: string | null;
  notified_names: string[];
  clock: EscalationClockBrief | null;
  task: TaskBrief | null;
}

export interface EscalateIn {
  reason: string;
}

/** Mockup: "Message answered: Yes (10:26 AM)" next to "Issue resolved: No". */
export interface TaskResponseInfo {
  /** null when no source message needed a reply */
  message_answered: boolean | null;
  answered_at: ISODateTime | null;
  answered_by_name: string | null;
  response_seconds: number | null;
  pending: ClockOut | null;
}

// --------------------------------------------------------------------------- shifts / handovers

export interface ShiftOut {
  id: UUID;
  started_at: ISODateTime;
  ended_at: ISODateTime | null;
  status: "active" | "ended";
}

export interface HandoverOut {
  id: UUID;
  from_user: Ref;
  to_user: Ref;
  status: "pending" | "accepted" | "declined";
  note: string | null;
  task_count: number;
  tasks: TaskBrief[];
  created_at: ISODateTime;
  responded_at: ISODateTime | null;
}

export interface MyShiftOut {
  active: ShiftOut | null;
  open_tasks: number;
  incoming_handovers: HandoverOut[];
  outgoing_pending: HandoverOut[];
}

export interface ShiftEndIn {
  handover_to_user_id?: UUID | null;
  note?: string | null;
}

export interface ShiftEndOut {
  shift: ShiftOut;
  handover: HandoverOut | null;
}

export interface OnDutyUser {
  user_id: UUID;
  full_name: string;
  since: ISODateTime;
}

export interface CoverageOut {
  department_id: UUID;
  code: string;
  name: string;
  on_duty: OnDutyUser[];
  open_issues: number;
  unanswered: number;
  /** nobody on duty but the department has monitored channels */
  gap: boolean;
}

// --------------------------------------------------------------------------- integrations

export interface MailboxOut {
  id: UUID;
  email_address: string;
  display_name: string | null;
  department: DepartmentRef | null;
  status: "connected" | "error" | "disconnected";
  is_enabled: boolean;
  last_sync_at: ISODateTime | null;
  last_error: string | null;
  message_count: number;
  unanswered: number;
  supervisor_id: UUID | null;
  manager_id: UUID | null;
  backup_id: UUID | null;
}

/** Fields left out are unchanged; null on is_enabled is a 422. */
export interface MailboxPatchIn {
  is_enabled?: boolean | null;
  department_id?: UUID | null;
  supervisor_id?: UUID | null;
  manager_id?: UUID | null;
  backup_id?: UUID | null;
}

export interface GmailConnectIn {
  department_id?: UUID | null;
}

export interface GmailConnectOut {
  auth_url: string;
}

export interface TelegramStatus {
  connected: boolean;
  bot_username: string | null;
  mode: string;
  groups_enabled: number;
  groups_pending: number;
}

export interface GmailStatus {
  /** GOOGLE_CLIENT_ID / SECRET present on the server */
  configured: boolean;
  mailboxes: MailboxOut[];
}

export interface TmsStatus {
  loads: number;
  last_import_at: ISODateTime | null;
}

export interface IntegrationsOut {
  telegram: TelegramStatus;
  gmail: GmailStatus;
  tms: TmsStatus;
}

export interface LoadOut {
  id: UUID;
  load_ref: string;
  truck_unit: string | null;
  trailer_ref: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  broker: string | null;
  status: string | null;
  pickup: string | null;
  delivery: string | null;
  open_issues: number;
}

export interface LoadImportIn {
  csv: string;
}

export interface LoadImportOut {
  created: number;
  updated: number;
  errors: string[];
}

// --------------------------------------------------------------------------- staff roster

export interface TelegramIdentityOut {
  id: UUID;
  tg_user_id: number;
  display_name: string;
  username: string | null;
  is_staff: boolean;
  linked_user: Ref | null;
  last_seen_at: ISODateTime | null;
  message_count: number;
}

/** Fields left out are unchanged; null on is_staff is a 422. */
export interface TelegramIdentityPatchIn {
  is_staff?: boolean | null;
  linked_user_id?: UUID | null;
}
