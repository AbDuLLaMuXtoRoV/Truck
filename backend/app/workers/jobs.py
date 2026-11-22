"""Job bodies. Each opens its own session so it can run inline (asyncio) or in Celery."""

import logging
import mimetypes
import uuid

from sqlalchemy import select

from app.ai.transcribe import TranscriptionUnavailable, get_transcriber
from app.config import get_settings
from app.db import session_factory
from app.domain.enums import (
    AttachmentStatus,
    MessageKind,
    NotificationChannel,
    NotificationStatus,
    TranscriptStatus,
)
from app.core.rbac import Actor
from app.models import Attachment, Message, Notification, Task, TelegramUser, User, utcnow
from app.services.analysis import channels_with_stale_pending, run_channel_analysis
from app.services.response import run_response_checks
from app.services.sla_jobs import run_sla_checks
from app.services.storage import get_storage
from app.services.tasks import company_four_eyes
from app.telegram.actions import keyboard_for
from app.telegram.client import TelegramClient, TelegramError

log = logging.getLogger(__name__)


async def job_analyze_channel(kind: str, channel_id: uuid.UUID) -> str:
    from app.workers.queue import enqueue_analysis

    outcome = await run_channel_analysis(session_factory(), kind, channel_id)
    if outcome.status == "waiting" and outcome.retry_after_seconds:
        await enqueue_analysis(channel_id, delay_seconds=outcome.retry_after_seconds, kind=kind)
    log.info("analysis %s=%s status=%s created=%s", "group" if kind == "telegram" else "mailbox", channel_id,
             outcome.status, outcome.tasks_created)
    return outcome.status


async def job_analyze_group(group_id: uuid.UUID) -> str:
    return await job_analyze_channel("telegram", group_id)


async def job_sweep_pending() -> int:
    from app.workers.queue import enqueue_analysis

    async with session_factory()() as session:
        channels = await channels_with_stale_pending(session)
    for kind, cid in channels:
        await enqueue_analysis(cid, delay_seconds=0, kind=kind)
    return len(channels)


async def job_response_checks() -> dict:
    """5-minute response SLA ladder (3 / 5 / 10 min) — runs every 15 s."""
    async with session_factory()() as session:
        counts = await run_response_checks(session)
        await session.commit()
    return counts


async def job_coverage_checks() -> dict:
    from app.services.shifts import run_coverage_checks

    async with session_factory()() as session:
        counts = await run_coverage_checks(session)
        await session.commit()
    return counts


async def job_gmail_sync() -> int:
    """Poll every connected mailbox (Gmail history API). Pub/Sub push can trigger it sooner."""
    from app.services.gmail import sync_all_mailboxes

    return await sync_all_mailboxes(session_factory())


async def job_sla_checks() -> dict:
    async with session_factory()() as session:
        counts = await run_sla_checks(session)
        await session.commit()
    return counts


async def job_download_attachment(attachment_id: uuid.UUID) -> str:
    settings = get_settings()
    async with session_factory()() as session:
        att = await session.get(Attachment, attachment_id)
        if att is None or att.status != AttachmentStatus.PENDING:
            return "skip"
        message = await session.get(Message, att.message_id)
        if att.tg_file_id is None and att.source_ref and message is not None and message.mailbox_id:
            # Email attachment: fetch through the Gmail API.
            from app.services.gmail import GmailError, download_attachment

            try:
                data = await download_attachment(session, att, message)
                ext = mimetypes.guess_extension(att.mime_type or "") or ""
                att.storage_key = get_storage().save(f"{att.company_id}/{utcnow():%Y/%m}/{att.id}{ext}", data)
                att.status = AttachmentStatus.DOWNLOADED
            except GmailError as exc:
                att.status, att.error = AttachmentStatus.FAILED, exc.message
            await session.commit()
            return att.status
        needs_transcript = (
            message is not None
            and att.kind in (MessageKind.VOICE, MessageKind.AUDIO, MessageKind.VIDEO)
            and message.transcript_status == TranscriptStatus.PENDING
        )
        if not settings.telegram_bot_token:
            if needs_transcript:
                message.transcript_status = TranscriptStatus.UNAVAILABLE
            await session.commit()
            return "no_token"

        client = TelegramClient()
        try:
            info = await client.get_file(att.tg_file_id)
            if (info.get("file_size") or 0) > settings.telegram_max_download_bytes or "file_path" not in info:
                att.status = AttachmentStatus.TOO_LARGE
            else:
                data = await client.download_file(info["file_path"])
                ext = mimetypes.guess_extension(att.mime_type or "") or (
                    "." + info["file_path"].rsplit(".", 1)[-1] if "." in info["file_path"] else ""
                )
                now = utcnow()
                att.storage_key = get_storage().save(f"{att.company_id}/{now:%Y/%m}/{att.id}{ext}", data)
                att.status = AttachmentStatus.DOWNLOADED
                if needs_transcript:
                    try:
                        message.transcript = await get_transcriber().transcribe(data, att.mime_type)
                        message.transcript_status = TranscriptStatus.DONE
                    except TranscriptionUnavailable:
                        message.transcript_status = TranscriptStatus.UNAVAILABLE
                    except Exception as exc:  # noqa: BLE001 - provider errors must not lose the message
                        log.warning("transcription failed for %s: %s", att.id, exc)
                        message.transcript_status = TranscriptStatus.FAILED
        except TelegramError as exc:
            att.status = AttachmentStatus.TOO_LARGE if "too big" in exc.description.lower() else AttachmentStatus.FAILED
            att.error = exc.description
        finally:
            await client.close()
        if needs_transcript and message.transcript_status == TranscriptStatus.PENDING:
            message.transcript_status = TranscriptStatus.UNAVAILABLE
        await session.commit()
        return att.status


async def job_send_reply(chat_id: int, text: str, reply_to: int | None = None, thread_id: int | None = None) -> None:
    if not get_settings().telegram_bot_token:
        return
    client = TelegramClient()
    try:
        await client.send_message(chat_id, text, reply_to_message_id=reply_to, thread_id=thread_id)
    except TelegramError as exc:
        log.warning("reply to %s failed: %s", chat_id, exc)
    finally:
        await client.close()


async def job_telegram_call(method: str, params: dict) -> None:
    """Any other Bot API call: answer a button tap, edit a message, send with buttons."""
    if not get_settings().telegram_bot_token:
        return
    client = TelegramClient()
    try:
        if method == "sendMessage":
            await client.send_message(params["chat_id"], params["text"], reply_markup=params.get("reply_markup"))
        else:
            await client.call(method, **params)
    except TelegramError as exc:
        if "not modified" not in exc.description:  # a double tap is harmless
            log.warning("%s failed: %s", method, exc)
    finally:
        await client.close()


async def job_send_dms(limit: int = 50) -> int:
    """Delivers pending Telegram DM notifications through the rate-limited client [A5, A6]."""
    settings = get_settings()
    if not settings.telegram_bot_token:
        return 0
    sent = 0
    async with session_factory()() as session:
        rows = (
            await session.scalars(
                select(Notification)
                .where(
                    Notification.channel == NotificationChannel.TELEGRAM_DM,
                    Notification.status == NotificationStatus.PENDING,
                )
                .order_by(Notification.created_at)
                .limit(limit)
            )
        ).all()
        if not rows:
            return 0
        client = TelegramClient()
        try:
            for n in rows:
                user = await session.get(User, n.user_id)
                tg_user = await session.get(TelegramUser, user.telegram_user_id) if user and user.telegram_user_id else None
                if tg_user is None or not tg_user.can_dm:
                    n.status, n.error = NotificationStatus.FAILED, "telegram not linked"
                    continue
                text = n.title + (f"\n{n.body}" if n.body else "")
                markup = None
                task = await session.get(Task, n.task_id) if n.task_id else None
                if task is not None:
                    # Buttons so staff can work the task without opening the dashboard.
                    four_eyes = await company_four_eyes(session, task.company_id)
                    markup = keyboard_for(task, Actor.for_user(user), user.language, four_eyes=four_eyes)
                    if not settings.dashboard_url.startswith("https://"):
                        text += f"\n{settings.dashboard_url.rstrip('/')}/tasks/{n.task_id}"
                try:
                    await client.send_message(tg_user.tg_user_id, text, reply_markup=markup)
                    n.status, n.sent_at = NotificationStatus.SENT, utcnow()
                    sent += 1
                except TelegramError as exc:
                    n.status, n.error = NotificationStatus.FAILED, exc.description
                    if exc.error_code == 403:  # user blocked the bot
                        tg_user.can_dm = False
        finally:
            await client.close()
        await session.commit()
    return sent
