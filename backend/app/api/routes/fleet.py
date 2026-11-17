import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import case, func, select

from app.api.deps import DB, CurrentActor, require
from app.api.schemas import DepartmentOut, DepartmentPatchIn, TruckCreateIn, TruckOut
from app.core.rbac import Actor, Perm
from app.domain.enums import OPEN_STATUSES
from app.domain.truck_refs import normalize_unit
from app.models import Department, Task, Truck, User, utcnow
from app.services.audit import record_audit

router = APIRouter(prefix="/api", tags=["fleet"])


@router.get("/departments", response_model=list[DepartmentOut])
async def departments(session: DB, actor: CurrentActor):
    rows = (await session.scalars(select(Department).where(Department.company_id == actor.company_id).order_by(Department.code))).all()
    return [DepartmentOut.model_validate(d) for d in rows]


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
async def patch_department(
    department_id: uuid.UUID, body: DepartmentPatchIn, session: DB, actor: Actor = require(Perm.USERS_MANAGE)
):
    dept = await session.get(Department, department_id)
    if dept is None or dept.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Department not found"})
    changes = body.model_dump(exclude_unset=True)
    for key, uid in changes.items():
        if uid is not None:
            user = await session.get(User, uid)
            if user is None or user.company_id != actor.company_id:
                raise HTTPException(422, detail={"code": "invalid_user", "message": "Unknown user"})
        setattr(dept, key, uid)
    record_audit(session, actor, "department.updated", "department", dept.id, after={k: str(v) for k, v in changes.items()})
    await session.commit()
    return DepartmentOut.model_validate(dept)


@router.get("/trucks", response_model=list[TruckOut])
async def trucks(session: DB, actor: Actor = require(Perm.DASHBOARD_READ)):
    rows = (await session.scalars(select(Truck).where(Truck.company_id == actor.company_id))).all()
    now = utcnow()
    counts = {
        truck_id: (n, int(od or 0))
        for truck_id, n, od in (
            await session.execute(
                select(Task.truck_id, func.count(), func.sum(case((Task.due_at < now, 1), else_=0)))
                .where(Task.company_id == actor.company_id, Task.status.in_(list(OPEN_STATUSES)), Task.truck_id.is_not(None))
                .group_by(Task.truck_id)
            )
        ).all()
    }
    out = [
        TruckOut(
            id=t.id,
            unit_number=t.unit_number,
            vin=t.vin,
            plate=t.plate,
            is_active=t.is_active,
            open_tasks=counts.get(t.id, (0, 0))[0],
            overdue_tasks=counts.get(t.id, (0, 0))[1],
        )
        for t in rows
    ]
    out.sort(key=lambda t: (-t.open_tasks, int(normalize_unit(t.unit_number)) if (normalize_unit(t.unit_number) or "").isdigit() else 0))
    return out


@router.post("/trucks", response_model=TruckOut, status_code=201)
async def create_truck(body: TruckCreateIn, session: DB, actor: Actor = require(Perm.FLEET_MANAGE)):
    existing = (await session.scalars(select(Truck).where(Truck.company_id == actor.company_id))).all()
    if any(normalize_unit(t.unit_number) == normalize_unit(body.unit_number) for t in existing):
        raise HTTPException(409, detail={"code": "duplicate_unit", "message": "Truck unit already exists"})
    truck = Truck(id=uuid.uuid4(), company_id=actor.company_id, unit_number=body.unit_number.strip(), vin=body.vin, plate=body.plate)
    session.add(truck)
    record_audit(session, actor, "truck.created", "truck", truck.id, after={"unit_number": truck.unit_number})
    await session.commit()
    return TruckOut(id=truck.id, unit_number=truck.unit_number, vin=truck.vin, plate=truck.plate, is_active=True)
