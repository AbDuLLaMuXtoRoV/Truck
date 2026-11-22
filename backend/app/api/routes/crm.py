"""Unified inbox, response SLA, escalations (blueprint sec. 2, 7, 10)."""

import statistics
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentActor, require
from app.api.schemas import AttachmentOut, DepartmentRef, TaskDetailOut, TaskOut
from app.api.schemas_crm import (
    ClockOut,
    ConversationOut,
    DepartmentResponse,
    EscalateIn,
    EscalationClockBrief,
    EscalationOut,
    InboxMessageBrief,
    LinkMessageIn,
    MessageToTaskIn,
    NoResponseIn,
    ResponseStatsOut,
    ResponseTrendDay,
    TaskBrief,
    ThreadMessageOut,
    ThreadOut,
)
from app.api.serializers import serialize_tasks
from app.core.rbac import Actor, Perm, can_manage_task, can_read_task
from app.domain.enums import TaskEventType, TaskMessageRelation, TaskSource, TaskStatus
from app.models import (
    Company,
    Department,
    Mailbox,
    Message,
    ResponseClock,
    ResponseEscalation,
    Task,
    TaskMessage,
    TelegramGroup,
    TelegramUser,
    utcnow,
)
from app.services import tasks as task_svc
from app.services.audit import record_audit
from app.services.response import (
    close_not_needed,
    link_clock_to_task,
    manual_escalation,
    preview_of,
    seconds_left,
)
from app.telegram.client import message_link

router = APIRouter(prefix="/api", tags=["crm"])


# --------------------------------------------------------------------------- helpers


def clock_out(c: ResponseClock, now: datetime | None = None) -> ClockOut:
    return ClockOut(
        id=c.id, status=c.status, started_at=c.started_at, due_at=c.due_at, seconds_left=seconds_left(c, now),
        level=c.level, critical=c.critical, answered_at=c.answered_at, answered_by_name=c.answered_by_name,
        response_seconds=c.response_seconds, closed_reason=c.closed_reason,
    )


def task_brief(t: Task) -> TaskBrief:
    return TaskBrief(id=t.id, code=t.code, title=t.title, i18n=t.i18n or {}, status=t.status, priority=t.priority)


async def _visible_channels(session, actor: Actor) -> tuple[set | None, set | None]:
    """None = all channels of the company. Department-scoped roles see their department's channels."""
    if actor.has(Perm.TASKS_READ_ALL) or actor.has(Perm.MESSAGES_READ):
        return None, None
    if actor.department_id is None:
        return set(), set()
    groups = set((await session.scalars(select(TelegramGroup.id).where(
        TelegramGroup.company_id == actor.company_id, TelegramGroup.department_id == actor.department_id))).all())
    boxes = set((await session.scalars(select(Mailbox.id).where(
        Mailbox.company_id == actor.company_id, Mailbox.department_id == actor.department_id))).all())
    return groups, boxes


def _key_parts(key: str) -> tuple[str, uuid.UUID]:
    try:
        if key.startswith("tg:"):
            return "telegram", uuid.UUID(key[3:])
        if key.startswith("mail:"):
            return "email", uuid.UUID(key.split(":")[1])
    except (ValueError, IndexError):
        pass
    raise HTTPException(422, detail={"code": "bad_key", "message": "Unknown conversation key"})


async def _sender_names(session, messages: list[Message]) -> dict[uuid.UUID, str]:
    ids = {m.sender_id for m in messages if m.sender_id}
    if not ids:
        return {}
    return {u.id: u.display_name for u in (await session.scalars(select(TelegramUser).where(TelegramUser.id.in_(ids)))).all()}


def _sender(m: Message, names: dict) -> str:
    if m.sender_id:
        return names.get(m.sender_id, "unknown")
    if m.from_address:
        return m.from_address.split("<")[0].strip() or m.from_address
    return "unknown"


async def _channels(session, company_id) -> tuple[dict, dict, dict]:
    groups = {g.id: g for g in (await session.scalars(select(TelegramGroup).where(TelegramGroup.company_id == company_id))).all()}
    boxes = {b.id: b for b in (await session.scalars(select(Mailbox).where(Mailbox.company_id == company_id))).all()}
    depts = {d.id: d for d in (await session.scalars(select(Department).where(Department.company_id == company_id))).all()}
    return groups, boxes, depts


# --------------------------------------------------------------------------- inbox


@router.get("/inbox", response_model=list[ConversationOut])
async def inbox(
    session: DB,
    actor: CurrentActor,
    source: str = Query(default="all", pattern="^(all|telegram|email)$"),
    state: str = Query(default="all", pattern="^(all|unanswered|overdue|answered)$"),
    department_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=200),
    hours: int = Query(default=72, ge=1, le=720),
    limit: int = Query(default=50, ge=1, le=200),
):
    """Conversations across Telegram groups and mailboxes, most urgent first, with live timers."""
    now = utcnow()
    groups, boxes, depts = await _channels(session, actor.company_id)
    vis_groups, vis_boxes = await _visible_channels(session, actor)
    stmt = select(Message).where(
        Message.company_id == actor.company_id, Message.thread_key.is_not(None), Message.sent_at >= now - timedelta(hours=hours)
    )
    if source != "all":
        stmt = stmt.where(Message.channel == source)
    if vis_groups is not None:
        stmt = stmt.where(or_(Message.group_id.in_(vis_groups or [uuid.uuid4()]), Message.mailbox_id.in_(vis_boxes or [uuid.uuid4()])))
    messages = (await session.scalars(stmt.order_by(Message.sent_at.desc()).limit(3000))).all()
    threads: dict[str, list[Message]] = {}
    for m in messages:
        threads.setdefault(m.thread_key, []).append(m)
    pending = defaultdict(list)
    linked_task: dict[str, uuid.UUID] = {}
    if threads:
        for c in (await session.scalars(select(ResponseClock).where(
            ResponseClock.company_id == actor.company_id, ResponseClock.thread_key.in_(list(threads))
        ).order_by(ResponseClock.started_at.desc()))).all():
            if c.status == "pending":
                pending[c.thread_key].append(c)
            if c.task_id and c.thread_key not in linked_task:
                linked_task[c.thread_key] = c.task_id
    names = await _sender_names(session, [t[0] for t in threads.values()])
    tasks = {t.id: t for t in (await session.scalars(select(Task).where(Task.id.in_(set(linked_task.values()))))).all()} if linked_task else {}

    out: list[ConversationOut] = []
    for key, msgs in threads.items():
        last = msgs[0]
        if last.channel == "telegram":
            ch = groups.get(last.group_id)
            if ch is None:
                continue
            name, dept_id, channel_id = ch.title, ch.department_id, ch.id
        else:
            ch = boxes.get(last.mailbox_id)
            if ch is None:
                continue
            name, dept_id, channel_id = ch.email_address, ch.department_id, ch.id
        if department_id and dept_id != department_id:
            continue
        clocks = pending.get(key, [])
        oldest = min(clocks, key=lambda c: c.started_at) if clocks else None
        overdue = oldest is not None and oldest.due_at <= now
        if state == "unanswered" and not clocks or state == "overdue" and not overdue or state == "answered" and clocks:
            continue
        subject = next((m.subject for m in msgs if m.subject), None)
        if q:
            hay = " ".join([name, subject or "", _sender(last, names), preview_of(last)]).lower()
            if q.lower() not in hay:
                continue
        dept = depts.get(dept_id)
        task = tasks.get(linked_task.get(key))
        out.append(ConversationOut(
            key=key, source=last.channel, channel_id=channel_id, channel_name=name,
            department=DepartmentRef(id=dept.id, code=dept.code, name=dept.name) if dept else None,
            subject=subject,
            last_message=InboxMessageBrief(id=last.id, sender_name=_sender(last, names), sender_kind=last.sender_kind,
                                           direction=last.direction, preview=preview_of(last), sent_at=last.sent_at),
            unanswered=len(clocks), oldest_pending=clock_out(oldest, now) if oldest else None,
            task=task_brief(task) if task else None, updated_at=last.sent_at,
        ))

    def rank(c: ConversationOut):
        if c.oldest_pending is not None:
            return (0 if c.oldest_pending.seconds_left <= 0 else 1, c.oldest_pending.seconds_left, 0)
        return (2, 0, -c.updated_at.timestamp())

    out.sort(key=rank)
    return out[:limit]


@router.get("/inbox/thread", response_model=ThreadOut)
async def thread(key: str, session: DB, actor: CurrentActor):
    source, channel_id = _key_parts(key)
    vis_groups, vis_boxes = await _visible_channels(session, actor)
    if source == "telegram":
        ch = await session.get(TelegramGroup, channel_id)
        visible = vis_groups is None or channel_id in vis_groups
        name = ch.title if ch else ""
    else:
        ch = await session.get(Mailbox, channel_id)
        visible = vis_boxes is None or channel_id in vis_boxes
        name = ch.email_address if ch else ""
    if ch is None or ch.company_id != actor.company_id or not visible:
        raise HTTPException(404, detail={"code": "not_found", "message": "Conversation not found"})
    messages = list((await session.scalars(
        select(Message).where(Message.thread_key == key).options(selectinload(Message.attachments))
        .order_by(Message.sent_at.desc()).limit(200)
    )).unique().all())
    messages.reverse()
    ids = [m.id for m in messages]
    clocks = {c.message_id: c for c in (await session.scalars(select(ResponseClock).where(ResponseClock.message_id.in_(ids)))).all()} if ids else {}
    links = (await session.execute(select(TaskMessage.message_id, Task).join(Task, Task.id == TaskMessage.task_id)
                                   .where(TaskMessage.message_id.in_(ids)))).all() if ids else []
    codes: dict[uuid.UUID, list[str]] = defaultdict(list)
    task_map: dict[uuid.UUID, Task] = {}
    for mid, t in links:
        codes[mid].append(t.code)
        task_map[t.id] = t
    for c in clocks.values():
        if c.task_id and c.task_id not in task_map:
            t = await session.get(Task, c.task_id)
            if t is not None:
                task_map[t.id] = t
    names = await _sender_names(session, messages)
    dept = await session.get(Department, ch.department_id) if ch.department_id else None
    now = utcnow()
    visible_tasks = [t for t in task_map.values() if can_read_task(actor, t)]
    return ThreadOut(
        key=key, source=source, channel_id=ch.id, channel_name=name,
        subject=next((m.subject for m in messages if m.subject), None),
        department=DepartmentRef(id=dept.id, code=dept.code, name=dept.name) if dept else None,
        messages=[ThreadMessageOut(
            id=m.id, direction=m.direction, sender_name=_sender(m, names), sender_kind=m.sender_kind,
            classification=m.classification, subject=m.subject, text=m.text, transcript=m.transcript, sent_at=m.sent_at,
            telegram_link=message_link(m.tg_chat_id, m.tg_message_id, (m.raw or {}).get("chat", {}).get("username")) if m.tg_chat_id else None,
            attachments=[AttachmentOut.model_validate(a) for a in m.attachments],
            clock=clock_out(clocks[m.id], now) if m.id in clocks else None,
            task_codes=codes.get(m.id, []),
        ) for m in messages],
        tasks=await serialize_tasks(session, visible_tasks),
    )


async def _clock_for_actor(session, clock_id: uuid.UUID, actor: Actor) -> ResponseClock:
    clock = await session.get(ResponseClock, clock_id)
    if clock is None or clock.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Not found"})
    if not (actor.has(Perm.TASKS_READ_ALL) or (actor.department_id and clock.department_id == actor.department_id)):
        raise HTTPException(404, detail={"code": "not_found", "message": "Not found"})
    return clock


@router.post("/inbox/clocks/{clock_id}/no-response", response_model=ClockOut)
async def no_response(clock_id: uuid.UUID, body: NoResponseIn, session: DB, actor: CurrentActor):
    """Configurable exception: this message needs no reply (recorded in the audit log)."""
    clock = await _clock_for_actor(session, clock_id, actor)
    await close_not_needed(session, clock, reason=body.reason, user_id=actor.user_id)
    record_audit(session, actor, "response.no_reply_needed", "response_clock", clock.id, after={"reason": body.reason})
    await session.commit()
    return clock_out(clock)


@router.post("/inbox/messages/{message_id}/task", response_model=TaskOut, status_code=201)
async def message_to_task(message_id: uuid.UUID, body: MessageToTaskIn, session: DB, actor: CurrentActor):
    message = await session.get(Message, message_id)
    if message is None or message.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Message not found"})
    ch = await session.get(TelegramGroup, message.group_id) if message.group_id else await session.get(Mailbox, message.mailbox_id)
    title = (body.title or preview_of(message))[:200]
    task = await task_svc.create_task(
        session, actor=actor, title=title, category=body.category, priority=body.priority,
        department_id=ch.department_id if ch else None, truck_id=getattr(ch, "truck_id", None),
        source=TaskSource.MANUAL, group_id=message.group_id, mailbox_id=message.mailbox_id,
        source_message=message, source_text=preview_of(message), status=TaskStatus.NEEDS_REVIEW,
        linked_messages=[(message, TaskMessageRelation.SOURCE)],
    )
    await link_clock_to_task(session, message.id, task)
    await session.commit()
    return (await serialize_tasks(session, [task]))[0]


@router.post("/tasks/{task_id}/link-message", response_model=TaskDetailOut)
async def link_message(task_id: uuid.UUID, body: LinkMessageIn, session: DB, actor: CurrentActor):
    """Cross-channel case linking: attach a Telegram message or an email to an existing issue."""
    from app.api.routes.tasks import _detail

    task = await task_svc.get_task_for_actor(session, task_id, actor)
    if not can_manage_task(actor, task):
        raise HTTPException(403, detail={"code": "forbidden", "message": "You cannot change this issue"})
    message = await session.get(Message, body.message_id)
    if message is None or message.company_id != task.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Message not found"})
    await task_svc.link_message(session, task, message, TaskMessageRelation.EVIDENCE, actor, note="linked manually")
    await link_clock_to_task(session, message.id, task)
    await session.commit()
    return await _detail(session, task, actor)


@router.post("/tasks/{task_id}/escalate", response_model=TaskDetailOut)
async def escalate(task_id: uuid.UUID, body: EscalateIn, session: DB, actor: CurrentActor):
    from app.api.routes.tasks import _detail

    task = await task_svc.get_task_for_actor(session, task_id, actor)
    escalation = await manual_escalation(session, task, actor_user_id=actor.user_id, reason=body.reason)
    task_svc.add_event(session, task, actor, TaskEventType.ESCALATED, reason=body.reason,
                       data={"kind": "manual", "notified": escalation.notified_names})
    await session.commit()
    return await _detail(session, task, actor)


# --------------------------------------------------------------------------- escalations


async def escalations_out(session, rows: list[ResponseEscalation]) -> list[EscalationOut]:
    clocks = {c.id: c for c in (await session.scalars(select(ResponseClock).where(
        ResponseClock.id.in_({r.clock_id for r in rows if r.clock_id})))).all()} if rows else {}
    task_ids = {r.task_id for r in rows if r.task_id} | {c.task_id for c in clocks.values() if c.task_id}
    tasks = {t.id: t for t in (await session.scalars(select(Task).where(Task.id.in_(task_ids)))).all()} if task_ids else {}
    out = []
    for r in rows:
        c = clocks.get(r.clock_id)
        t = tasks.get(r.task_id or (c.task_id if c else None))
        channel = None
        if c is not None:
            from app.services.response import channel_name_of
            channel = EscalationClockBrief(id=c.id, channel_name=await channel_name_of(session, c),
                                           sender_name=c.sender_name, preview=c.preview)
        out.append(EscalationOut(id=r.id, created_at=r.created_at, level=r.level, kind=r.kind, reason=r.reason,
                                 notified_names=list(r.notified_names or []), clock=channel,
                                 task=task_brief(t) if t else None))
    return out


@router.get("/escalations", response_model=list[EscalationOut])
async def escalations(session: DB, actor: CurrentActor, limit: int = Query(default=50, ge=1, le=200)):
    stmt = select(ResponseEscalation).where(ResponseEscalation.company_id == actor.company_id)
    if not actor.has(Perm.TASKS_READ_ALL):
        dept = actor.department_id
        stmt = stmt.outerjoin(ResponseClock, ResponseClock.id == ResponseEscalation.clock_id).outerjoin(
            Task, Task.id == ResponseEscalation.task_id
        ).where(or_(ResponseClock.department_id == dept, Task.department_id == dept))
    rows = list((await session.scalars(stmt.order_by(ResponseEscalation.created_at.desc()).limit(limit))).all())
    return await escalations_out(session, rows)


# --------------------------------------------------------------------------- response dashboard


@router.get("/dashboard/response", response_model=ResponseStatsOut)
async def response_stats(session: DB, actor: Actor = require(Perm.DASHBOARD_READ), days: int = Query(default=7, ge=1, le=90)):
    now = utcnow()
    company = await session.get(Company, actor.company_id)
    tz = ZoneInfo(company.timezone or "UTC")
    local = now.astimezone(tz)
    today = datetime(local.year, local.month, local.day, tzinfo=tz)
    scope = [ResponseClock.company_id == actor.company_id]
    if not actor.has(Perm.TASKS_READ_ALL) and actor.department_id is not None:
        scope.append(ResponseClock.department_id == actor.department_id)

    pending = list((await session.scalars(select(ResponseClock).where(*scope, ResponseClock.status == "pending"))).all())
    first = today - timedelta(days=days - 1)
    recent = list((await session.scalars(select(ResponseClock).where(
        *scope, ResponseClock.started_at >= first, ResponseClock.status != "not_needed"))).all())
    buckets = {(first + timedelta(days=i)).date(): [] for i in range(days)}
    for c in recent:
        d = c.started_at.astimezone(tz).date()
        if d in buckets:
            buckets[d].append(c)
    trend = []
    for d, items in buckets.items():
        answered = [c.response_seconds for c in items if c.status == "answered" and c.response_seconds is not None]
        trend.append(ResponseTrendDay(date=d.isoformat(), inbound=len(items), answered=len(answered),
                                      within_sla=sum(1 for s in answered if s <= 300),
                                      median_seconds=int(statistics.median(answered)) if answered else None))
    today_answered = [c.response_seconds for c in recent
                      if c.status == "answered" and c.answered_at and c.answered_at >= today and c.response_seconds is not None]
    depts = {d.id: d for d in (await session.scalars(select(Department).where(Department.company_id == actor.company_id))).all()}
    by_dept: dict = defaultdict(lambda: [0, 0])
    for c in pending:
        by_dept[c.department_id][0] += 1
        if c.due_at <= now:
            by_dept[c.department_id][1] += 1
    return ResponseStatsOut(
        unanswered_0_5=sum(1 for c in pending if c.due_at > now),
        overdue_5_plus=sum(1 for c in pending if c.due_at <= now),
        escalated_10_plus=sum(1 for c in pending if (now - c.started_at).total_seconds() >= 600),
        answered_today=len(today_answered),
        median_response_seconds_today=int(statistics.median(today_answered)) if today_answered else None,
        within_sla_pct_today=round(100 * sum(1 for s in today_answered if s <= 300) / len(today_answered), 1) if today_answered else None,
        trend=trend,
        by_department=sorted(
            [DepartmentResponse(department_id=k, code=depts[k].code if k in depts else "UNROUTED",
                                name=depts[k].name if k in depts else "Not routed", unanswered=v[0], overdue=v[1])
             for k, v in by_dept.items()],
            key=lambda x: (-x.overdue, -x.unanswered),
        ),
    )


# task detail helpers used by routes/tasks.py
async def task_crm_extras(session, task: Task) -> tuple[list[dict], dict | None]:
    rows = list((await session.scalars(select(ResponseEscalation).where(
        or_(ResponseEscalation.task_id == task.id,
            ResponseEscalation.clock_id.in_(select(ResponseClock.id).where(ResponseClock.task_id == task.id))))
        .order_by(ResponseEscalation.created_at))).all())
    escalations_list = [e.model_dump(mode="json") for e in await escalations_out(session, rows)]
    clocks = list((await session.scalars(select(ResponseClock).where(ResponseClock.task_id == task.id)
                                         .order_by(ResponseClock.started_at))).all())
    if not clocks:
        return escalations_list, None
    pending = [c for c in clocks if c.status == "pending"]
    answered = [c for c in clocks if c.status == "answered"]
    first_answer = min(answered, key=lambda c: c.answered_at) if answered else None
    info = {
        "message_answered": None if not (pending or answered) else not pending,
        "answered_at": first_answer.answered_at.isoformat() if first_answer else None,
        "answered_by_name": first_answer.answered_by_name if first_answer else None,
        "response_seconds": first_answer.response_seconds if first_answer else None,
        "pending": clock_out(min(pending, key=lambda c: c.started_at)).model_dump(mode="json") if pending else None,
    }
    return escalations_list, info


__all__ = ["router", "task_crm_extras", "clock_out"]
