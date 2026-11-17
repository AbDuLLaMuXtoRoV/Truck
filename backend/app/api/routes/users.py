import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.deps import DB, CurrentActor, require
from app.api.schemas import UserCreateIn, UserOut, UserPatchIn
from app.core.rbac import Actor, Perm
from app.core.security import hash_password
from app.domain.enums import Role
from app.models import Department, User
from app.services.audit import record_audit

router = APIRouter(prefix="/api/users", tags=["users"])


def _out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        full_name=u.full_name,
        role=u.role,
        department_id=u.department_id,
        email=u.email,
        is_active=u.is_active,
        telegram_linked=u.telegram_user_id is not None,
        language=u.language or "uz",
    )


@router.get("", response_model=list[UserOut])
async def list_users(session: DB, actor: CurrentActor, department_id: uuid.UUID | None = None, active: bool = True):
    """Every signed-in user can list colleagues (needed for the assignee picker)."""
    q = select(User).where(User.company_id == actor.company_id)
    if active:
        q = q.where(User.is_active.is_(True))
    if department_id:
        q = q.where(User.department_id == department_id)
    rows = (await session.scalars(q.order_by(User.full_name))).unique().all()
    return [_out(u) for u in rows]


async def _check_department(session, actor: Actor, department_id: uuid.UUID | None) -> None:
    if department_id is None:
        return
    dept = await session.get(Department, department_id)
    if dept is None or dept.company_id != actor.company_id:
        raise HTTPException(422, detail={"code": "invalid_department", "message": "Unknown department"})


def _check_role_grant(actor: Actor, role: Role) -> None:
    if role == Role.OWNER and actor.role != Role.OWNER:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Only an owner can grant the owner role"})


@router.post("", response_model=UserOut, status_code=201)
async def create_user(body: UserCreateIn, session: DB, actor: Actor = require(Perm.USERS_MANAGE)):
    _check_role_grant(actor, body.role)
    await _check_department(session, actor, body.department_id)
    if await session.scalar(select(func.count()).select_from(User).where(func.lower(User.email) == body.email.lower())):
        raise HTTPException(409, detail={"code": "email_taken", "message": "Email already in use"})
    user = User(
        id=uuid.uuid4(),
        company_id=actor.company_id,
        email=body.email.lower(),
        full_name=body.full_name,
        password_hash=hash_password(body.password),
        role=body.role,
        department_id=body.department_id,
        language=body.language,
    )
    session.add(user)
    record_audit(session, actor, "user.created", "user", user.id, after={"email": user.email, "role": body.role.value})
    await session.commit()
    return _out(user)


@router.patch("/{user_id}", response_model=UserOut)
async def patch_user(user_id: uuid.UUID, body: UserPatchIn, session: DB, actor: Actor = require(Perm.USERS_MANAGE)):
    user = await session.get(User, user_id)
    if user is None or user.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "User not found"})
    changes = body.model_dump(exclude_unset=True)
    if "role" in changes:
        _check_role_grant(actor, changes["role"])
        if user.role == Role.OWNER and actor.role != Role.OWNER:
            raise HTTPException(403, detail={"code": "forbidden", "message": "Only an owner can change an owner"})
    if "department_id" in changes:
        await _check_department(session, actor, changes["department_id"])
    before = {k: str(getattr(user, k)) for k in changes}
    for k, v in changes.items():
        setattr(user, k, v)
    record_audit(session, actor, "user.updated", "user", user.id, before=before, after={k: str(v) for k, v in changes.items()})
    await session.commit()
    return _out(user)
