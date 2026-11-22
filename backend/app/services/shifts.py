"""Shift coverage and handover (blueprint sec. 2 and 7).

- Explicit on-duty roster: staff check in / check out.
- Handover: open cases keep their owner until the incoming person accepts; reassignment happens
  only on acceptance. An unaccepted handover alerts the supervisor after 15 minutes.
- Coverage gaps (a department with monitored channels and nobody on duty) alert the backup /
  supervisor, at most every 2 hours — enabled with COVERAGE_ALERTS_ENABLED once the roster is used.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.rbac import Actor
from app.domain.enums import OPEN_STATUSES, NotificationKind, TaskEventType
from app.domain.task_state import TransitionError
from app.models import Department, Handover, Mailbox, ResponseClock, Shift, Task, TelegramGroup, User, utcnow
from app.services.notifications import leads_or_managers, notify_keyed
from app.services.tasks import add_event

HANDOVER_ALERT_AFTER = timedelta(minutes=15)
COVERAGE_ALERT_EVERY = timedelta(hours=2)


class ShiftError(TransitionError):
    pass


async def active_shift(session: AsyncSession, user_id: uuid.UUID) -> Shift | None:
    return await session.scalar(select(Shift).where(Shift.user_id == user_id, Shift.status == "active"))


async def start_shift(session: AsyncSession, user: User) -> Shift:
    current = await active_shift(session, user.id)
    if current is not None:
        return current
    shift = Shift(id=uuid.uuid4(), company_id=user.company_id, user_id=user.id, department_id=user.department_id,
                  started_at=utcnow(), status="active")
    session.add(shift)
    await session.flush()
    return shift


async def open_tasks_of(session: AsyncSession, user_id: uuid.UUID) -> list[Task]:
    return list(
        (await session.scalars(
            select(Task).where(Task.assignee_id == user_id, Task.status.in_(list(OPEN_STATUSES))).order_by(Task.priority)
        )).all()
    )


async def end_shift(
    session: AsyncSession, user: User, *, handover_to_user_id: uuid.UUID | None, note: str | None
) -> tuple[Shift, Handover | None]:
    shift = await active_shift(session, user.id)
    if shift is None:
        raise ShiftError("no_shift", "You are not on shift", http_status=409)
    handover = None
    tasks = await open_tasks_of(session, user.id)
    if handover_to_user_id is not None:
        target = await session.get(User, handover_to_user_id)
        if target is None or target.company_id != user.company_id or not target.is_active or target.id == user.id:
            raise ShiftError("invalid_user", "Choose an active colleague to hand over to", http_status=422)
        handover = Handover(id=uuid.uuid4(), company_id=user.company_id, from_user_id=user.id, to_user_id=target.id,
                            status="pending", note=note, task_ids=[str(t.id) for t in tasks], created_at=utcnow())
        session.add(handover)
        await notify_keyed(session, company_id=user.company_id, user_id=target.id, kind=NotificationKind.HANDOVER,
                           title_key="n.handover", params={"name": user.full_name, "n": len(tasks)})
    shift.status = "ended"
    shift.ended_at = utcnow()
    await session.flush()
    return shift, handover


async def accept_handover(session: AsyncSession, handover: Handover, user: User) -> Handover:
    if handover.to_user_id != user.id:
        raise ShiftError("forbidden", "This handover is not addressed to you", http_status=403)
    if handover.status != "pending":
        raise ShiftError("closed", "This handover was already answered", http_status=409)
    system = Actor.system(handover.company_id)
    for raw_id in handover.task_ids:
        task = await session.get(Task, uuid.UUID(raw_id))
        # Only cases still owned by the outgoing person move; anything reassigned meanwhile stays.
        if task is None or task.assignee_id != handover.from_user_id or task.status not in OPEN_STATUSES:
            continue
        task.assignee_id = user.id
        task.updated_at = utcnow()
        add_event(session, task, system, TaskEventType.ASSIGNED,
                  data={"assignee_id": str(user.id), "via": "handover", "handover_id": str(handover.id)})
    handover.status = "accepted"
    handover.responded_at = utcnow()
    await session.flush()
    return handover


async def decline_handover(session: AsyncSession, handover: Handover, user: User) -> Handover:
    if handover.to_user_id != user.id:
        raise ShiftError("forbidden", "This handover is not addressed to you", http_status=403)
    if handover.status != "pending":
        raise ShiftError("closed", "This handover was already answered", http_status=409)
    handover.status = "declined"
    handover.responded_at = utcnow()
    from_user = await session.get(User, handover.from_user_id)
    for uid in await leads_or_managers(session, handover.company_id, from_user.department_id if from_user else None):
        await notify_keyed(session, company_id=handover.company_id, user_id=uid, kind=NotificationKind.HANDOVER,
                           title_key="n.handover_unanswered",
                           params={"from_name": from_user.full_name if from_user else "—", "to_name": user.full_name})
    await session.flush()
    return handover


async def coverage(session: AsyncSession, company_id: uuid.UUID) -> list[dict]:
    """Per department: who is on duty, open issues, unanswered messages, and whether it is a gap."""
    depts = (await session.scalars(select(Department).where(Department.company_id == company_id).order_by(Department.code))).all()
    shifts = (await session.execute(
        select(Shift, User).join(User, User.id == Shift.user_id)
        .where(Shift.company_id == company_id, Shift.status == "active")
    )).all()
    out = []
    for d in depts:
        on_duty = [{"user_id": u.id, "full_name": u.full_name, "since": s.started_at} for s, u in shifts if s.department_id == d.id]
        open_issues = await session.scalar(select(func.count()).select_from(Task).where(
            Task.company_id == company_id, Task.department_id == d.id, Task.status.in_(list(OPEN_STATUSES)))) or 0
        unanswered = await session.scalar(select(func.count()).select_from(ResponseClock).where(
            ResponseClock.company_id == company_id, ResponseClock.department_id == d.id, ResponseClock.status == "pending")) or 0
        monitored = (await session.scalar(select(func.count()).select_from(TelegramGroup).where(
            TelegramGroup.department_id == d.id, TelegramGroup.is_enabled.is_(True))) or 0) + (
            await session.scalar(select(func.count()).select_from(Mailbox).where(
                Mailbox.department_id == d.id, Mailbox.is_enabled.is_(True))) or 0)
        out.append({"department_id": d.id, "code": d.code, "name": d.name, "on_duty": on_duty,
                    "open_issues": open_issues, "unanswered": unanswered, "gap": monitored > 0 and not on_duty})
    return out


async def run_coverage_checks(session: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    now = now or utcnow()
    counts = {"handover_alerts": 0, "coverage_alerts": 0}
    stale = (await session.scalars(select(Handover).where(
        Handover.status == "pending", Handover.alerted_at.is_(None), Handover.created_at <= now - HANDOVER_ALERT_AFTER
    ))).all()
    for h in stale:
        from_user = await session.get(User, h.from_user_id)
        to_user = await session.get(User, h.to_user_id)
        for uid in await leads_or_managers(session, h.company_id, from_user.department_id if from_user else None):
            await notify_keyed(session, company_id=h.company_id, user_id=uid, kind=NotificationKind.HANDOVER,
                               title_key="n.handover_unanswered",
                               params={"from_name": from_user.full_name if from_user else "—",
                                       "to_name": to_user.full_name if to_user else "—"})
        h.alerted_at = now
        counts["handover_alerts"] += 1

    if get_settings().coverage_alerts_enabled:
        companies = set((await session.scalars(select(Department.company_id).distinct())).all())
        for company_id in companies:
            for row in await coverage(session, company_id):
                if not row["gap"]:
                    continue
                dept = await session.get(Department, row["department_id"])
                if dept.coverage_alerted_at and dept.coverage_alerted_at > now - COVERAGE_ALERT_EVERY:
                    continue
                for uid in await leads_or_managers(session, company_id, dept.id):
                    await notify_keyed(session, company_id=company_id, user_id=uid, kind=NotificationKind.COVERAGE_GAP,
                                       title_key="n.coverage_gap", params={"dept": dept.name})
                dept.coverage_alerted_at = now
                counts["coverage_alerts"] += 1
    await session.flush()
    return counts
