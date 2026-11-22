"""Bulk serializers: load related rows in one query per table instead of per task."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    AttachmentOut,
    DepartmentRef,
    GroupRef,
    MailboxRef,
    MessageOut,
    TaskOut,
    TruckRef,
    UserRef,
)
from app.models import (
    Department,
    Mailbox,
    Message,
    ResponseClock,
    Task,
    TelegramGroup,
    TelegramUser,
    Truck,
    User,
    utcnow,
)
from app.telegram.client import message_link


async def _by_ids(session: AsyncSession, model, ids: set) -> dict:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    rows = (await session.scalars(select(model).where(model.id.in_(ids)))).unique().all()
    return {r.id: r for r in rows}


async def serialize_tasks(session: AsyncSession, tasks: Sequence[Task]) -> list[TaskOut]:
    departments = await _by_ids(session, Department, {t.department_id for t in tasks})
    trucks = await _by_ids(session, Truck, {t.truck_id for t in tasks})
    users = await _by_ids(session, User, {t.assignee_id for t in tasks})
    groups = await _by_ids(session, TelegramGroup, {t.group_id for t in tasks})
    mailboxes = await _by_ids(session, Mailbox, {t.mailbox_id for t in tasks})
    now = utcnow()
    # Response status per issue from its linked clocks: unanswered / overdue / answered.
    response: dict = {}
    due: dict = {}
    critical: set = set()
    ids = [t.id for t in tasks]
    if ids:
        for clock in (await session.scalars(select(ResponseClock).where(ResponseClock.task_id.in_(ids)))).all():
            current = response.get(clock.task_id)
            if clock.status == "pending":
                if clock.task_id not in due or clock.due_at < due[clock.task_id]:
                    due[clock.task_id] = clock.due_at
                if clock.critical:
                    critical.add(clock.task_id)
                state = "overdue" if clock.due_at <= now else "unanswered"
                if current != "overdue":
                    response[clock.task_id] = state
            elif clock.status == "answered" and current is None:
                response[clock.task_id] = "answered"
    out: list[TaskOut] = []
    for t in tasks:
        mailbox = mailboxes.get(t.mailbox_id)
        dept = departments.get(t.department_id)
        truck = trucks.get(t.truck_id)
        user = users.get(t.assignee_id)
        group = groups.get(t.group_id)
        out.append(
            TaskOut(
                id=t.id,
                code=t.code,
                number=t.number,
                title=t.title,
                description=t.description,
                i18n=t.i18n or {},
                category=t.category,
                priority=t.priority,
                status=t.status,
                is_overdue=t.is_overdue(now),
                department=DepartmentRef.model_validate(dept) if dept else None,
                truck=TruckRef.model_validate(truck) if truck else None,
                truck_unit_raw=t.truck_unit_raw,
                load_ref=t.load_ref,
                issue_type=t.issue_type,
                amount=t.amount,
                trailer_ref=t.trailer_ref,
                driver_name=t.driver_name,
                next_action_at=t.next_action_at,
                source_channel="email" if t.mailbox_id else ("telegram" if t.group_id else None),
                mailbox=MailboxRef.model_validate(mailbox) if mailbox else None,
                response_status=response.get(t.id),
                response_due_at=due.get(t.id),
                response_critical=t.id in critical,
                assignee=UserRef.model_validate(user) if user else None,
                source=t.source,
                confidence=t.confidence,
                group=GroupRef.model_validate(group) if group else None,
                due_at=t.due_at,
                created_at=t.created_at,
                updated_at=t.updated_at,
                started_at=t.started_at,
                completed_at=t.completed_at,
                reopen_count=t.reopen_count,
                escalation_level=t.escalation_level,
                cancel_reason=t.cancel_reason,
                blocked_reason=t.blocked_reason,
                merged_into_id=t.merged_into_id,
            )
        )
    return out


async def serialize_messages(session: AsyncSession, messages: Sequence[Message]) -> list[MessageOut]:
    groups = await _by_ids(session, TelegramGroup, {m.group_id for m in messages})
    mailboxes = await _by_ids(session, Mailbox, {m.mailbox_id for m in messages})
    senders = await _by_ids(session, TelegramUser, {m.sender_id for m in messages})
    out: list[MessageOut] = []
    for m in messages:
        group = groups.get(m.group_id)
        mailbox = mailboxes.get(m.mailbox_id)
        channel_ref = (
            GroupRef.model_validate(group) if group is not None
            else GroupRef(id=mailbox.id, title=mailbox.email_address) if mailbox is not None
            else GroupRef(id=m.id, title="—")
        )
        sender = senders.get(m.sender_id)
        username = (m.raw or {}).get("chat", {}).get("username")
        out.append(
            MessageOut(
                id=m.id,
                group=channel_ref,
                sent_at=m.sent_at,
                edited_at=m.edited_at,
                sender_name=sender.display_name if sender else (m.from_address or "unknown"),
                kind=m.kind,
                text=m.text,
                transcript=m.transcript,
                transcript_status=m.transcript_status,
                analysis_status=m.analysis_status,
                telegram_link=message_link(m.tg_chat_id, m.tg_message_id, username) if m.tg_chat_id else None,
                attachments=[AttachmentOut.model_validate(a) for a in m.attachments],
            )
        )
    return out
