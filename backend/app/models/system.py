import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import ActorKind, NotificationChannel, NotificationKind, NotificationStatus
from app.models.base import Base, CreatedMixin, IdMixin, TenantMixin


class Notification(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_status", "user_id", "status"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    channel: Mapped[NotificationChannel] = mapped_column(String(16), default=NotificationChannel.DASHBOARD)
    kind: Mapped[NotificationKind] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str | None] = mapped_column(Text)
    status: Mapped[NotificationStatus] = mapped_column(String(16), default=NotificationStatus.PENDING)
    sent_at: Mapped[datetime | None]
    read_at: Mapped[datetime | None]
    error: Mapped[str | None] = mapped_column(Text)


class AuditLog(IdMixin, CreatedMixin, Base):
    """Append-only. In production the app DB role gets INSERT/SELECT only on this table [D4]."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_entity", "entity_type", "entity_id"),)

    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    actor_kind: Mapped[ActorKind] = mapped_column(String(16), default=ActorKind.USER)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    before: Mapped[dict[str, Any] | None] = mapped_column()
    after: Mapped[dict[str, Any] | None] = mapped_column()
    ip: Mapped[str | None] = mapped_column(String(64))


class AIExtraction(IdMixin, TenantMixin, CreatedMixin, Base):
    """Every model call, for reproducibility and quality measurement [B10]."""

    __tablename__ = "ai_extractions"

    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("telegram_groups.id", ondelete="SET NULL"), index=True)
    message_ids: Mapped[list[Any]] = mapped_column(default=list)
    model: Mapped[str] = mapped_column(String(64))
    prompt_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # ok | refusal | error
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cache_read_tokens: Mapped[int | None]
    latency_ms: Mapped[int | None]
    request_id: Mapped[str | None] = mapped_column(String(128))
    raw_output: Mapped[dict[str, Any] | None] = mapped_column()
    error: Mapped[str | None] = mapped_column(Text)
    tasks_created: Mapped[int] = mapped_column(default=0)
    updates_applied: Mapped[int] = mapped_column(default=0)
