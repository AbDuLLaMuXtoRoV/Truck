"""SLA reminders and escalation ladder [C2]: assignee at 75 %, department lead at 100 %,
managers at 150 % of the resolution window. Idempotent via reminded_at / escalation_level."""

from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Actor
from app.domain.enums import OPEN_STATUSES, NotificationKind, TaskEventType, TaskStatus
from app.domain.sla import manager_escalation_at, reminder_at
from app.models import Task, utcnow
from app.services.notifications import leads_or_managers, manager_ids, notify_task
from app.services.tasks import add_event

WORKING = (TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED)


async def run_sla_checks(session: AsyncSession, now: datetime | None = None) -> dict[str, int]:
    now = now or utcnow()
    counts = {"reminders": 0, "lead_escalations": 0, "manager_escalations": 0}
    tasks = (
        await session.scalars(
            select(Task).where(
                Task.status.in_(list(OPEN_STATUSES)),
                Task.due_at.is_not(None),
                or_(Task.escalation_level < 2, Task.reminded_at.is_(None)),
            )
        )
    ).all()

    for task in tasks:
        system = Actor.system(task.company_id)
        due = task.due_at

        if (
            task.reminded_at is None
            and task.assignee_id is not None
            and task.status in WORKING
            and reminder_at(task.created_at, due) <= now < due
        ):
            await notify_task(
                session,
                user_id=task.assignee_id,
                task=task,
                kind=NotificationKind.REMINDER,
                title_key="n.reminder.title",
            )
            task.reminded_at = now
            add_event(session, task, system, TaskEventType.REMINDER, data={"due_at": due.isoformat()})
            counts["reminders"] += 1

        if now >= due and task.escalation_level < 1:
            recipients = set(await leads_or_managers(session, task.company_id, task.department_id))
            if task.assignee_id:
                recipients.add(task.assignee_id)
            for uid in recipients:
                await notify_task(
                    session,
                    user_id=uid,
                    task=task,
                    kind=NotificationKind.ESCALATION,
                    title_key="n.overdue.title",
                    body_key="n.overdue.body",
                )
            task.escalation_level = 1
            add_event(session, task, system, TaskEventType.ESCALATED, data={"level": 1})
            counts["lead_escalations"] += 1

        if now >= manager_escalation_at(task.created_at, due) and task.escalation_level < 2:
            for uid in await manager_ids(session, task.company_id):
                await notify_task(
                    session,
                    user_id=uid,
                    task=task,
                    kind=NotificationKind.ESCALATION,
                    title_key="n.escalated.title",
                )
            task.escalation_level = 2
            add_event(session, task, system, TaskEventType.ESCALATED, data={"level": 2})
            counts["manager_escalations"] += 1

    await session.flush()
    return counts
