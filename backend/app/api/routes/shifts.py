"""Shift check-in/out, handover with acknowledgement, coverage (blueprint sec. 2, 7, 10)."""

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import DB, CurrentActor, CurrentUser, require
from app.api.schemas_crm import (
    CoverageOut,
    HandoverOut,
    MyShiftOut,
    OnDutyUser,
    Ref,
    ShiftEndIn,
    ShiftEndOut,
    ShiftOut,
    TaskBrief,
)
from app.core.rbac import Actor, Perm
from app.models import Handover, Task, User
from app.services import shifts as svc
from app.services.audit import record_audit

router = APIRouter(prefix="/api", tags=["shifts"])


def shift_out(s) -> ShiftOut:
    return ShiftOut(id=s.id, started_at=s.started_at, ended_at=s.ended_at, status=s.status)


async def handover_out(session, h: Handover) -> HandoverOut:
    from_user = await session.get(User, h.from_user_id)
    to_user = await session.get(User, h.to_user_id)
    ids = [uuid.UUID(x) for x in h.task_ids]
    tasks = (await session.scalars(select(Task).where(Task.id.in_(ids)))).all() if ids else []
    return HandoverOut(
        id=h.id,
        from_user=Ref(id=from_user.id, full_name=from_user.full_name),
        to_user=Ref(id=to_user.id, full_name=to_user.full_name),
        status=h.status, note=h.note, task_count=len(ids),
        tasks=[TaskBrief(id=t.id, code=t.code, title=t.title, i18n=t.i18n or {}, status=t.status, priority=t.priority)
               for t in sorted(tasks, key=lambda t: t.priority)],
        created_at=h.created_at, responded_at=h.responded_at,
    )


@router.get("/shifts/me", response_model=MyShiftOut)
async def my_shift(session: DB, user: CurrentUser):
    active = await svc.active_shift(session, user.id)
    incoming = (await session.scalars(select(Handover).where(
        Handover.to_user_id == user.id, Handover.status == "pending").order_by(Handover.created_at))).all()
    outgoing = (await session.scalars(select(Handover).where(
        Handover.from_user_id == user.id, Handover.status == "pending").order_by(Handover.created_at))).all()
    return MyShiftOut(
        active=shift_out(active) if active else None,
        open_tasks=len(await svc.open_tasks_of(session, user.id)),
        incoming_handovers=[await handover_out(session, h) for h in incoming],
        outgoing_pending=[await handover_out(session, h) for h in outgoing],
    )


@router.post("/shifts/start", response_model=ShiftOut)
async def start(session: DB, user: CurrentUser, actor: CurrentActor):
    shift = await svc.start_shift(session, user)
    record_audit(session, actor, "shift.start", "shift", shift.id)
    await session.commit()
    return shift_out(shift)


@router.post("/shifts/end", response_model=ShiftEndOut)
async def end(body: ShiftEndIn, session: DB, user: CurrentUser, actor: CurrentActor):
    shift, handover = await svc.end_shift(session, user, handover_to_user_id=body.handover_to_user_id, note=body.note)
    record_audit(session, actor, "shift.end", "shift", shift.id,
                 after={"handover_to": str(body.handover_to_user_id) if body.handover_to_user_id else None})
    await session.commit()
    return ShiftEndOut(shift=shift_out(shift), handover=await handover_out(session, handover) if handover else None)


async def _handover(session, handover_id: uuid.UUID, user: User) -> Handover:
    h = await session.get(Handover, handover_id)
    if h is None or h.company_id != user.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Handover not found"})
    return h


@router.post("/handovers/{handover_id}/accept", response_model=HandoverOut)
async def accept(handover_id: uuid.UUID, session: DB, user: CurrentUser, actor: CurrentActor):
    h = await svc.accept_handover(session, await _handover(session, handover_id, user), user)
    record_audit(session, actor, "handover.accepted", "handover", h.id, after={"tasks": len(h.task_ids)})
    await session.commit()
    return await handover_out(session, h)


@router.post("/handovers/{handover_id}/decline", response_model=HandoverOut)
async def decline(handover_id: uuid.UUID, session: DB, user: CurrentUser, actor: CurrentActor):
    h = await svc.decline_handover(session, await _handover(session, handover_id, user), user)
    record_audit(session, actor, "handover.declined", "handover", h.id)
    await session.commit()
    return await handover_out(session, h)


@router.get("/shifts/coverage", response_model=list[CoverageOut])
async def coverage(session: DB, actor: Actor = require(Perm.DASHBOARD_READ)):
    rows = await svc.coverage(session, actor.company_id)
    return [CoverageOut(department_id=r["department_id"], code=r["code"], name=r["name"],
                        on_duty=[OnDutyUser(**u) for u in r["on_duty"]], open_issues=r["open_issues"],
                        unanswered=r["unanswered"], gap=r["gap"]) for r in rows]
