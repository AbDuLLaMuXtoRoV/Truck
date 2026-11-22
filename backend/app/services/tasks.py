"""Task engine: the only place task state changes. Humans, the AI pipeline and SLA jobs all go
through these functions, so the state machine and audit trail are enforced uniformly [B9]."""

import uuid
from collections.abc import Iterable
from datetime import datetime
from types import SimpleNamespace

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Actor, Perm, can_manage_task, can_read_task
from app.domain.enums import (
    NotificationKind,
    OPEN_STATUSES,
    Priority,
    TaskCategory,
    TaskEventType,
    TaskMessageRelation,
    TaskSource,
    TaskStatus,
)
from app.domain.sla import compute_due_at
from app.domain.task_state import TRANSITIONS, TransitionError, check_transition, is_reopen
from app.models import Company, Department, Message, SlaPolicy, Task, TaskEvent, TaskMessage, Truck, User, utcnow
from app.services.notifications import leads_or_managers, notify_task

S = TaskStatus


class TaskError(TransitionError):
    pass


# --------------------------------------------------------------------------- helpers


async def next_task_number(session: AsyncSession, company_id: uuid.UUID) -> int:
    """Atomic per-company counter (row lock on Postgres, serialised writes on SQLite)."""
    result = await session.execute(
        update(Company)
        .where(Company.id == company_id)
        .values(task_seq=Company.task_seq + 1)
        .returning(Company.task_seq)
    )
    return result.scalar_one()


async def load_sla_policies(session: AsyncSession, company_id: uuid.UUID) -> dict[tuple[str, str | None], int]:
    rows = await session.scalars(select(SlaPolicy).where(SlaPolicy.company_id == company_id))
    return {(p.priority, p.category): p.resolve_minutes for p in rows}


async def company_four_eyes(session: AsyncSession, company_id: uuid.UUID) -> bool:
    company = await session.get(Company, company_id)
    return bool((company.settings or {}).get("four_eyes", True)) if company else True


async def _validate_assignee(session: AsyncSession, company_id: uuid.UUID, user_id: uuid.UUID) -> User:
    user = await session.get(User, user_id)
    if user is None or user.company_id != company_id or not user.is_active:
        raise TaskError("invalid_assignee", "Assignee not found or inactive", http_status=422)
    return user


def _event(
    task: Task,
    actor: Actor,
    type_: TaskEventType,
    *,
    from_status: TaskStatus | None = None,
    to_status: TaskStatus | None = None,
    reason: str | None = None,
    data: dict | None = None,
) -> TaskEvent:
    return TaskEvent(
        company_id=task.company_id,
        task_id=task.id,
        type=type_,
        from_status=from_status,
        to_status=to_status,
        actor_kind=actor.kind,
        actor_user_id=actor.user_id,
        reason=reason,
        data=data or {},
    )


def add_event(
    session: AsyncSession,
    task: Task,
    actor: Actor,
    type_: TaskEventType,
    *,
    reason: str | None = None,
    data: dict | None = None,
) -> TaskEvent:
    event = _event(task, actor, type_, reason=reason, data=data)
    session.add(event)
    return event


def allowed_transitions(task: Task, actor: Actor, four_eyes: bool = True) -> list[str]:
    """Targets this actor may move the task to — lets the UI show only valid buttons."""
    out: list[str] = []
    # Moving to ASSIGNED picks an assignee in the same action, so probe with a placeholder.
    probe_assignee = task.assignee_id or actor.user_id or uuid.uuid4()
    for target in TRANSITIONS[TaskStatus(task.status)]:
        try:
            check_transition(
                task, target, actor, reason="x", four_eyes=four_eyes,
                new_assignee_id=probe_assignee if target == S.ASSIGNED else None,
            )
        except TransitionError:
            continue
        out.append(target.value)
    return sorted(out)


async def _validate_refs(
    session: AsyncSession,
    company_id: uuid.UUID,
    *,
    department_id: uuid.UUID | None = None,
    truck_id: uuid.UUID | None = None,
) -> None:
    """Never let a task point at another company's rows."""
    if department_id is not None:
        dept = await session.get(Department, department_id)
        if dept is None or dept.company_id != company_id:
            raise TaskError("invalid_department", "Unknown department", http_status=422)
    if truck_id is not None:
        truck = await session.get(Truck, truck_id)
        if truck is None or truck.company_id != company_id:
            raise TaskError("invalid_truck", "Unknown truck", http_status=422)


# --------------------------------------------------------------------------- create


async def create_task(
    session: AsyncSession,
    *,
    actor: Actor,
    title: str,
    description: str | None = None,
    i18n: dict | None = None,
    category: TaskCategory = TaskCategory.OTHER,
    priority: Priority = Priority.P3,
    department_id: uuid.UUID | None = None,
    truck_id: uuid.UUID | None = None,
    truck_unit_raw: str | None = None,
    driver_id: uuid.UUID | None = None,
    load_ref: str | None = None,
    load_id: uuid.UUID | None = None,
    issue_type: str | None = None,
    amount: float | None = None,
    trailer_ref: str | None = None,
    driver_name: str | None = None,
    mailbox_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    due_at: datetime | None = None,
    source: TaskSource = TaskSource.MANUAL,
    confidence: float | None = None,
    group_id: uuid.UUID | None = None,
    source_message: Message | None = None,
    source_text: str | None = None,
    status: TaskStatus | None = None,
    linked_messages: Iterable[tuple[Message, TaskMessageRelation]] = (),
    created_by_id: uuid.UUID | None = None,
    event_data: dict | None = None,
) -> Task:
    if actor.is_user and not actor.has(Perm.TASKS_CREATE):
        raise TaskError("forbidden", "You cannot create tasks", http_status=403)
    await _validate_refs(session, actor.company_id, department_id=department_id, truck_id=truck_id)
    if assignee_id is not None:
        await _validate_assignee(session, actor.company_id, assignee_id)
        # Creating a task already assigned skips review: allowed for self-assignment or for
        # someone who manages tasks of that department.
        probe = SimpleNamespace(company_id=actor.company_id, department_id=department_id)
        if actor.is_user and assignee_id != actor.user_id and not can_manage_task(actor, probe):
            raise TaskError("forbidden", "You can only assign new tasks to yourself", http_status=403)

    if status is None:
        status = S.ASSIGNED if assignee_id else S.NEEDS_REVIEW
    if status == S.ASSIGNED and assignee_id is None:
        raise TaskError("assignee_required", "Choose an assignee first", http_status=422)

    now = utcnow()
    if due_at is None:
        due_at = compute_due_at(now, priority, category, await load_sla_policies(session, actor.company_id))

    task = Task(
        id=uuid.uuid4(),
        company_id=actor.company_id,
        number=await next_task_number(session, actor.company_id),
        title=title.strip()[:200],
        description=description,
        i18n=i18n or {},
        category=category,
        priority=priority,
        status=status,
        department_id=department_id,
        truck_id=truck_id,
        truck_unit_raw=truck_unit_raw,
        driver_id=driver_id,
        load_ref=load_ref,
        load_id=load_id,
        issue_type=issue_type,
        amount=amount,
        trailer_ref=trailer_ref,
        driver_name=driver_name,
        mailbox_id=mailbox_id,
        assignee_id=assignee_id,
        created_by_id=created_by_id or actor.user_id,
        source=source,
        confidence=confidence,
        group_id=group_id,
        source_message_id=source_message.id if source_message else None,
        source_text=source_text,
        due_at=due_at,
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    await session.flush()
    session.add(_event(task, actor, TaskEventType.CREATED, to_status=status, data=event_data))

    seen: set[uuid.UUID] = set()
    for message, relation in linked_messages:
        if message.id in seen:
            continue
        seen.add(message.id)
        session.add(TaskMessage(task_id=task.id, message_id=message.id, relation=relation))

    if assignee_id is not None:
        session.add(_event(task, actor, TaskEventType.ASSIGNED, data={"assignee_id": str(assignee_id)}))
        await _notify_assigned(session, task)
    if priority == Priority.P1:
        for uid in await leads_or_managers(session, task.company_id, task.department_id):
            if uid != assignee_id:
                await notify_task(
                    session,
                    user_id=uid,
                    task=task,
                    kind=NotificationKind.REVIEW_NEEDED if status in (S.DETECTED, S.NEEDS_REVIEW) else NotificationKind.ASSIGNED,
                    title_key="n.p1.title",
                )
    await session.flush()
    return task


async def _notify_assigned(session: AsyncSession, task: Task) -> None:
    if task.assignee_id is None:
        return
    await notify_task(
        session,
        user_id=task.assignee_id,
        task=task,
        kind=NotificationKind.ASSIGNED,
        title_key="n.assigned.title",
        body_key="n.assigned.body",
    )


# --------------------------------------------------------------------------- transitions


async def transition_task(
    session: AsyncSession,
    task: Task,
    to_status: TaskStatus,
    actor: Actor,
    *,
    reason: str | None = None,
    assignee_id: uuid.UUID | None = None,
    data: dict | None = None,
) -> Task:
    if actor.is_user and not can_read_task(actor, task):
        raise TaskError("not_found", "Task not found", http_status=404)
    to_status = TaskStatus(to_status)
    from_status = TaskStatus(task.status)
    four_eyes = await company_four_eyes(session, task.company_id)

    previous_assignee = task.assignee_id
    new_assignee = assignee_id if to_status == S.ASSIGNED else None
    if new_assignee is not None:
        await _validate_assignee(session, task.company_id, new_assignee)
    check_transition(task, to_status, actor, reason=reason, four_eyes=four_eyes, new_assignee_id=new_assignee)
    if new_assignee is not None:
        task.assignee_id = new_assignee

    now = utcnow()
    task.status = to_status
    task.updated_at = now
    reopened = is_reopen(from_status, to_status)

    if to_status == S.IN_PROGRESS and task.started_at is None:
        task.started_at = now
    if to_status == S.COMPLETED:
        task.completed_at = now
        task.verified_by_id = actor.user_id
    if to_status == S.CANCELLED:
        task.cancelled_at = now
        task.cancel_reason = reason
    if to_status == S.BLOCKED:
        task.blocked_reason = reason
    if from_status == S.BLOCKED and to_status != S.BLOCKED:
        task.blocked_reason = None
    if from_status == S.CANCELLED:
        task.cancelled_at = None
        task.cancel_reason = None
    if to_status == S.NEEDS_REVIEW and from_status == S.ASSIGNED:
        task.assignee_id = None
    if reopened:
        task.reopen_count += 1
        task.completed_at = None
        task.verified_by_id = None

    session.add(
        _event(
            task,
            actor,
            TaskEventType.REOPENED if reopened else TaskEventType.STATUS_CHANGED,
            from_status=from_status,
            to_status=to_status,
            reason=reason,
            data=data,
        )
    )

    if task.assignee_id != previous_assignee and task.assignee_id is not None:
        session.add(_event(task, actor, TaskEventType.ASSIGNED, data={"assignee_id": str(task.assignee_id)}))
        await _notify_assigned(session, task)
    if to_status == S.PENDING_VERIFICATION:
        for uid in await leads_or_managers(session, task.company_id, task.department_id):
            if uid != task.assignee_id:
                await notify_task(
                    session,
                    user_id=uid,
                    task=task,
                    kind=NotificationKind.VERIFICATION_NEEDED,
                    title_key="n.verification.title",
                )
    await session.flush()
    return task


async def assign_task(session: AsyncSession, task: Task, assignee_id: uuid.UUID, actor: Actor) -> Task:
    """Assign or reassign. A candidate (detected / needs_review) becomes ASSIGNED — that is a review decision."""
    if TaskStatus(task.status) in (S.DETECTED, S.NEEDS_REVIEW):
        return await transition_task(session, task, S.ASSIGNED, actor, assignee_id=assignee_id)
    if TaskStatus(task.status) not in OPEN_STATUSES:
        raise TaskError("closed", "Cannot reassign a closed task")
    if actor.is_user and not can_manage_task(actor, task):
        raise TaskError("forbidden", "Only a department lead or manager can reassign", http_status=403)
    await _validate_assignee(session, task.company_id, assignee_id)
    if task.assignee_id == assignee_id:
        return task
    task.assignee_id = assignee_id
    task.updated_at = utcnow()
    session.add(_event(task, actor, TaskEventType.ASSIGNED, data={"assignee_id": str(assignee_id)}))
    await _notify_assigned(session, task)
    await session.flush()
    return task


EDITABLE_FIELDS = (
    "title",
    "description",
    "category",
    "priority",
    "department_id",
    "truck_id",
    "load_ref",
    "due_at",
    "issue_type",
    "amount",
    "trailer_ref",
    "driver_name",
    "next_action_at",
)


def _jsonable(value):
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


async def update_task_fields(session: AsyncSession, task: Task, actor: Actor, changes: dict) -> Task:
    if actor.is_user and not can_manage_task(actor, task):
        raise TaskError("forbidden", "Only a department lead or manager can edit this task", http_status=403)
    await _validate_refs(
        session, task.company_id, department_id=changes.get("department_id"), truck_id=changes.get("truck_id")
    )
    diff: dict[str, dict] = {}
    for field, value in changes.items():
        if field not in EDITABLE_FIELDS:
            continue
        old = getattr(task, field)
        if old != value:
            diff[field] = {"from": _jsonable(old), "to": _jsonable(value)}
            setattr(task, field, value)
    if "due_at" in diff:
        task.reminded_at = None
        task.escalation_level = 0
    if diff:
        task.updated_at = utcnow()
        session.add(_event(task, actor, TaskEventType.UPDATED, data={"changes": diff}))
        await session.flush()
    return task


async def add_comment(session: AsyncSession, task: Task, actor: Actor, text: str) -> TaskEvent:
    if actor.is_user and not can_read_task(actor, task):
        raise TaskError("not_found", "Task not found", http_status=404)
    event = _event(task, actor, TaskEventType.COMMENT, reason=text.strip())
    session.add(event)
    task.updated_at = utcnow()
    await session.flush()
    return event


async def link_message(
    session: AsyncSession,
    task: Task,
    message: Message,
    relation: TaskMessageRelation,
    actor: Actor,
    *,
    note: str | None = None,
) -> bool:
    exists = await session.get(TaskMessage, (task.id, message.id))
    if exists is not None:
        return False
    session.add(TaskMessage(task_id=task.id, message_id=message.id, relation=relation))
    session.add(
        _event(
            task,
            actor,
            TaskEventType.MESSAGE_LINKED,
            reason=note,
            data={"message_id": str(message.id), "relation": relation.value},
        )
    )
    return True


async def merge_tasks(session: AsyncSession, source: Task, target: Task, actor: Actor, reason: str | None) -> Task:
    """Close `source` as a duplicate of `target`, moving its message links [B12]."""
    if source.id == target.id:
        raise TaskError("invalid_merge", "Cannot merge a task into itself", http_status=422)
    if TaskStatus(target.status) not in OPEN_STATUSES:
        raise TaskError("invalid_merge", "Target task must be open", http_status=422)
    if actor.is_user and not (can_manage_task(actor, target) and can_read_task(actor, source)):
        raise TaskError("forbidden", "You cannot merge these tasks", http_status=403)

    links = (await session.scalars(select(TaskMessage).where(TaskMessage.task_id == source.id))).all()
    for link in links:
        if await session.get(TaskMessage, (target.id, link.message_id)) is None:
            session.add(
                TaskMessage(task_id=target.id, message_id=link.message_id, relation=TaskMessageRelation.DUPLICATE)
            )
    note = reason or f"Duplicate of {target.code}"
    await transition_task(session, source, S.CANCELLED, actor, reason=note, data={"merged_into": target.code})
    source.merged_into_id = target.id
    session.add(_event(source, actor, TaskEventType.MERGED, data={"into": target.code}))
    session.add(_event(target, actor, TaskEventType.MERGED, data={"from": source.code}))
    await session.flush()
    return target


async def get_task_for_actor(session: AsyncSession, task_id: uuid.UUID, actor: Actor) -> Task:
    task = await session.get(Task, task_id)
    if task is None or not can_read_task(actor, task):
        raise TaskError("not_found", "Task not found", http_status=404)
    return task
