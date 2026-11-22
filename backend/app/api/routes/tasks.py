import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentActor
from app.api.schemas import (
    AssignIn,
    CommentIn,
    LinkedMessageOut,
    MergeIn,
    TaskCreateIn,
    TaskDetailOut,
    TaskEventOut,
    TaskListOut,
    TaskOut,
    TaskPatchIn,
    TransitionIn,
    UserRef,
)
from app.api.serializers import serialize_messages, serialize_tasks
from app.core.rbac import Actor, Perm, can_manage_task
from app.domain.enums import OPEN_STATUSES, Priority, TaskCategory, TaskSource, TaskStatus
from app.models import Message, Task, TaskEvent, TaskMessage, utcnow
from app.services import tasks as svc

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def task_scope(actor: Actor):
    """Row-level visibility (docs/03-rbac.md)."""
    base = Task.company_id == actor.company_id
    if actor.has(Perm.TASKS_READ_ALL):
        return base
    conds = [Task.assignee_id == actor.user_id, Task.created_by_id == actor.user_id]
    if actor.has(Perm.TASKS_READ_DEPARTMENT) and actor.department_id is not None:
        conds.append(Task.department_id == actor.department_id)
    return and_(base, or_(*conds))


SORTS = {
    "created_desc": Task.created_at.desc(),
    "created_asc": Task.created_at.asc(),
    "due_asc": Task.due_at.asc().nulls_last(),  # same order on SQLite and Postgres
    "priority": Task.priority.asc(),
    "updated_desc": Task.updated_at.desc(),
}


@router.get("", response_model=TaskListOut)
async def list_tasks(
    session: DB,
    actor: CurrentActor,
    status: Annotated[list[TaskStatus] | None, Query()] = None,
    open: bool | None = None,
    overdue: bool | None = None,
    category: Annotated[list[TaskCategory] | None, Query()] = None,
    priority: Annotated[list[Priority] | None, Query()] = None,
    department_id: uuid.UUID | None = None,
    unrouted: bool = False,
    truck_id: uuid.UUID | None = None,
    group_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    mine: bool = False,
    source: TaskSource | None = None,
    q: str | None = Query(default=None, max_length=200),
    sort: str = "created_desc",
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    conds = [task_scope(actor)]
    if status:
        conds.append(Task.status.in_(status))
    if open is True:
        conds.append(Task.status.in_(list(OPEN_STATUSES)))
    elif open is False:
        conds.append(Task.status.not_in(list(OPEN_STATUSES)))
    if overdue:
        conds += [Task.status.in_(list(OPEN_STATUSES)), Task.due_at < utcnow()]
    if category:
        conds.append(Task.category.in_(category))
    if priority:
        conds.append(Task.priority.in_(priority))
    if department_id:
        conds.append(Task.department_id == department_id)
    if unrouted:
        conds.append(Task.department_id.is_(None))  # the dashboard's "Not routed" row
    if truck_id:
        conds.append(Task.truck_id == truck_id)
    if group_id:
        conds.append(Task.group_id == group_id)
    if assignee_id:
        conds.append(Task.assignee_id == assignee_id)
    if mine:
        conds.append(Task.assignee_id == actor.user_id)
    if source:
        conds.append(Task.source == source)
    if q:
        term = f"%{q.strip()}%"
        num = q.strip().upper().removeprefix("T-")
        text_match = or_(Task.title.ilike(term), Task.description.ilike(term), Task.load_ref.ilike(term))
        conds.append(or_(text_match, Task.number == int(num)) if num.isdigit() else text_match)

    where = and_(*conds)
    total = await session.scalar(select(func.count()).select_from(Task).where(where))
    order = SORTS.get(sort, SORTS["created_desc"])
    rows = (await session.scalars(select(Task).where(where).order_by(order, Task.number.desc()).limit(limit).offset(offset))).all()
    return TaskListOut(items=await serialize_tasks(session, rows), total=total or 0)


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(body: TaskCreateIn, session: DB, actor: CurrentActor):
    task = await svc.create_task(
        session,
        actor=actor,
        title=body.title,
        description=body.description,
        category=body.category,
        priority=body.priority,
        department_id=body.department_id or actor.department_id,
        truck_id=body.truck_id,
        load_ref=body.load_ref,
        assignee_id=body.assignee_id,
        due_at=body.due_at,
        source=TaskSource.MANUAL,
    )
    await session.commit()
    return (await serialize_tasks(session, [task]))[0]


async def _detail(session, task: Task, actor: Actor) -> TaskDetailOut:
    base = (await serialize_tasks(session, [task]))[0]
    events = (
        await session.scalars(
            select(TaskEvent).where(TaskEvent.task_id == task.id).order_by(TaskEvent.created_at, TaskEvent.id)
        )
    ).unique().all()
    links = (
        await session.execute(
            select(TaskMessage.relation, Message)
            .join(Message, Message.id == TaskMessage.message_id)
            .where(TaskMessage.task_id == task.id)
            .options(selectinload(Message.attachments))
            .order_by(Message.sent_at)
        )
    ).all()
    relations = {m.id: rel for rel, m in links}
    messages = await serialize_messages(session, [m for _, m in links])
    four_eyes = await svc.company_four_eyes(session, task.company_id)
    manages = can_manage_task(actor, task)
    from app.api.routes.crm import task_crm_extras

    escalations, response = await task_crm_extras(session, task)
    return TaskDetailOut(
        **base.model_dump(),
        source_text=task.source_text,
        events=[
            TaskEventOut(
                id=e.id,
                type=e.type,
                from_status=e.from_status,
                to_status=e.to_status,
                actor_kind=e.actor_kind,
                actor=UserRef.model_validate(e.actor) if e.actor else None,
                reason=e.reason,
                data=e.data or {},
                created_at=e.created_at,
            )
            for e in events
        ],
        messages=[LinkedMessageOut(**m.model_dump(), relation=relations[m.id]) for m in messages],
        allowed_transitions=svc.allowed_transitions(task, actor, four_eyes),
        can_edit=manages,
        can_assign=manages and TaskStatus(task.status) in OPEN_STATUSES,
        escalations=escalations,
        response=response,
    )


@router.get("/{task_id}", response_model=TaskDetailOut)
async def get_task(task_id: uuid.UUID, session: DB, actor: CurrentActor):
    task = await svc.get_task_for_actor(session, task_id, actor)
    return await _detail(session, task, actor)


@router.patch("/{task_id}", response_model=TaskDetailOut)
async def patch_task(task_id: uuid.UUID, body: TaskPatchIn, session: DB, actor: CurrentActor):
    task = await svc.get_task_for_actor(session, task_id, actor)
    await svc.update_task_fields(session, task, actor, body.model_dump(exclude_unset=True))
    await session.commit()
    return await _detail(session, task, actor)


@router.post("/{task_id}/transition", response_model=TaskDetailOut)
async def transition(task_id: uuid.UUID, body: TransitionIn, session: DB, actor: CurrentActor):
    task = await svc.get_task_for_actor(session, task_id, actor)
    await svc.transition_task(session, task, body.to_status, actor, reason=body.reason, assignee_id=body.assignee_id)
    await session.commit()
    return await _detail(session, task, actor)


@router.post("/{task_id}/assign", response_model=TaskDetailOut)
async def assign(task_id: uuid.UUID, body: AssignIn, session: DB, actor: CurrentActor):
    task = await svc.get_task_for_actor(session, task_id, actor)
    await svc.assign_task(session, task, body.assignee_id, actor)
    await session.commit()
    return await _detail(session, task, actor)


@router.post("/{task_id}/comments", response_model=TaskDetailOut)
async def comment(task_id: uuid.UUID, body: CommentIn, session: DB, actor: CurrentActor):
    task = await svc.get_task_for_actor(session, task_id, actor)
    await svc.add_comment(session, task, actor, body.text)
    await session.commit()
    return await _detail(session, task, actor)


@router.post("/{task_id}/merge", response_model=TaskDetailOut)
async def merge(task_id: uuid.UUID, body: MergeIn, session: DB, actor: CurrentActor):
    source = await svc.get_task_for_actor(session, task_id, actor)
    target = await svc.get_task_for_actor(session, body.into_task_id, actor)
    await svc.merge_tasks(session, source, target, actor, body.reason)
    await session.commit()
    return await _detail(session, target, actor)
