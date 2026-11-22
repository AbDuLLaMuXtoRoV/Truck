"""24/7 five-minute human-response SLA (blueprint sec. 7).

- Every inbound message from a driver / broker / customer that needs a reply starts a clock at the
  source message time (when trustworthy); ingestion delay is recorded separately.
- Only an authorised human reply linked to the conversation stops it. Bot, AI and automatic
  replies never do. Replying does NOT close the issue.
- Ladder: 3 min team reminder -> 5 min supervisor -> 10 min manager/owner. Safety-critical messages
  alert supervisor and managers immediately.
"""

import logging
import re
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.domain.enums import NotificationKind, Role, TaskEventType
from app.models import (
    Department,
    Mailbox,
    Message,
    ResponseClock,
    ResponseEscalation,
    Shift,
    Task,
    TelegramGroup,
    User,
    utcnow,
)
from app.services.notifications import company_executives, department_lead_ids, notify_keyed

log = logging.getLogger(__name__)

# Messages that never need a human reply: acknowledgements, thanks, emoji-only.
_ACK_WORDS = {
    "ok", "okay", "okey", "ок", "окей", "ок.", "+", "++", "👍", "👌", "🙏", "rahmat", "raxmat", "rahmat aka",
    "raxmat aka", "spasibo", "спасибо", "спс", "thanks", "thank you", "thx", "ty", "yaxshi", "xop", "хоп",
    "hop", "mayli", "bo'ldi", "boldi", "bo‘ldi", "tushunarli", "tushundim", "понял", "понятно", "принял",
    "ага", "да", "ha", "xa", "ха", "good", "fine", "noted", "copy", "10-4", "roger",
}
_HAS_WORD = re.compile(r"[\w\d]", re.UNICODE)
# Safety-critical: alert supervisor and managers immediately (blueprint sec. 7).
_CRITICAL = re.compile(
    r"\b(accident|crash|rollover|injur\w*|fire|police|stolen|hijack\w*|ambulance|"
    r"avariya|avaria|jarohat\w*|yong[‘'`]?in|o[‘'`]?t oldi|politsiya|"
    r"авари\w*|дтп|пожар|полици\w*|травм\w*|украл\w*|скорая)\b",
    re.IGNORECASE | re.UNICODE,
)


def needs_no_reply(text: str | None, kind: str) -> bool:
    if kind == "sticker":
        return True
    if not text:
        return False  # photos / voice / documents without text still need a human look
    stripped = text.strip().lower().rstrip("!.)")
    if stripped in _ACK_WORDS:
        return True
    return not _HAS_WORD.search(stripped)  # emoji / punctuation only


def is_critical(text: str | None) -> bool:
    return bool(text and _CRITICAL.search(text))


def preview_of(message: Message) -> str:
    text = (message.subject + " — " if message.subject else "") + (message.text or message.transcript or "")
    if not text.strip():
        text = f"[{message.kind}]"
    text = " ".join(text.split())
    return text[:140] + ("…" if len(text) > 140 else "")


def seconds_left(clock: ResponseClock, now: datetime | None = None) -> int:
    return int((clock.due_at - (now or utcnow())).total_seconds())


# --------------------------------------------------------------------------- start / stop


async def start_clock(
    session: AsyncSession,
    message: Message,
    *,
    channel_name: str,
    department_id: uuid.UUID | None,
    sender_key: str | None,
    sender_name: str | None,
) -> ResponseClock | None:
    """Start the response clock for an inbound external message, unless it needs no reply."""
    if message.direction != "inbound" or message.sender_kind != "external" or message.is_command:
        return None
    if needs_no_reply(message.text, message.kind):
        message.classification = message.classification or "informational"
        return None
    settings = get_settings()
    now = utcnow()
    started = message.sent_at
    delay = int((now - started).total_seconds())
    # Untrustworthy source time (in the future, or very late delivery): count from receipt instead.
    if delay < -60 or delay > 6 * 3600:
        started = now
    clock = ResponseClock(
        id=uuid.uuid4(),
        company_id=message.company_id,
        message_id=message.id,
        thread_key=message.thread_key or "",
        channel=message.channel,
        group_id=message.group_id,
        mailbox_id=message.mailbox_id,
        department_id=department_id,
        sender_key=sender_key,
        sender_name=(sender_name or "")[:200] or None,
        preview=preview_of(message)[:300],
        started_at=started,
        received_at=now,
        ingest_delay_seconds=max(0, delay),
        due_at=started + timedelta(seconds=settings.response_overdue_seconds),
        status="pending",
        level=0,
        critical=is_critical(message.text) or is_critical(message.subject),
    )
    session.add(clock)
    await session.flush()
    # Out-of-order delivery in a Gmail batch: a staff reply sent after this email may already be stored.
    # (Telegram delivers in order and has 1-second timestamps, so the rule is email-only.)
    if message.thread_key and message.channel == "email":
        reply = await session.scalar(
            select(Message)
            .where(Message.thread_key == message.thread_key, Message.sender_kind == "staff",
                   Message.sent_at >= message.sent_at, Message.id != message.id)
            .order_by(Message.sent_at)
            .limit(1)
        )
        if reply is not None:
            clock.status = "answered"
            clock.answered_at = max(reply.sent_at, clock.started_at)
            clock.answer_message_id = reply.id
            clock.answered_by_name = (reply.from_address or "").split("<")[0].strip() or None
            clock.response_seconds = int((clock.answered_at - clock.started_at).total_seconds())
            return clock
    if clock.critical:
        await _escalate(session, clock, level=2, kind="critical", now=now)
    return clock


async def record_staff_reply(
    session: AsyncSession,
    message: Message,
    *,
    answered_by_user_id: uuid.UUID | None,
    answered_by_name: str | None,
    reply_to: Message | None = None,
) -> int:
    """A human staff message in a conversation answers the waiting messages there.

    - A reply to a specific external message answers that sender's waiting messages.
    - An unthreaded message answers every waiting message in the chat (configurable).
    """
    if message.thread_key is None:
        return 0
    # Compare original send times (the clock start may have been moved to receipt time for
    # late deliveries), so only messages sent before this reply are answered by it.
    query = (
        select(ResponseClock)
        .join(Message, Message.id == ResponseClock.message_id)
        .where(
            ResponseClock.thread_key == message.thread_key,
            ResponseClock.status == "pending",
            Message.sent_at <= message.sent_at + timedelta(seconds=5),
        )
    )
    if reply_to is not None and reply_to.sender_kind == "external":
        target = await session.scalar(select(ResponseClock).where(ResponseClock.message_id == reply_to.id))
        if target is not None and target.sender_key:
            query = query.where(ResponseClock.sender_key == target.sender_key)
        elif target is not None:
            query = query.where(ResponseClock.id == target.id)
    elif not get_settings().response_unthreaded_answers_all and message.channel == "telegram":
        return 0
    clocks = (await session.scalars(query)).all()
    for clock in clocks:
        answered_at = max(message.sent_at, clock.started_at)
        clock.status = "answered"
        clock.answered_at = answered_at
        clock.answered_by_user_id = answered_by_user_id
        clock.answered_by_name = (answered_by_name or "")[:200] or None
        clock.answer_message_id = message.id
        clock.response_seconds = int((answered_at - clock.started_at).total_seconds())
    return len(clocks)


async def close_not_needed(
    session: AsyncSession, clock: ResponseClock, *, reason: str, user_id: uuid.UUID | None = None
) -> ResponseClock:
    """Configurable exception: the message needs no reply (AI label or a person's decision, audited)."""
    if clock.status == "pending":
        clock.status = "not_needed"
        clock.closed_reason = reason[:200]
        clock.closed_by_user_id = user_id
    return clock


async def link_clock_to_task(session: AsyncSession, message_id: uuid.UUID, task: Task) -> ResponseClock | None:
    clock = await session.scalar(select(ResponseClock).where(ResponseClock.message_id == message_id))
    if clock is None:
        return None
    clock.task_id = task.id
    escalations = (await session.scalars(select(ResponseEscalation).where(ResponseEscalation.clock_id == clock.id))).all()
    for e in escalations:
        e.task_id = e.task_id or task.id
    if task.priority == "P1" and clock.status == "pending" and not clock.critical:
        clock.critical = True
        if clock.level < 2:
            await _escalate(session, clock, level=2, kind="critical", now=utcnow())
    return clock


# --------------------------------------------------------------------------- escalation ladder


async def _on_duty(session: AsyncSession, company_id: uuid.UUID, department_id: uuid.UUID | None) -> list[uuid.UUID]:
    q = select(Shift.user_id).where(Shift.company_id == company_id, Shift.status == "active")
    if department_id is not None:
        q = q.where(Shift.department_id == department_id)
    return list(dict.fromkeys((await session.scalars(q)).all()))


async def _team(session: AsyncSession, clock: ResponseClock) -> list[uuid.UUID]:
    on_duty = await _on_duty(session, clock.company_id, clock.department_id)
    if on_duty:
        return on_duty
    if clock.department_id is None:
        return []
    return list(
        (
            await session.scalars(
                select(User.id).where(
                    User.department_id == clock.department_id,
                    User.role.in_([Role.AGENT, Role.DEPT_LEAD]),
                    User.is_active.is_(True),
                )
            )
        ).all()
    )


async def _channel(session: AsyncSession, clock: ResponseClock):
    if clock.group_id:
        return await session.get(TelegramGroup, clock.group_id)
    if clock.mailbox_id:
        return await session.get(Mailbox, clock.mailbox_id)
    return None


async def _recipients(session: AsyncSession, clock: ResponseClock, level: int) -> list[uuid.UUID]:
    channel = await _channel(session, clock)
    if level <= 1:
        return await _team(session, clock)
    if level == 2:
        if channel is not None and channel.supervisor_id:
            return [channel.supervisor_id]
        leads = await department_lead_ids(session, clock.department_id)
        if leads:
            return leads
        if channel is not None and channel.backup_id:
            return [channel.backup_id]
        return await company_executives(session, clock.company_id)
    ids = [channel.manager_id] if channel is not None and channel.manager_id else []
    return list(dict.fromkeys([*ids, *await company_executives(session, clock.company_id)]))


async def channel_name_of(session: AsyncSession, clock: ResponseClock) -> str:
    channel = await _channel(session, clock)
    if isinstance(channel, TelegramGroup):
        return channel.title
    if isinstance(channel, Mailbox):
        return channel.email_address
    return "—"


_KEYS = {1: ("reminder", "n.resp.reminder", NotificationKind.RESPONSE_REMINDER),
         2: ("overdue", "n.resp.overdue", NotificationKind.RESPONSE_OVERDUE),
         3: ("escalated", "n.resp.escalated", NotificationKind.RESPONSE_ESCALATED)}


async def _escalate(session: AsyncSession, clock: ResponseClock, *, level: int, kind: str, now: datetime) -> ResponseEscalation:
    recipients = await _recipients(session, clock, level)
    if kind == "critical":
        recipients = list(dict.fromkeys([*recipients, *await _recipients(session, clock, 3)]))
        title_key, notif_kind = "n.resp.critical", NotificationKind.CRITICAL
    else:
        _, title_key, notif_kind = _KEYS[level]
    params = {
        "channel": await channel_name_of(session, clock),
        "sender": clock.sender_name or "—",
        "preview": (clock.preview or "")[:80],
    }
    names: list[str] = []
    for uid in recipients:
        user = await session.get(User, uid)
        if user is None or not user.is_active:
            continue
        names.append(user.full_name)
        await notify_keyed(session, company_id=clock.company_id, user_id=uid, kind=notif_kind, title_key=title_key,
                           params=params, task_id=clock.task_id, message_id=clock.message_id)
    escalation = ResponseEscalation(
        company_id=clock.company_id,
        clock_id=clock.id,
        task_id=clock.task_id,
        level=level,
        kind=kind,
        notified_user_ids=[str(u) for u in recipients],
        notified_names=names,
        created_at=now,
    )
    session.add(escalation)
    clock.level = max(clock.level, level)
    if clock.task_id:
        from app.core.rbac import Actor
        from app.services.tasks import add_event

        task = await session.get(Task, clock.task_id)
        if task is not None:
            add_event(session, task, Actor.system(task.company_id), TaskEventType.ESCALATED,
                      data={"kind": f"response_{kind}", "level": level, "notified": names})
    return escalation


async def run_response_checks(session: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    """Walk waiting messages up the 3 / 5 / 10-minute ladder. Idempotent via clock.level."""
    settings = get_settings()
    now = now or utcnow()
    thresholds = [(3, settings.response_escalate_seconds), (2, settings.response_overdue_seconds),
                  (1, settings.response_reminder_seconds)]
    counts = {"reminders": 0, "overdue": 0, "escalated": 0}
    clocks = (
        await session.scalars(
            select(ResponseClock).where(
                ResponseClock.status == "pending",
                ResponseClock.level < 3,
                ResponseClock.started_at <= now - timedelta(seconds=settings.response_reminder_seconds),
            )
        )
    ).all()
    for clock in clocks:
        elapsed = (now - clock.started_at).total_seconds()
        for level, threshold in thresholds:
            if elapsed >= threshold:
                if clock.level < level:
                    await _escalate(session, clock, level=level, kind=_KEYS[level][0], now=now)
                    counts[_KEYS[level][0] if level > 1 else "reminders"] += 1
                break
    await session.flush()
    return counts


async def manual_escalation(
    session: AsyncSession, task: Task, *, actor_user_id: uuid.UUID, reason: str
) -> ResponseEscalation:
    """The "Escalate" button on an issue: notify supervisor + managers now."""
    from app.services.notifications import leads_or_managers

    recipients = list(dict.fromkeys([
        *await leads_or_managers(session, task.company_id, task.department_id),
        *await company_executives(session, task.company_id),
    ]))
    names: list[str] = []
    for uid in recipients:
        if uid == actor_user_id:
            continue
        user = await session.get(User, uid)
        if user is None:
            continue
        names.append(user.full_name)
        await notify_keyed(session, company_id=task.company_id, user_id=uid, kind=NotificationKind.ESCALATION,
                           title_key="n.task.escalated", params={"code": task.code, "title": task.title}, task_id=task.id)
    escalation = ResponseEscalation(company_id=task.company_id, task_id=task.id, level=9, kind="manual",
                                    notified_user_ids=[str(u) for u in recipients], notified_names=names,
                                    actor_user_id=actor_user_id, reason=reason)
    session.add(escalation)
    return escalation


async def department_name(session: AsyncSession, department_id: uuid.UUID | None) -> str:
    if department_id is None:
        return "—"
    dept = await session.get(Department, department_id)
    return dept.name if dept else "—"
