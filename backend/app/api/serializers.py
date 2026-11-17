"""Bulk serializers: load related rows in one query per table instead of per task."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    AttachmentOut,
    DepartmentRef,
    GroupRef,
    MessageOut,
    TaskOut,
    TruckRef,
    UserRef,
)
from app.models import Department, Message, Task, TelegramGroup, TelegramUser, Truck, User, utcnow
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
    now = utcnow()
    out: list[TaskOut] = []
    for t in tasks:
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
    senders = await _by_ids(session, TelegramUser, {m.sender_id for m in messages})
    out: list[MessageOut] = []
    for m in messages:
        group = groups[m.group_id]
        sender = senders.get(m.sender_id)
        username = (m.raw or {}).get("chat", {}).get("username")
        out.append(
            MessageOut(
                id=m.id,
                group=GroupRef.model_validate(group),
                sent_at=m.sent_at,
                edited_at=m.edited_at,
                sender_name=sender.display_name if sender else "unknown",
                kind=m.kind,
                text=m.text,
                transcript=m.transcript,
                transcript_status=m.transcript_status,
                analysis_status=m.analysis_status,
                telegram_link=message_link(m.tg_chat_id, m.tg_message_id, username),
                attachments=[AttachmentOut.model_validate(a) for a in m.attachments],
            )
        )
    return out
