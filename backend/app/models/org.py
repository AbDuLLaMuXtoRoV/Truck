import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import Role
from app.models.base import Base, CreatedMixin, IdMixin, TenantMixin


class Company(IdMixin, CreatedMixin, Base):
    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(String(200))
    # Operating timezone used for deadlines and "completed today" [C9]
    timezone: Mapped[str] = mapped_column(String(64), default="America/Chicago")
    task_seq: Mapped[int] = mapped_column(default=0)
    # e.g. {"four_eyes": true}
    settings: Mapped[dict[str, Any]] = mapped_column(default=dict)


class Department(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("company_id", "code"),)

    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(120))
    lead_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", use_alter=True)
    )
    # On-duty person used for auto-assignment when enabled [B5]
    default_assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", use_alter=True)
    )
    coverage_alerted_at: Mapped[datetime | None]  # last "nobody on duty" alert


class User(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(254), unique=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[Role] = mapped_column(String(32), default=Role.AGENT)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )
    is_active: Mapped[bool] = mapped_column(default=True)
    # UI + notification language: uz (Latin) | ru | en
    language: Mapped[str] = mapped_column(String(8), default="uz")
    last_login_at: Mapped[datetime | None]

    # Telegram account link via t.me/<bot>?start=<token> [A6]
    telegram_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("telegram_users.id", ondelete="SET NULL")
    )
    tg_link_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    tg_link_token_expires_at: Mapped[datetime | None]

    department: Mapped["Department | None"] = relationship(foreign_keys=[department_id], lazy="joined")
