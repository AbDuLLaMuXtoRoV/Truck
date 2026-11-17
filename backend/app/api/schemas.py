"""API contract (also consumed by the Next.js dashboard — see frontend/lib/types.ts)."""

import uuid
from datetime import datetime
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.domain.enums import (
    BotMembership,
    GroupKind,
    Priority,
    Role,
    TaskCategory,
    TaskSource,
    TaskStatus,
)


Lang = Literal["uz", "ru", "en"]


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class _Patch(BaseModel):
    """PATCH body: omitted fields are unchanged. Fields listed in `non_nullable` may be omitted
    but not sent as null (their columns are NOT NULL)."""

    non_nullable: ClassVar[tuple[str, ...]] = ()

    @model_validator(mode="after")
    def _reject_nulls(self):
        bad = [f for f in self.non_nullable if f in self.model_fields_set and getattr(self, f) is None]
        if bad:
            raise ValueError(f"{', '.join(bad)} cannot be null")
        return self


# --------------------------------------------------------------------------- refs
class DepartmentRef(_Out):
    id: uuid.UUID
    code: str
    name: str


class TruckRef(_Out):
    id: uuid.UUID
    unit_number: str


class UserRef(_Out):
    id: uuid.UUID
    full_name: str
    role: Role
    department_id: uuid.UUID | None = None


class GroupRef(_Out):
    id: uuid.UUID
    title: str


# --------------------------------------------------------------------------- auth / users
class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class UserOut(UserRef):
    email: str
    is_active: bool
    telegram_linked: bool = False
    language: Lang = "uz"


class MeOut(UserOut):
    company_id: uuid.UUID
    company_name: str
    company_timezone: str
    permissions: list[str]


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: MeOut


class UserCreateIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=72)
    role: Role = Role.AGENT
    department_id: uuid.UUID | None = None
    language: Lang = "uz"


class UserPatchIn(_Patch):
    non_nullable = ("full_name", "role", "is_active", "language")

    language: Lang | None = None
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: Role | None = None
    department_id: uuid.UUID | None = None
    is_active: bool | None = None


class MePatchIn(_Patch):
    non_nullable = ("full_name", "language")

    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    language: Lang | None = None


class TelegramLinkOut(BaseModel):
    deep_link: str | None
    token: str
    expires_at: datetime


# --------------------------------------------------------------------------- fleet / org
class DepartmentOut(DepartmentRef):
    lead_user_id: uuid.UUID | None = None
    default_assignee_user_id: uuid.UUID | None = None


class DepartmentPatchIn(BaseModel):
    lead_user_id: uuid.UUID | None = None
    default_assignee_user_id: uuid.UUID | None = None


class TruckOut(TruckRef):
    vin: str | None = None
    plate: str | None = None
    is_active: bool
    open_tasks: int = 0
    overdue_tasks: int = 0


class TruckCreateIn(BaseModel):
    unit_number: str = Field(min_length=1, max_length=32)
    vin: str | None = Field(default=None, max_length=32)
    plate: str | None = Field(default=None, max_length=32)


# --------------------------------------------------------------------------- groups
class GroupOut(GroupRef):
    tg_chat_id: int
    chat_type: str
    kind: GroupKind
    truck: TruckRef | None = None
    department: DepartmentRef | None = None
    is_enabled: bool
    bot_status: BotMembership
    last_message_at: datetime | None = None
    created_at: datetime
    message_count: int = 0
    open_tasks: int = 0


class GroupPatchIn(_Patch):
    """Fields left out are unchanged; explicit null clears truck/department."""

    non_nullable = ("is_enabled", "kind")

    is_enabled: bool | None = None
    kind: GroupKind | None = None
    truck_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None


# --------------------------------------------------------------------------- tasks
class TaskOut(_Out):
    id: uuid.UUID
    code: str
    number: int
    title: str
    description: str | None = None
    # {"uz": {"title": ..., "summary": ...}, "ru": {...}} — empty for manual tasks
    i18n: dict[str, dict[str, str | None]] = {}
    category: TaskCategory
    priority: Priority
    status: TaskStatus
    is_overdue: bool
    department: DepartmentRef | None = None
    truck: TruckRef | None = None
    truck_unit_raw: str | None = None
    load_ref: str | None = None
    assignee: UserRef | None = None
    source: TaskSource
    confidence: float | None = None
    group: GroupRef | None = None
    due_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    reopen_count: int = 0
    escalation_level: int = 0
    cancel_reason: str | None = None
    blocked_reason: str | None = None
    merged_into_id: uuid.UUID | None = None


class TaskListOut(BaseModel):
    items: list[TaskOut]
    total: int


class TaskEventOut(_Out):
    id: uuid.UUID
    type: str
    from_status: TaskStatus | None = None
    to_status: TaskStatus | None = None
    actor_kind: str
    actor: UserRef | None = None
    reason: str | None = None
    data: dict[str, Any] = {}
    created_at: datetime


class AttachmentOut(_Out):
    id: uuid.UUID
    kind: str
    file_name: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    duration_seconds: int | None = None
    status: str


class MessageOut(BaseModel):
    id: uuid.UUID
    group: GroupRef
    sent_at: datetime
    edited_at: datetime | None = None
    sender_name: str
    kind: str
    text: str | None = None
    transcript: str | None = None
    transcript_status: str
    analysis_status: str
    telegram_link: str | None = None
    attachments: list[AttachmentOut] = []


class LinkedMessageOut(MessageOut):
    relation: str


class TaskDetailOut(TaskOut):
    source_text: str | None = None
    events: list[TaskEventOut]
    messages: list[LinkedMessageOut]
    allowed_transitions: list[TaskStatus]
    can_edit: bool
    can_assign: bool


class TaskCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    category: TaskCategory = TaskCategory.OTHER
    priority: Priority = Priority.P3
    department_id: uuid.UUID | None = None
    truck_id: uuid.UUID | None = None
    load_ref: str | None = Field(default=None, max_length=64)
    assignee_id: uuid.UUID | None = None
    due_at: datetime | None = None


class TaskPatchIn(_Patch):
    non_nullable = ("title", "category", "priority")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    category: TaskCategory | None = None
    priority: Priority | None = None
    department_id: uuid.UUID | None = None
    truck_id: uuid.UUID | None = None
    load_ref: str | None = Field(default=None, max_length=64)
    due_at: datetime | None = None


class TransitionIn(BaseModel):
    to_status: TaskStatus
    reason: str | None = Field(default=None, max_length=2000)
    assignee_id: uuid.UUID | None = None


class AssignIn(BaseModel):
    assignee_id: uuid.UUID


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class MergeIn(BaseModel):
    into_task_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=2000)


# --------------------------------------------------------------------------- dashboard
class DepartmentLoad(BaseModel):
    department_id: uuid.UUID | None
    code: str
    name: str
    open: int
    overdue: int


class DashboardSummary(BaseModel):
    connected_groups: int
    enabled_groups: int
    pending_groups: int
    open_tasks: int
    overdue: int
    needs_review: int
    pending_verification: int
    completed_today: int
    created_today: int
    by_department: list[DepartmentLoad]
    by_priority: dict[str, int]
    by_status: dict[str, int]


class BadgesOut(BaseModel):
    needs_review: int
    overdue: int
    my_open: int
    pending_groups: int


class TrendDay(BaseModel):
    date: str  # YYYY-MM-DD in the company time zone
    created: int
    completed: int
    ai_created: int


class TrendOut(BaseModel):
    days: list[TrendDay]


class ActivityTask(BaseModel):
    id: uuid.UUID
    code: str
    title: str
    i18n: dict[str, dict[str, str | None]] = {}
    priority: Priority
    status: TaskStatus


class ActivityOut(BaseModel):
    id: uuid.UUID
    type: str
    created_at: datetime
    actor_kind: str
    actor_name: str | None = None
    from_status: TaskStatus | None = None
    to_status: TaskStatus | None = None
    reason: str | None = None
    data: dict[str, Any] = {}
    task: ActivityTask


class AIStatsOut(BaseModel):
    window_days: int
    messages_analyzed: int
    model_calls: int
    failed_calls: int
    avg_latency_ms: int | None = None
    ai_tasks: int
    approved: int
    rejected: int
    pending_review: int
    avg_confidence: float | None = None


# --------------------------------------------------------------------------- misc
class NotificationOut(_Out):
    id: uuid.UUID
    kind: str
    title: str
    body: str | None = None
    task_id: uuid.UUID | None = None
    status: str
    created_at: datetime
    read_at: datetime | None = None


class ExtractionOut(_Out):
    id: uuid.UUID
    group_id: uuid.UUID | None
    message_ids: list[Any]
    model: str
    prompt_version: str
    status: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    latency_ms: int | None = None
    tasks_created: int
    updates_applied: int
    error: str | None = None
    raw_output: dict[str, Any] | None = None
    created_at: datetime


class AuditOut(_Out):
    id: uuid.UUID
    actor_kind: str
    actor_user_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime


class MetaOut(BaseModel):
    statuses: list[str]
    open_statuses: list[str]
    categories: list[str]
    priorities: list[str]
    roles: list[str]
    group_kinds: list[str]
    transitions: dict[str, list[str]]
