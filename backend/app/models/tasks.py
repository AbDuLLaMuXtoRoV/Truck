import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import (
    ActorKind,
    Priority,
    TaskCategory,
    TaskEventType,
    TaskMessageRelation,
    TaskSource,
    TaskStatus,
)
from app.models.base import Base, CreatedMixin, IdMixin, TenantMixin, TimestampMixin, utcnow


class Task(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("company_id", "number"),
        Index("ix_tasks_company_status", "company_id", "status"),
        Index("ix_tasks_company_truck", "company_id", "truck_id"),
        Index("ix_tasks_company_department", "company_id", "department_id"),
        Index("ix_tasks_due_at", "due_at"),
    )

    number: Mapped[int]
    title: Mapped[str] = mapped_column(String(200))  # canonical (English for AI tasks)
    description: Mapped[str | None] = mapped_column(Text)
    # Localised copies: {"uz": {"title": ..., "summary": ...}, "ru": {...}}
    i18n: Mapped[dict[str, Any]] = mapped_column(default=dict)
    category: Mapped[TaskCategory] = mapped_column(String(32), default=TaskCategory.OTHER)
    priority: Mapped[Priority] = mapped_column(String(4), default=Priority.P3)
    status: Mapped[TaskStatus] = mapped_column(String(32), default=TaskStatus.DETECTED)

    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    truck_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trucks.id", ondelete="SET NULL"))
    truck_unit_raw: Mapped[str | None] = mapped_column(String(32))  # AI-extracted unit not in the trucks table
    driver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("drivers.id", ondelete="SET NULL"))
    load_ref: Mapped[str | None] = mapped_column(String(64))  # until `loads` exists (Phase 2)

    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    verified_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    source: Mapped[TaskSource] = mapped_column(String(32), default=TaskSource.MANUAL)
    confidence: Mapped[float | None] = mapped_column(Float)
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("telegram_groups.id", ondelete="SET NULL"))
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"))
    # Snapshot: Telegram never tells us about deletions [A3]
    source_text: Mapped[str | None] = mapped_column(Text)

    due_at: Mapped[datetime | None]
    reminded_at: Mapped[datetime | None]
    escalation_level: Mapped[int] = mapped_column(default=0)  # 0 none, 1 lead, 2 manager
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]
    cancelled_at: Mapped[datetime | None]
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    blocked_reason: Mapped[str | None] = mapped_column(Text)
    reopen_count: Mapped[int] = mapped_column(default=0)
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))

    @property
    def code(self) -> str:
        return f"T-{self.number}"

    def is_overdue(self, now: datetime | None = None) -> bool:
        """Overdue is a derived flag, not a status [C3]."""
        from app.domain.enums import OPEN_STATUSES

        now = now or utcnow()
        return self.due_at is not None and self.status in OPEN_STATUSES and self.due_at < now


class TaskMessage(Base):
    """Many-to-many: one task may come from several messages and vice versa [C7]."""

    __tablename__ = "task_messages"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)
    relation: Mapped[TaskMessageRelation] = mapped_column(String(16), default=TaskMessageRelation.SOURCE)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class TaskEvent(IdMixin, TenantMixin, CreatedMixin, Base):
    """Full task history: who, when, what, why (spec §5)."""

    __tablename__ = "task_events"
    __table_args__ = (Index("ix_task_events_task_created", "task_id", "created_at"),)

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    type: Mapped[TaskEventType] = mapped_column(String(32))
    from_status: Mapped[TaskStatus | None] = mapped_column(String(32))
    to_status: Mapped[TaskStatus | None] = mapped_column(String(32))
    actor_kind: Mapped[ActorKind] = mapped_column(String(16), default=ActorKind.USER)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(default=dict)

    actor: Mapped["User | None"] = relationship("User", lazy="joined")  # noqa: F821


class SlaPolicy(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "sla_policies"
    __table_args__ = (UniqueConstraint("company_id", "priority", "category"),)

    priority: Mapped[Priority] = mapped_column(String(4))
    category: Mapped[TaskCategory | None] = mapped_column(String(32))  # NULL = any category
    resolve_minutes: Mapped[int]
