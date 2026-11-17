from datetime import timedelta

from sqlalchemy import select

from app.core.rbac import Actor
from app.domain.enums import NotificationChannel, NotificationKind, Priority, TaskCategory, TaskEventType
from app.models import Notification, Task, TaskEvent, utcnow
from app.services.sla_jobs import run_sla_checks
from app.services.tasks import create_task


async def make_task(db, org, *, created_ago: timedelta, window: timedelta) -> Task:
    async with db() as s:
        task = await create_task(
            s,
            actor=Actor.for_user(org.users["manager"]),
            title="Fix ELD on 125",
            category=TaskCategory.ELD,
            priority=Priority.P2,
            department_id=org.depts["ELD"].id,
            assignee_id=org.users["eld_agent"].id,
        )
        now = utcnow()
        task.created_at = now - created_ago
        task.due_at = task.created_at + window
        await s.commit()
        return task


async def notifications(db, kind):
    async with db() as s:
        return list(
            (
                await s.scalars(
                    select(Notification).where(
                        Notification.kind == kind, Notification.channel == NotificationChannel.DASHBOARD
                    )
                )
            ).all()
        )


async def run(db, now=None):
    async with db() as s:
        counts = await run_sla_checks(s, now)
        await s.commit()
        return counts


async def test_reminder_at_75_percent(db, org):
    await make_task(db, org, created_ago=timedelta(minutes=50), window=timedelta(minutes=60))  # 83 % elapsed
    counts = await run(db)
    assert counts["reminders"] == 1 and counts["lead_escalations"] == 0
    [n] = await notifications(db, NotificationKind.REMINDER)
    assert n.user_id == org.users["eld_agent"].id
    assert (await run(db))["reminders"] == 0  # idempotent


async def test_no_reminder_too_early(db, org):
    await make_task(db, org, created_ago=timedelta(minutes=10), window=timedelta(minutes=60))
    assert (await run(db))["reminders"] == 0


async def test_escalation_ladder(db, org):
    task = await make_task(db, org, created_ago=timedelta(minutes=70), window=timedelta(minutes=60))
    counts = await run(db)
    assert counts["lead_escalations"] == 1 and counts["manager_escalations"] == 0
    recipients = {n.user_id for n in await notifications(db, NotificationKind.ESCALATION)}
    assert recipients == {org.users["eld_lead"].id, org.users["eld_agent"].id}

    later = utcnow() + timedelta(minutes=30)  # now at 100 min of a 60 min window (> 150 %)
    counts = await run(db, later)
    assert counts["manager_escalations"] == 1
    recipients = {n.user_id for n in await notifications(db, NotificationKind.ESCALATION)}
    assert org.users["manager"].id in recipients and org.users["owner"].id in recipients

    assert (await run(db, later)) == {"reminders": 0, "lead_escalations": 0, "manager_escalations": 0}
    async with db() as s:
        events = (await s.scalars(select(TaskEvent).where(TaskEvent.task_id == task.id, TaskEvent.type == TaskEventType.ESCALATED))).all()
    assert sorted(e.data["level"] for e in events) == [1, 2]
