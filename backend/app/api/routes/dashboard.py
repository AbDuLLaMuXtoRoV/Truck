from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from sqlalchemy import and_, case, func, or_, select

from app.api.deps import DB, require
from app.api.routes.tasks import task_scope
from app.api.schemas import (
    ActivityOut,
    ActivityTask,
    AIStatsOut,
    BadgesOut,
    DashboardSummary,
    DepartmentLoad,
    TrendDay,
    TrendOut,
)
from app.core.rbac import Actor, Perm
from app.domain.enums import OPEN_STATUSES, AnalysisStatus, BotMembership, TaskSource, TaskStatus
from app.models import AIExtraction, Company, Department, Message, Task, TaskEvent, TelegramGroup, utcnow

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
async def summary(session: DB, actor: Actor = require(Perm.DASHBOARD_READ)):
    now = utcnow()
    company = await session.get(Company, actor.company_id)
    tz = ZoneInfo(company.timezone or "UTC")
    local_now = now.astimezone(tz)
    day_start = datetime(local_now.year, local_now.month, local_now.day, tzinfo=tz)  # "today" in company time [C9]

    scope = task_scope(actor)
    open_ = Task.status.in_(list(OPEN_STATUSES))
    overdue = and_(open_, Task.due_at < now)

    async def count(*conds) -> int:
        return await session.scalar(select(func.count()).select_from(Task).where(scope, *conds)) or 0

    group_present = TelegramGroup.bot_status.in_([BotMembership.MEMBER, BotMembership.ADMINISTRATOR])
    gq = select(func.count()).select_from(TelegramGroup).where(TelegramGroup.company_id == actor.company_id)

    by_status_rows = (
        await session.execute(select(Task.status, func.count()).where(scope).group_by(Task.status))
    ).all()
    by_priority_rows = (
        await session.execute(select(Task.priority, func.count()).where(scope, open_).group_by(Task.priority))
    ).all()

    dept_rows = (
        await session.execute(
            select(
                Task.department_id,
                func.count(),
                func.sum(case((Task.due_at < now, 1), else_=0)),
            )
            .where(scope, open_)
            .group_by(Task.department_id)
        )
    ).all()
    departments = {
        d.id: d
        for d in (await session.scalars(select(Department).where(Department.company_id == actor.company_id))).all()
    }
    by_department = [
        DepartmentLoad(
            department_id=dept_id,
            code=departments[dept_id].code if dept_id in departments else "UNROUTED",
            name=departments[dept_id].name if dept_id in departments else "Not routed",
            open=n,
            overdue=int(od or 0),
        )
        for dept_id, n, od in dept_rows
    ]
    by_department.sort(key=lambda d: (-d.open, d.code))

    return DashboardSummary(
        connected_groups=await session.scalar(gq.where(group_present)) or 0,
        enabled_groups=await session.scalar(gq.where(group_present, TelegramGroup.is_enabled.is_(True))) or 0,
        pending_groups=await session.scalar(gq.where(group_present, TelegramGroup.is_enabled.is_(False))) or 0,
        open_tasks=await count(open_),
        overdue=await count(overdue),
        needs_review=await count(Task.status.in_([TaskStatus.DETECTED, TaskStatus.NEEDS_REVIEW])),
        pending_verification=await count(Task.status == TaskStatus.PENDING_VERIFICATION),
        completed_today=await count(Task.status == TaskStatus.COMPLETED, Task.completed_at >= day_start),
        created_today=await count(Task.created_at >= day_start),
        by_department=by_department,
        by_priority={p: n for p, n in by_priority_rows},
        by_status={s: n for s, n in by_status_rows},
    )


# --------------------------------------------------------------------------- richer overview data


@router.get("/badges", response_model=BadgesOut)
async def badges(session: DB, actor: Actor = require(Perm.DASHBOARD_READ)):
    """Small counts for the sidebar, cheap enough to poll."""
    scope = task_scope(actor)
    open_ = Task.status.in_(list(OPEN_STATUSES))

    async def count(*conds) -> int:
        return await session.scalar(select(func.count()).select_from(Task).where(scope, *conds)) or 0

    pending_groups = 0
    if actor.has(Perm.GROUPS_READ):
        pending_groups = await session.scalar(
            select(func.count())
            .select_from(TelegramGroup)
            .where(
                TelegramGroup.company_id == actor.company_id,
                TelegramGroup.is_enabled.is_(False),
                TelegramGroup.bot_status.in_([BotMembership.MEMBER, BotMembership.ADMINISTRATOR]),
            )
        ) or 0
    return BadgesOut(
        needs_review=await count(Task.status.in_([TaskStatus.DETECTED, TaskStatus.NEEDS_REVIEW])),
        overdue=await count(open_, Task.due_at < utcnow()),
        my_open=await count(open_, Task.assignee_id == actor.user_id),
        pending_groups=pending_groups,
    )


@router.get("/trend", response_model=TrendOut)
async def trend(session: DB, actor: Actor = require(Perm.DASHBOARD_READ), days: int = Query(default=14, ge=7, le=90)):
    """Tasks created / completed per day (company time zone), oldest first, zero days included."""
    company = await session.get(Company, actor.company_id)
    tz = ZoneInfo(company.timezone or "UTC")
    today = utcnow().astimezone(tz).date()
    first = today - timedelta(days=days - 1)
    since = datetime(first.year, first.month, first.day, tzinfo=tz)

    buckets = {first + timedelta(days=i): {"created": 0, "completed": 0, "ai_created": 0} for i in range(days)}
    rows = (
        await session.execute(
            select(Task.created_at, Task.completed_at, Task.source).where(
                task_scope(actor), or_(Task.created_at >= since, Task.completed_at >= since)
            )
        )
    ).all()
    for created_at, completed_at, source in rows:
        if created_at and created_at >= since:
            bucket = buckets.get(created_at.astimezone(tz).date())
            if bucket is not None:
                bucket["created"] += 1
                if source == TaskSource.AI:
                    bucket["ai_created"] += 1
        if completed_at and completed_at >= since:
            bucket = buckets.get(completed_at.astimezone(tz).date())
            if bucket is not None:
                bucket["completed"] += 1
    return TrendOut(days=[TrendDay(date=d.isoformat(), **v) for d, v in buckets.items()])


@router.get("/activity", response_model=list[ActivityOut])
async def activity(
    session: DB, actor: Actor = require(Perm.DASHBOARD_READ), limit: int = Query(default=20, ge=1, le=100)
):
    """Latest task events the user may see: the live feed on the overview."""
    rows = (
        await session.execute(
            select(TaskEvent, Task)
            .join(Task, Task.id == TaskEvent.task_id)
            .where(task_scope(actor))
            .order_by(TaskEvent.created_at.desc(), TaskEvent.id.desc())
            .limit(limit)
        )
    ).unique().all()
    return [
        ActivityOut(
            id=e.id,
            type=e.type,
            created_at=e.created_at,
            actor_kind=e.actor_kind,
            actor_name=e.actor.full_name if e.actor else None,
            from_status=e.from_status,
            to_status=e.to_status,
            reason=e.reason,
            data=e.data or {},
            task=ActivityTask(
                id=t.id, code=t.code, title=t.title, i18n=t.i18n or {}, priority=t.priority, status=t.status
            ),
        )
        for e, t in rows
    ]


@router.get("/ai", response_model=AIStatsOut)
async def ai_stats(session: DB, actor: Actor = require(Perm.DASHBOARD_READ)):
    """How the AI did over the last 7 days: volume, speed, and how reviewers judged its tasks."""
    window = 7
    since = utcnow() - timedelta(days=window)
    company = actor.company_id

    messages_analyzed = await session.scalar(
        select(func.count()).select_from(Message).where(
            Message.company_id == company,
            Message.analysis_status == AnalysisStatus.DONE,
            Message.analyzed_at >= since,
        )
    ) or 0
    calls = (
        await session.execute(
            select(
                func.count(),
                func.sum(case((AIExtraction.status != "ok", 1), else_=0)),
                func.avg(case((AIExtraction.status == "ok", AIExtraction.latency_ms), else_=None)),
            ).where(AIExtraction.company_id == company, AIExtraction.created_at >= since)
        )
    ).one()

    review_states = [TaskStatus.DETECTED, TaskStatus.NEEDS_REVIEW]
    tasks = (
        await session.execute(
            select(
                func.count(),
                func.sum(case((Task.status.in_(review_states), 1), else_=0)),
                func.sum(case((Task.status == TaskStatus.CANCELLED, 1), else_=0)),
                func.avg(Task.confidence),
            ).where(task_scope(actor), Task.source == TaskSource.AI, Task.created_at >= since)
        )
    ).one()
    ai_tasks, pending, rejected = tasks[0] or 0, int(tasks[1] or 0), int(tasks[2] or 0)
    return AIStatsOut(
        window_days=window,
        messages_analyzed=messages_analyzed,
        model_calls=calls[0] or 0,
        failed_calls=int(calls[1] or 0),
        avg_latency_ms=int(calls[2]) if calls[2] is not None else None,
        ai_tasks=ai_tasks,
        approved=ai_tasks - pending - rejected,
        rejected=rejected,
        pending_review=pending,
        avg_confidence=round(float(tasks[3]), 3) if tasks[3] is not None else None,
    )
