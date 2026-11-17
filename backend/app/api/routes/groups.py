import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.deps import DB, require
from app.api.schemas import DepartmentRef, GroupOut, GroupPatchIn, TruckRef
from app.core.rbac import Actor, Perm
from app.domain.enums import OPEN_STATUSES
from app.models import Department, Message, Task, TelegramGroup, Truck, utcnow
from app.i18n import group_text
from app.services.audit import record_audit
from app.workers.queue import enqueue_reply

router = APIRouter(prefix="/api/groups", tags=["groups"])


async def _out(session, groups: list[TelegramGroup]) -> list[GroupOut]:
    ids = [g.id for g in groups]
    msg_counts = dict(
        (await session.execute(
            select(Message.group_id, func.count()).where(Message.group_id.in_(ids)).group_by(Message.group_id)
        )).all()
    ) if ids else {}
    task_counts = dict(
        (await session.execute(
            select(Task.group_id, func.count())
            .where(Task.group_id.in_(ids), Task.status.in_(list(OPEN_STATUSES)))
            .group_by(Task.group_id)
        )).all()
    ) if ids else {}
    trucks = {t.id: t for t in (await session.scalars(select(Truck).where(Truck.id.in_({g.truck_id for g in groups if g.truck_id})))).all()}
    depts = {d.id: d for d in (await session.scalars(select(Department).where(Department.id.in_({g.department_id for g in groups if g.department_id})))).all()}
    return [
        GroupOut(
            id=g.id,
            title=g.title,
            tg_chat_id=g.tg_chat_id,
            chat_type=g.chat_type,
            kind=g.kind,
            truck=TruckRef.model_validate(trucks[g.truck_id]) if g.truck_id in trucks else None,
            department=DepartmentRef.model_validate(depts[g.department_id]) if g.department_id in depts else None,
            is_enabled=g.is_enabled,
            bot_status=g.bot_status,
            last_message_at=g.last_message_at,
            created_at=g.created_at,
            message_count=msg_counts.get(g.id, 0),
            open_tasks=task_counts.get(g.id, 0),
        )
        for g in groups
    ]


@router.get("", response_model=list[GroupOut])
async def list_groups(session: DB, actor: Actor = require(Perm.GROUPS_READ), enabled: bool | None = None):
    q = select(TelegramGroup).where(TelegramGroup.company_id == actor.company_id)
    if enabled is not None:
        q = q.where(TelegramGroup.is_enabled.is_(enabled))
    groups = (await session.scalars(q.order_by(TelegramGroup.is_enabled, TelegramGroup.title))).all()
    return await _out(session, list(groups))


@router.patch("/{group_id}", response_model=GroupOut)
async def patch_group(group_id: uuid.UUID, body: GroupPatchIn, session: DB, actor: Actor = require(Perm.GROUPS_MANAGE)):
    """Allow-list and mapping. Enabling a group starts storing its messages [A9]."""
    group = await session.get(TelegramGroup, group_id)
    if group is None or group.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Group not found"})
    changes = body.model_dump(exclude_unset=True)
    if changes.get("truck_id"):
        truck = await session.get(Truck, changes["truck_id"])
        if truck is None or truck.company_id != actor.company_id:
            raise HTTPException(422, detail={"code": "invalid_truck", "message": "Unknown truck"})
    if changes.get("department_id"):
        dept = await session.get(Department, changes["department_id"])
        if dept is None or dept.company_id != actor.company_id:
            raise HTTPException(422, detail={"code": "invalid_department", "message": "Unknown department"})

    before = {k: str(getattr(group, k)) for k in changes}
    for key, value in changes.items():
        setattr(group, key, value)
    if changes.get("is_enabled") and before.get("is_enabled") != "True":
        group.enabled_at = utcnow()
        group.enabled_by_user_id = actor.user_id
    record_audit(
        session, actor, "group.updated", "telegram_group", group.id,
        before=before, after={k: str(v) for k, v in changes.items()},
    )
    newly_enabled = changes.get("is_enabled") is True and before.get("is_enabled") != "True"
    await session.commit()
    if newly_enabled:
        # Tell the people in the group that the bot is now reading it [D1].
        await enqueue_reply(group.tg_chat_id, group_text("group_enabled"))
    return (await _out(session, [group]))[0]
