"""Telegram update -> database. Pure DB work, no network: the caller commits, then sends replies and
enqueues jobs from the returned IngestResult."""

import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.rbac import Actor
from app.domain.enums import (
    AnalysisStatus,
    AttachmentStatus,
    BotMembership,
    GroupKind,
    MessageKind,
    Priority,
    TaskCategory,
    TaskMessageRelation,
    TaskSource,
    TaskStatus,
    TranscriptStatus,
)
from app.domain.truck_refs import extract_truck_refs, normalize_unit
from app.i18n import group_text, norm_lang, t
from app.telegram.actions import handle_callback, linked_user, my_tasks
from app.models import (
    Attachment,
    Company,
    Department,
    Message,
    MessageRevision,
    TelegramGroup,
    TelegramUser,
    Truck,
    User,
    utcnow,
)
from app.services.audit import record_audit
from app.services.tasks import create_task

log = logging.getLogger(__name__)

CONTENT_KEYS = ("text", "caption", "voice", "audio", "video", "video_note", "photo", "document", "sticker", "location", "contact")


@dataclass
class OutboundReply:
    chat_id: int
    text: str
    reply_to_message_id: int | None = None
    thread_id: int | None = None


@dataclass
class IngestResult:
    action: str
    message_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None
    analyze_group_id: uuid.UUID | None = None
    download_attachment_ids: list[uuid.UUID] = field(default_factory=list)
    replies: list[OutboundReply] = field(default_factory=list)
    # Other Bot API calls to make after commit, e.g. answering a button tap: (method, params)
    telegram_calls: list[tuple[str, dict]] = field(default_factory=list)


def _ts(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, UTC) if value else None


async def _default_company(session: AsyncSession) -> Company | None:
    """Phase 1 is single-tenant: new groups belong to the (first) company. SaaS will claim groups
    with a /connect <code> command instead."""
    return await session.scalar(select(Company).order_by(Company.created_at).limit(1))


async def _group_by_chat(session: AsyncSession, chat_id: int) -> TelegramGroup | None:
    return await session.scalar(select(TelegramGroup).where(TelegramGroup.tg_chat_id == chat_id))


async def upsert_telegram_user(session: AsyncSession, company_id: uuid.UUID, frm: dict) -> TelegramUser:
    tg_user = await session.scalar(
        select(TelegramUser).where(TelegramUser.company_id == company_id, TelegramUser.tg_user_id == frm["id"])
    )
    if tg_user is None:
        tg_user = TelegramUser(id=uuid.uuid4(), company_id=company_id, tg_user_id=frm["id"])
        session.add(tg_user)
    tg_user.username = frm.get("username")
    tg_user.first_name = frm.get("first_name")
    tg_user.last_name = frm.get("last_name")
    tg_user.is_bot = bool(frm.get("is_bot"))
    tg_user.language_code = frm.get("language_code")
    tg_user.last_seen_at = utcnow()
    return tg_user


def _parse_command(text: str | None) -> tuple[str, str] | None:
    if not text or not text.startswith("/"):
        return None
    head, _, args = text.partition(" ")
    name, _, target = head[1:].partition("@")
    bot_username = get_settings().telegram_bot_username
    if target and bot_username and target.lower() != bot_username.lower():
        return None  # command addressed to another bot
    return name.lower(), args.strip()


def _extract_content(msg: dict) -> tuple[MessageKind, str | None, list[dict]]:
    """Returns (kind, text, attachment specs)."""
    text = msg.get("text") or msg.get("caption")
    specs: list[dict] = []

    def spec(kind: MessageKind, obj: dict, **extra) -> dict:
        return {
            "kind": kind,
            "tg_file_id": obj["file_id"],
            "tg_file_unique_id": obj.get("file_unique_id", obj["file_id"]),
            "mime_type": obj.get("mime_type"),
            "file_name": obj.get("file_name"),
            "file_size": obj.get("file_size"),
            "duration_seconds": obj.get("duration"),
            **extra,
        }

    if "voice" in msg:
        specs.append(spec(MessageKind.VOICE, msg["voice"]))
        return MessageKind.VOICE, text, specs
    if "audio" in msg:
        specs.append(spec(MessageKind.AUDIO, msg["audio"]))
        return MessageKind.AUDIO, text, specs
    if "video_note" in msg:
        specs.append(spec(MessageKind.VIDEO, msg["video_note"]))
        return MessageKind.VIDEO, text, specs
    if "video" in msg:
        specs.append(spec(MessageKind.VIDEO, msg["video"]))
        return MessageKind.VIDEO, text, specs
    if "photo" in msg and msg["photo"]:
        largest = max(msg["photo"], key=lambda p: (p.get("width", 0) * p.get("height", 0), p.get("file_size", 0)))
        specs.append(spec(MessageKind.PHOTO, largest, mime_type="image/jpeg"))
        return MessageKind.PHOTO, text, specs
    if "document" in msg:
        specs.append(spec(MessageKind.DOCUMENT, msg["document"]))
        return MessageKind.DOCUMENT, text, specs
    if "sticker" in msg:
        emoji = msg["sticker"].get("emoji")
        return MessageKind.STICKER, f"[sticker {emoji}]" if emoji else "[sticker]", specs
    if "location" in msg:
        loc = msg["location"]
        return MessageKind.OTHER, f"[location {loc['latitude']:.5f},{loc['longitude']:.5f}]", specs
    if "contact" in msg:
        c = msg["contact"]
        name = " ".join(p for p in (c.get("first_name"), c.get("last_name")) if p)
        return MessageKind.OTHER, f"[contact {name} {c.get('phone_number', '')}]".strip(), specs
    return MessageKind.TEXT, text, specs


_DEPT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "DISPATCH": ("dispatch", "dispetch", "диспетч"),
    "ELD": ("eld", "logbook", "hos "),
    "ACCOUNTING": ("accounting", "buxgalter", "бухгалтер", "billing", "settlement"),
    "FLEET": ("fleet", "maintenance", "repair", "remont", "ремонт", "shop"),
    "SAFETY": ("safety", "compliance", "xavfsizlik", "безопасн"),
    "HR": ("hr", "kadr", "кадр", "recruit"),
}


async def _new_group(session: AsyncSession, company: Company, chat: dict) -> TelegramGroup:
    """Create a group record — disabled until an admin approves it [A9] — with a suggested
    mapping from its title ("Truck 125 – Aziz" → truck 125, "Dispatch Team" → Dispatch)."""
    title = chat.get("title", "") or ""
    group = TelegramGroup(
        id=uuid.uuid4(),
        company_id=company.id,
        tg_chat_id=chat["id"],
        title=title,
        chat_type=chat.get("type", "group"),
        kind=GroupKind.OTHER,
        is_enabled=False,
    )
    units = extract_truck_refs(title)
    if units:
        trucks = (await session.scalars(select(Truck).where(Truck.company_id == company.id))).all()
        by_unit = {normalize_unit(t.unit_number): t for t in trucks}
        match = next((by_unit[u] for u in units if u in by_unit), None)
        if match is not None:
            group.kind, group.truck_id = GroupKind.TRUCK, match.id
    if group.truck_id is None:
        lowered = f" {title.lower()} "
        for code, words in _DEPT_KEYWORDS.items():
            if any(re.search(rf"(?<![\w]){re.escape(w.strip())}", lowered) for w in words):
                dept = await session.scalar(
                    select(Department).where(Department.company_id == company.id, Department.code == code)
                )
                if dept is not None:
                    group.department_id = dept.id
                    group.kind = GroupKind.DISPATCH if code == "DISPATCH" else GroupKind.DEPARTMENT
                break
    session.add(group)
    return group


# --------------------------------------------------------------------------- entry point


async def ingest_update(session: AsyncSession, update: dict) -> IngestResult:
    if "my_chat_member" in update:
        return await _handle_membership(session, update["my_chat_member"])
    if "message" in update:
        return await _handle_message(session, update["message"], edited=False)
    if "edited_message" in update:
        return await _handle_message(session, update["edited_message"], edited=True)
    if "callback_query" in update:
        calls = await handle_callback(session, update["callback_query"])
        return IngestResult("button", telegram_calls=calls.calls)
    return IngestResult("ignored")


async def _handle_membership(session: AsyncSession, upd: dict) -> IngestResult:
    chat = upd["chat"]
    if chat.get("type") not in ("group", "supergroup"):
        return IngestResult("ignored")
    company = await _default_company(session)
    if company is None:
        log.warning("No company configured; ignoring membership update for chat %s", chat["id"])
        return IngestResult("ignored")

    status = upd["new_chat_member"]["status"]
    bot_status = {
        "administrator": BotMembership.ADMINISTRATOR,
        "creator": BotMembership.ADMINISTRATOR,
        "member": BotMembership.MEMBER,
        "restricted": BotMembership.MEMBER,
        "kicked": BotMembership.KICKED,
    }.get(status, BotMembership.LEFT)

    group = await _group_by_chat(session, chat["id"])
    before = {"bot_status": group.bot_status} if group else None
    replies: list[OutboundReply] = []
    if group is None:
        group = await _new_group(session, company, chat)
        if bot_status in (BotMembership.MEMBER, BotMembership.ADMINISTRATOR):
            replies.append(OutboundReply(chat["id"], group_text("group_pending")))
    group.bot_status = bot_status
    group.title = chat.get("title", group.title)
    record_audit(
        session,
        None,
        "group.bot_membership",
        "telegram_group",
        group.id,
        before=before,
        after={"bot_status": bot_status.value, "by_tg_user": upd.get("from", {}).get("id")},
        company_id=group.company_id,
    )
    return IngestResult("membership", group_id=group.id, replies=replies)


async def _migrate(session: AsyncSession, old_chat_id: int, new_chat_id: int) -> TelegramGroup | None:
    """Group upgraded to supergroup: chat_id changes [A7]."""
    old = await _group_by_chat(session, old_chat_id)
    new = await _group_by_chat(session, new_chat_id)
    if old is None:
        return new
    if new is not None and new.id != old.id:
        count = await session.scalar(select(func.count()).select_from(Message).where(Message.group_id == new.id))
        if count:
            log.warning("Cannot migrate group %s -> %s: target already has messages", old_chat_id, new_chat_id)
            return new
        await session.delete(new)
        await session.flush()
    old.tg_chat_id = new_chat_id
    old.chat_type = "supergroup"
    record_audit(
        session, None, "group.migrated", "telegram_group", old.id,
        before={"tg_chat_id": old_chat_id}, after={"tg_chat_id": new_chat_id}, company_id=old.company_id,
    )
    return old


async def _handle_message(session: AsyncSession, msg: dict, *, edited: bool) -> IngestResult:
    chat = msg["chat"]
    chat_type = chat.get("type")
    if chat_type == "private":
        return await _handle_private(session, msg)
    if chat_type not in ("group", "supergroup"):
        return IngestResult("ignored")

    if "migrate_to_chat_id" in msg:
        group = await _migrate(session, chat["id"], msg["migrate_to_chat_id"])
        return IngestResult("migrated", group_id=group.id if group else None)
    if "migrate_from_chat_id" in msg:
        group = await _migrate(session, msg["migrate_from_chat_id"], chat["id"])
        return IngestResult("migrated", group_id=group.id if group else None)

    group = await _group_by_chat(session, chat["id"])
    if group is None:
        company = await _default_company(session)
        if company is None:
            return IngestResult("ignored")
        group = await _new_group(session, company, chat)
        return IngestResult(
            "group_pending", group_id=group.id, replies=[OutboundReply(chat["id"], group_text("group_pending"))]
        )

    if "new_chat_title" in msg:
        group.title = msg["new_chat_title"]
    else:
        group.title = chat.get("title", group.title)
    group.last_message_at = _ts(msg.get("date"))

    if not group.is_enabled:
        return IngestResult("group_disabled", group_id=group.id)
    if not any(key in msg for key in CONTENT_KEYS):
        return IngestResult("ignored", group_id=group.id)  # service message (joins, pins, ...)

    existing = await session.scalar(
        select(Message).where(Message.tg_chat_id == chat["id"], Message.tg_message_id == msg["message_id"])
    )
    kind, text, specs = _extract_content(msg)

    if existing is not None:
        if not edited:
            return IngestResult("duplicate", message_id=existing.id, group_id=group.id)
        return _apply_edit(session, existing, text, msg, group)

    sender = await upsert_telegram_user(session, group.company_id, msg["from"]) if "from" in msg else None
    message = Message(
        id=uuid.uuid4(),
        company_id=group.company_id,
        group_id=group.id,
        tg_chat_id=chat["id"],
        tg_message_id=msg["message_id"],
        tg_thread_id=msg.get("message_thread_id") if msg.get("is_topic_message") else None,
        media_group_id=msg.get("media_group_id"),
        reply_to_tg_message_id=(msg.get("reply_to_message") or {}).get("message_id"),
        sender_id=sender.id if sender else None,
        sent_at=_ts(msg["date"]) or utcnow(),
        edited_at=_ts(msg.get("edit_date")) if edited else None,
        kind=kind,
        text=text,
        raw=msg,
        # Set explicitly: column defaults only apply at flush, and the checks below run before it.
        analysis_status=AnalysisStatus.PENDING,
        transcript_status=TranscriptStatus.NOT_NEEDED,
        is_command=False,
    )
    if kind in (MessageKind.VOICE, MessageKind.AUDIO, MessageKind.VIDEO):
        message.transcript_status = TranscriptStatus.PENDING
    if kind == MessageKind.STICKER:
        message.analysis_status = AnalysisStatus.SKIPPED
    session.add(message)

    result = IngestResult("stored", message_id=message.id, group_id=group.id)
    max_bytes = get_settings().telegram_max_download_bytes
    for s in specs:
        att = Attachment(id=uuid.uuid4(), company_id=group.company_id, message_id=message.id, **s)
        if att.file_size and att.file_size > max_bytes:
            att.status = AttachmentStatus.TOO_LARGE  # Bot API cannot download >20 MB [A4]
            if message.transcript_status == TranscriptStatus.PENDING:
                message.transcript_status = TranscriptStatus.UNAVAILABLE
        else:
            result.download_attachment_ids.append(att.id)
        session.add(att)

    command = _parse_command(text)
    if command is not None:
        message.is_command = True
        message.analysis_status = AnalysisStatus.SKIPPED
        if command[0] == "task":
            await _handle_task_command(session, group, message, msg, command[1], sender, result)
        elif command[0] in ("help", "start"):
            result.replies.append(
                OutboundReply(group.tg_chat_id, group_text("group_enabled"), message.tg_message_id, message.tg_thread_id)
            )
        return result

    if message.analysis_status == AnalysisStatus.PENDING:
        result.analyze_group_id = group.id
    return result


def _apply_edit(session: AsyncSession, existing: Message, text: str | None, msg: dict, group: TelegramGroup) -> IngestResult:
    result = IngestResult("edited", message_id=existing.id, group_id=group.id)
    if existing.text == text:
        return result
    edited_at = _ts(msg.get("edit_date")) or utcnow()
    session.add(
        MessageRevision(message_id=existing.id, previous_text=existing.text, new_text=text, edited_at=edited_at)
    )
    existing.text = text
    existing.edited_at = edited_at
    if not existing.is_command and existing.analysis_status in (AnalysisStatus.DONE, AnalysisStatus.FAILED):
        existing.analysis_status = AnalysisStatus.PENDING  # re-analyse with the new text [A3]
    if existing.analysis_status == AnalysisStatus.PENDING:
        result.analyze_group_id = group.id
    return result


async def _handle_task_command(
    session: AsyncSession,
    group: TelegramGroup,
    message: Message,
    msg: dict,
    args: str,
    sender: TelegramUser | None,
    result: IngestResult,
) -> None:
    """`/task <text>` or a reply with `/task` creates a task for review [C10]."""
    replied: Message | None = None
    reply_id = (msg.get("reply_to_message") or {}).get("message_id")
    if reply_id:
        replied = await session.scalar(
            select(Message).where(Message.group_id == group.id, Message.tg_message_id == reply_id)
        )
    title = args or (replied.text if replied and replied.text else "")
    if not title:
        result.replies.append(
            OutboundReply(
                group.tg_chat_id,
                group_text("task_usage"),
                reply_to_message_id=message.tg_message_id,
                thread_id=message.tg_thread_id,
            )
        )
        return

    creator = (
        await session.scalar(select(User).where(User.telegram_user_id == sender.id)) if sender is not None else None
    )
    linked = [(message, TaskMessageRelation.SOURCE)]
    source_text = f"{sender.display_name if sender else 'unknown'}: {args}" if args else None
    if replied is not None:
        linked.insert(0, (replied, TaskMessageRelation.SOURCE))
        source_text = "\n".join(filter(None, [replied.content_for_ai, source_text]))
        if replied.analysis_status == AnalysisStatus.PENDING:
            replied.analysis_status = AnalysisStatus.SKIPPED  # avoid a duplicate AI task

    task = await create_task(
        session,
        actor=Actor.system(group.company_id),
        title=title.splitlines()[0][:200],
        description=title if len(title) > 200 or "\n" in title else None,
        category=TaskCategory.OTHER,
        priority=Priority.P3,
        department_id=group.department_id,
        truck_id=group.truck_id,
        source=TaskSource.TELEGRAM_COMMAND,
        group_id=group.id,
        source_message=replied or message,
        source_text=source_text or title,
        status=TaskStatus.NEEDS_REVIEW,
        linked_messages=linked,
        created_by_id=creator.id if creator else None,
        event_data={"telegram_user": sender.display_name if sender else None},
    )
    result.action = "command_task"
    if get_settings().telegram_group_acks:
        result.replies.append(
            OutboundReply(
                group.tg_chat_id,
                group_text("task_ack", code=task.code),
                reply_to_message_id=message.tg_message_id,
                thread_id=message.tg_thread_id,
            )
        )


async def _handle_private(session: AsyncSession, msg: dict) -> IngestResult:
    """Private chats are never stored. Only /start [token] for account linking [A6]."""
    frm = msg.get("from") or {}
    command = _parse_command(msg.get("text"))
    if command is None or command[0] not in ("start", "help", "mytasks") or "id" not in frm:
        return IngestResult("ignored")
    lang = norm_lang(frm.get("language_code"))
    chat_id = msg["chat"]["id"]
    if command[0] == "mytasks":
        return IngestResult("my_tasks", telegram_calls=(await my_tasks(session, frm, chat_id)).calls)
    if command[0] == "help":
        user = await linked_user(session, frm["id"])
        text = t("bot.help_private", user.language if user else lang) if user else t("bot.hello", lang)
        return IngestResult("help", replies=[OutboundReply(chat_id, text)])

    token = command[1]
    now = utcnow()
    user = None
    if token:
        user = await session.scalar(select(User).where(User.tg_link_token == token))
        if user is not None and (user.tg_link_token_expires_at is None or user.tg_link_token_expires_at < now):
            user = None

    if user is not None:
        tg_user = await upsert_telegram_user(session, user.company_id, frm)
        tg_user.can_dm = True
        await session.flush()
        user.telegram_user_id = tg_user.id
        user.tg_link_token = None
        user.tg_link_token_expires_at = None
        record_audit(
            session,
            Actor.for_user(user),
            "user.telegram_linked",
            "user",
            user.id,
            after={"tg_user_id": frm["id"], "username": frm.get("username")},
        )
        return IngestResult(
            "linked",
            replies=[OutboundReply(msg["chat"]["id"], t("bot.linked", lang, name=user.full_name))],
        )

    known = (await session.scalars(select(TelegramUser).where(TelegramUser.tg_user_id == frm["id"]))).all()
    for tg_user in known:
        tg_user.can_dm = True
    return IngestResult(
        "start",
        replies=[
            OutboundReply(
                msg["chat"]["id"],
                t("bot.hello", lang),
            )
        ],
    )
