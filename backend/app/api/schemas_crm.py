"""API contract for the CRM blueprint features: unified inbox, 5-minute response SLA,
escalations, shifts & handovers, multi-company owner view, Gmail, TMS loads, staff roster.
Mirrored by frontend/lib/types.ts."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.api.schemas import AttachmentOut, DepartmentRef, TaskOut, _Patch
from app.domain.enums import Priority, TaskCategory, TaskStatus

Source = Literal["telegram", "email"]


class Ref(BaseModel):
    id: uuid.UUID
    full_name: str


class TaskBrief(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    i18n: dict[str, dict[str, str | None]] = {}
    status: TaskStatus
    priority: Priority


# --------------------------------------------------------------------------- companies / owner view
class CompanyOut(BaseModel):
    id: uuid.UUID
    name: str
    timezone: str
    is_home: bool
    telegram_groups: int = 0
    mailboxes: int = 0


class CompanyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    timezone: str = "America/Chicago"


class CompanyStats(BaseModel):
    company_id: uuid.UUID
    name: str
    telegram_groups: int
    gmail_accounts: int
    unanswered: int  # waiting for a human reply, 0-5 min
    overdue_responses: int  # no reply after 5 min
    open_issues: int
    resolved_24h: int
    escalations_24h: int
    median_response_seconds_24h: int | None = None
    within_sla_pct_24h: float | None = None


class OwnerOverviewOut(BaseModel):
    companies: int
    telegram_groups: int
    gmail_accounts: int
    unanswered: int
    overdue_responses: int
    open_issues: int
    resolved_24h: int
    escalations_24h: int
    per_company: list[CompanyStats]


# --------------------------------------------------------------------------- response clocks / inbox
class ClockOut(BaseModel):
    id: uuid.UUID
    status: Literal["pending", "answered", "not_needed"]
    started_at: datetime
    due_at: datetime
    seconds_left: int  # negative when overdue (only meaningful while pending)
    level: int  # 0 none, 1 team reminded (3 min), 2 supervisor (5 min), 3 manager/owner (10 min)
    critical: bool
    answered_at: datetime | None = None
    answered_by_name: str | None = None
    response_seconds: int | None = None
    closed_reason: str | None = None


class InboxMessageBrief(BaseModel):
    id: uuid.UUID
    sender_name: str
    sender_kind: Literal["staff", "external", "bot", "automated"]
    direction: Literal["inbound", "outbound"]
    preview: str
    sent_at: datetime


class ConversationOut(BaseModel):
    key: str  # thread key: tg:<group id> | mail:<mailbox id>:<thread id>
    source: Source
    channel_id: uuid.UUID
    channel_name: str
    department: DepartmentRef | None = None
    subject: str | None = None
    last_message: InboxMessageBrief
    unanswered: int
    oldest_pending: ClockOut | None = None
    task: TaskBrief | None = None
    updated_at: datetime


class ThreadMessageOut(BaseModel):
    id: uuid.UUID
    direction: Literal["inbound", "outbound"]
    sender_name: str
    sender_kind: Literal["staff", "external", "bot", "automated"]
    classification: str | None = None
    subject: str | None = None
    text: str | None = None
    transcript: str | None = None
    sent_at: datetime
    telegram_link: str | None = None
    attachments: list[AttachmentOut] = []
    clock: ClockOut | None = None
    task_codes: list[str] = []


class ThreadOut(BaseModel):
    key: str
    source: Source
    channel_id: uuid.UUID
    channel_name: str
    subject: str | None = None
    department: DepartmentRef | None = None
    messages: list[ThreadMessageOut]
    tasks: list[TaskOut]


class NoResponseIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


class MessageToTaskIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    category: TaskCategory = TaskCategory.OTHER
    priority: Priority = Priority.P3


class LinkMessageIn(BaseModel):
    message_id: uuid.UUID


# --------------------------------------------------------------------------- response dashboard
class ResponseTrendDay(BaseModel):
    date: str
    inbound: int  # messages that needed a reply
    answered: int
    within_sla: int  # answered within 5 minutes
    median_seconds: int | None = None


class DepartmentResponse(BaseModel):
    department_id: uuid.UUID | None
    code: str
    name: str
    unanswered: int
    overdue: int


class ResponseStatsOut(BaseModel):
    unanswered_0_5: int
    overdue_5_plus: int
    escalated_10_plus: int
    answered_today: int
    median_response_seconds_today: int | None = None
    within_sla_pct_today: float | None = None
    trend: list[ResponseTrendDay]
    by_department: list[DepartmentResponse]


# --------------------------------------------------------------------------- escalations
class EscalationClockBrief(BaseModel):
    id: uuid.UUID
    channel_name: str
    sender_name: str | None = None
    preview: str | None = None


class EscalationOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    level: int
    kind: Literal["reminder", "overdue", "escalated", "critical", "manual"]
    reason: str | None = None
    notified_names: list[str] = []
    clock: EscalationClockBrief | None = None
    task: TaskBrief | None = None


class EscalateIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class TaskResponseInfo(BaseModel):
    """Mockup: "Message answered: Yes (10:26 AM)" next to "Issue resolved: No"."""

    message_answered: bool | None  # None when no source message needed a reply
    answered_at: datetime | None = None
    answered_by_name: str | None = None
    response_seconds: int | None = None
    pending: ClockOut | None = None


# --------------------------------------------------------------------------- shifts / handovers
class ShiftOut(BaseModel):
    id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None = None
    status: Literal["active", "ended"]


class HandoverOut(BaseModel):
    id: uuid.UUID
    from_user: Ref
    to_user: Ref
    status: Literal["pending", "accepted", "declined"]
    note: str | None = None
    task_count: int
    tasks: list[TaskBrief] = []
    created_at: datetime
    responded_at: datetime | None = None


class MyShiftOut(BaseModel):
    active: ShiftOut | None = None
    open_tasks: int
    incoming_handovers: list[HandoverOut]
    outgoing_pending: list[HandoverOut]


class ShiftEndIn(BaseModel):
    handover_to_user_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=2000)


class ShiftEndOut(BaseModel):
    shift: ShiftOut
    handover: HandoverOut | None = None


class OnDutyUser(BaseModel):
    user_id: uuid.UUID
    full_name: str
    since: datetime


class CoverageOut(BaseModel):
    department_id: uuid.UUID
    code: str
    name: str
    on_duty: list[OnDutyUser]
    open_issues: int
    unanswered: int
    gap: bool  # nobody on duty but the department has monitored channels


# --------------------------------------------------------------------------- integrations
class MailboxOut(BaseModel):
    id: uuid.UUID
    email_address: str
    display_name: str | None = None
    department: DepartmentRef | None = None
    status: Literal["connected", "error", "disconnected"]
    is_enabled: bool
    last_sync_at: datetime | None = None
    last_error: str | None = None
    message_count: int = 0
    unanswered: int = 0
    supervisor_id: uuid.UUID | None = None
    manager_id: uuid.UUID | None = None
    backup_id: uuid.UUID | None = None


class MailboxPatchIn(_Patch):
    non_nullable = ("is_enabled",)

    is_enabled: bool | None = None
    department_id: uuid.UUID | None = None
    supervisor_id: uuid.UUID | None = None
    manager_id: uuid.UUID | None = None
    backup_id: uuid.UUID | None = None


class GmailConnectIn(BaseModel):
    department_id: uuid.UUID | None = None


class GmailConnectOut(BaseModel):
    auth_url: str


class TelegramStatus(BaseModel):
    connected: bool
    bot_username: str | None
    mode: str
    groups_enabled: int
    groups_pending: int


class GmailStatus(BaseModel):
    configured: bool  # GOOGLE_CLIENT_ID / SECRET present
    mailboxes: list[MailboxOut]


class TmsStatus(BaseModel):
    loads: int
    last_import_at: datetime | None = None


class IntegrationsOut(BaseModel):
    telegram: TelegramStatus
    gmail: GmailStatus
    tms: TmsStatus


class LoadOut(BaseModel):
    id: uuid.UUID
    load_ref: str
    truck_unit: str | None = None
    trailer_ref: str | None = None
    driver_name: str | None = None
    driver_phone: str | None = None
    broker: str | None = None
    status: str | None = None
    pickup: str | None = None
    delivery: str | None = None
    open_issues: int = 0


class LoadImportIn(BaseModel):
    csv: str = Field(min_length=1, max_length=5_000_000)


class LoadImportOut(BaseModel):
    created: int
    updated: int
    errors: list[str]


# --------------------------------------------------------------------------- staff roster
class TelegramIdentityOut(BaseModel):
    id: uuid.UUID
    tg_user_id: int
    display_name: str
    username: str | None = None
    is_staff: bool
    linked_user: Ref | None = None
    last_seen_at: datetime | None = None
    message_count: int = 0


class TelegramIdentityPatchIn(_Patch):
    non_nullable = ("is_staff",)

    is_staff: bool | None = None
    linked_user_id: uuid.UUID | None = None
