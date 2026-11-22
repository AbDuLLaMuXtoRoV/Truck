"""CRM blueprint additions: Gmail mailboxes, 5-minute response clocks, shifts & handovers,
TMS loads and cross-company access (Unified Trucking Communications CRM v1.0)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin, IdMixin, TenantMixin


class UserCompanyAccess(IdMixin, CreatedMixin, Base):
    """Audited cross-company access for owners / executives (blueprint §2 role-based views)."""

    __tablename__ = "user_company_access"
    __table_args__ = (UniqueConstraint("user_id", "company_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"))
    granted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class EscalationPolicyMixin:
    """Who is escalated to for a channel (blueprint §6 escalation_policies). Empty = department
    lead (supervisor) / company managers / owners."""

    supervisor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL", use_alter=True))
    manager_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL", use_alter=True))
    backup_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL", use_alter=True))


class Mailbox(IdMixin, TenantMixin, CreatedMixin, EscalationPolicyMixin, Base):
    """A connected Gmail / Google Workspace inbox (blueprint §5)."""

    __tablename__ = "mailboxes"
    __table_args__ = (UniqueConstraint("company_id", "email_address"),)

    email_address: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str | None] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(16), default="gmail")
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    is_enabled: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(String(16), default="connected")  # connected | error | disconnected
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    access_token_enc: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None]
    history_id: Mapped[str | None] = mapped_column(String(64))
    watch_expires_at: Mapped[datetime | None]
    last_sync_at: Mapped[datetime | None]
    last_error: Mapped[str | None] = mapped_column(Text)
    connected_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    analysis_lock_until: Mapped[datetime | None]


class ResponseClock(IdMixin, TenantMixin, CreatedMixin, Base):
    """5-minute human-response SLA for one inbound message (blueprint §7).

    Only an authorised human reply stops it; bot, AI and auto-replies never do."""

    __tablename__ = "response_clocks"
    __table_args__ = (
        Index("ix_response_clocks_company_status", "company_id", "status"),
        Index("ix_response_clocks_thread_status", "thread_key", "status"),
    )

    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), unique=True)
    thread_key: Mapped[str] = mapped_column(String(160))
    channel: Mapped[str] = mapped_column(String(16))  # telegram | email
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("telegram_groups.id", ondelete="CASCADE"))
    mailbox_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mailboxes.id", ondelete="CASCADE"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    sender_key: Mapped[str | None] = mapped_column(String(64))  # telegram user id / email address
    sender_name: Mapped[str | None] = mapped_column(String(200))
    preview: Mapped[str | None] = mapped_column(String(300))
    started_at: Mapped[datetime]  # source message time (when trustworthy)
    received_at: Mapped[datetime]  # when we ingested it
    ingest_delay_seconds: Mapped[int] = mapped_column(default=0)
    due_at: Mapped[datetime]
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | answered | not_needed
    level: Mapped[int] = mapped_column(default=0)  # 0 none, 1 team reminded, 2 supervisor, 3 manager/owner
    critical: Mapped[bool] = mapped_column(Boolean, default=False)
    answered_at: Mapped[datetime | None]
    answered_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    answered_by_name: Mapped[str | None] = mapped_column(String(200))
    answer_message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"))
    response_seconds: Mapped[int | None]
    closed_reason: Mapped[str | None] = mapped_column(String(200))
    closed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), index=True)


class ResponseEscalation(IdMixin, TenantMixin, CreatedMixin, Base):
    """One step of the 3 / 5 / 10-minute ladder (or a manual escalation)."""

    __tablename__ = "response_escalations"

    clock_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("response_clocks.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    level: Mapped[int]  # 1 reminder, 2 supervisor, 3 manager/owner; 9 manual
    kind: Mapped[str] = mapped_column(String(32))  # reminder | overdue | escalated | critical | manual
    notified_user_ids: Mapped[list[Any]] = mapped_column(default=list)
    notified_names: Mapped[list[Any]] = mapped_column(default=list)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reason: Mapped[str | None] = mapped_column(Text)


class Shift(IdMixin, TenantMixin, CreatedMixin, Base):
    """On-duty roster / check-in (blueprint §2 shift coverage)."""

    __tablename__ = "shifts"
    __table_args__ = (Index("ix_shifts_company_status", "company_id", "status"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    started_at: Mapped[datetime]
    ended_at: Mapped[datetime | None]
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | ended


class Handover(IdMixin, TenantMixin, CreatedMixin, Base):
    """Shift handover: open cases keep their owner until the incoming person accepts (blueprint §7)."""

    __tablename__ = "handovers"

    from_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    to_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | accepted | declined
    note: Mapped[str | None] = mapped_column(Text)
    task_ids: Mapped[list[Any]] = mapped_column(default=list)
    responded_at: Mapped[datetime | None]
    alerted_at: Mapped[datetime | None]


class Load(IdMixin, TenantMixin, CreatedMixin, Base):
    """Load from the TMS (CSV import now; vendor API adapter later) for cross-channel matching."""

    __tablename__ = "loads"
    __table_args__ = (UniqueConstraint("company_id", "load_ref"),)

    load_ref: Mapped[str] = mapped_column(String(64))
    truck_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trucks.id", ondelete="SET NULL"))
    truck_unit: Mapped[str | None] = mapped_column(String(32))
    trailer_ref: Mapped[str | None] = mapped_column(String(32))
    driver_name: Mapped[str | None] = mapped_column(String(120))
    driver_phone: Mapped[str | None] = mapped_column(String(40))
    broker: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str | None] = mapped_column(String(40))
    pickup: Mapped[str | None] = mapped_column(String(200))
    delivery: Mapped[str | None] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(16), default="csv")
    updated_at: Mapped[datetime | None]
