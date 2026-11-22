import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import (
    AnalysisStatus,
    AttachmentStatus,
    BotMembership,
    GroupKind,
    MessageKind,
    TranscriptStatus,
)
from app.models.base import Base, CreatedMixin, IdMixin, TenantMixin
from app.models.crm import EscalationPolicyMixin


class TelegramUser(IdMixin, TenantMixin, CreatedMixin, Base):
    """A Telegram identity seen in chats. Most drivers never get a portal account [C7]."""

    __tablename__ = "telegram_users"
    __table_args__ = (UniqueConstraint("company_id", "tg_user_id"),)

    tg_user_id: Mapped[int] = mapped_column(BigInteger)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str | None] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128))
    is_bot: Mapped[bool] = mapped_column(default=False)
    language_code: Mapped[str | None] = mapped_column(String(16))
    driver_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("drivers.id", ondelete="SET NULL"))
    # True once the user pressed Start in a private chat — only then can the bot DM them [A6]
    can_dm: Mapped[bool] = mapped_column(default=False)
    # Employee roster: replies from staff stop the 5-minute response clock (blueprint sec. 4)
    is_staff: Mapped[bool] = mapped_column(default=False)
    last_seen_at: Mapped[datetime | None]

    @property
    def display_name(self) -> str:
        name = " ".join(p for p in (self.first_name, self.last_name) if p)
        if self.username:
            return f"{name} (@{self.username})" if name else f"@{self.username}"
        return name or str(self.tg_user_id)


class TelegramGroup(IdMixin, TenantMixin, CreatedMixin, EscalationPolicyMixin, Base):
    __tablename__ = "telegram_groups"

    tg_chat_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    chat_type: Mapped[str] = mapped_column(String(32), default="group")
    kind: Mapped[GroupKind] = mapped_column(String(32), default=GroupKind.OTHER)
    truck_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trucks.id", ondelete="SET NULL"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )
    # Allow-list: messages are only stored for enabled groups [A9]
    is_enabled: Mapped[bool] = mapped_column(default=False)
    enabled_at: Mapped[datetime | None]
    enabled_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    bot_status: Mapped[BotMembership] = mapped_column(String(32), default=BotMembership.MEMBER)
    last_message_at: Mapped[datetime | None]
    # Lease so only one worker analyses a chat window at a time (works on Postgres and SQLite)
    analysis_lock_until: Mapped[datetime | None]


class Message(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("tg_chat_id", "tg_message_id"),
        UniqueConstraint("mailbox_id", "external_id"),
        Index("ix_messages_group_sent", "group_id", "sent_at"),
        Index("ix_messages_group_analysis", "group_id", "analysis_status"),
        Index("ix_messages_mailbox_analysis", "mailbox_id", "analysis_status"),
        Index("ix_messages_thread_sent", "thread_key", "sent_at"),
    )

    # Channel: a Telegram group OR a Gmail mailbox (blueprint sec. 6 channels)
    channel: Mapped[str] = mapped_column(String(16), default="telegram")  # telegram | email
    group_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("telegram_groups.id", ondelete="CASCADE"))
    mailbox_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mailboxes.id", ondelete="CASCADE"))
    thread_key: Mapped[str | None] = mapped_column(String(160))  # tg:<group> | mail:<mailbox>:<thread>
    external_id: Mapped[str | None] = mapped_column(String(255))  # Gmail message id
    thread_id: Mapped[str | None] = mapped_column(String(255))  # Gmail thread id
    subject: Mapped[str | None] = mapped_column(String(500))
    from_address: Mapped[str | None] = mapped_column(String(320))
    direction: Mapped[str] = mapped_column(String(16), default="inbound")  # inbound | outbound
    sender_kind: Mapped[str] = mapped_column(String(16), default="external")  # staff | external | bot | automated
    # actionable | informational | automated | duplicate | spam (AI or rules)
    classification: Mapped[str | None] = mapped_column(String(16))
    tg_chat_id: Mapped[int | None] = mapped_column(BigInteger)
    tg_message_id: Mapped[int | None] = mapped_column(BigInteger)
    tg_thread_id: Mapped[int | None] = mapped_column(BigInteger)
    media_group_id: Mapped[str | None] = mapped_column(String(64))
    reply_to_tg_message_id: Mapped[int | None] = mapped_column(BigInteger)
    sender_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("telegram_users.id", ondelete="SET NULL"))
    sent_at: Mapped[datetime]
    edited_at: Mapped[datetime | None]
    kind: Mapped[MessageKind] = mapped_column(String(16), default=MessageKind.TEXT)
    text: Mapped[str | None] = mapped_column(Text)  # text or caption
    transcript: Mapped[str | None] = mapped_column(Text)
    transcript_status: Mapped[TranscriptStatus] = mapped_column(String(16), default=TranscriptStatus.NOT_NEEDED)
    is_command: Mapped[bool] = mapped_column(default=False)
    analysis_status: Mapped[AnalysisStatus] = mapped_column(String(16), default=AnalysisStatus.PENDING)
    analyzed_at: Mapped[datetime | None]
    raw: Mapped[dict[str, Any]] = mapped_column(default=dict)

    sender: Mapped["TelegramUser | None"] = relationship(lazy="joined")
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="message", lazy="selectin")

    @property
    def content_for_ai(self) -> str:
        parts: list[str] = []
        if self.subject:
            parts.append(f"[email subject] {self.subject}")
        if self.text:
            parts.append(self.text)
        if self.transcript:
            parts.append(f"[voice transcript] {self.transcript}")
        for att in self.attachments:
            label = att.file_name or att.kind
            if att.extracted_text:
                parts.append(f"[{att.kind}: {label}] {att.extracted_text}")
            elif att.kind == MessageKind.VOICE and not self.transcript:
                dur = f", {att.duration_seconds}s" if att.duration_seconds else ""
                parts.append(f"[voice message{dur}, not transcribed]")
            else:
                parts.append(f"[{att.kind}: {label}]")
        return "\n".join(parts) if parts else "[empty]"


class MessageRevision(IdMixin, CreatedMixin, Base):
    """Edits arrive as edited_message; deletions never do [A3]."""

    __tablename__ = "message_revisions"

    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    previous_text: Mapped[str | None] = mapped_column(Text)
    new_text: Mapped[str | None] = mapped_column(Text)
    edited_at: Mapped[datetime]


class Attachment(IdMixin, TenantMixin, CreatedMixin, Base):
    __tablename__ = "attachments"

    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    kind: Mapped[MessageKind] = mapped_column(String(16))
    tg_file_id: Mapped[str | None] = mapped_column(String(255))
    tg_file_unique_id: Mapped[str | None] = mapped_column(String(128), index=True)
    source_ref: Mapped[str | None] = mapped_column(String(255))  # Gmail attachment id
    mime_type: Mapped[str | None] = mapped_column(String(128))
    file_name: Mapped[str | None] = mapped_column(String(255))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    duration_seconds: Mapped[int | None]
    status: Mapped[AttachmentStatus] = mapped_column(String(16), default=AttachmentStatus.PENDING)
    storage_key: Mapped[str | None] = mapped_column(String(512))
    extracted_text: Mapped[str | None] = mapped_column(Text)
    doc_type: Mapped[str | None] = mapped_column(String(32))  # bol, pod, invoice, dot_report, ...
    error: Mapped[str | None] = mapped_column(Text)

    message: Mapped["Message"] = relationship(back_populates="attachments")
