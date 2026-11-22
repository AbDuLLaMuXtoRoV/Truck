import uuid
from collections.abc import AsyncIterator
from datetime import date
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Actor, Perm
from app.core.security import decode_access_token
from app.db import session_factory
from app.models import User, UserCompanyAccess
from app.services.audit import record_audit

_bearer = HTTPBearer(auto_error=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with session_factory()() as session:
        yield session


DB = Annotated[AsyncSession, Depends(get_db)]


async def current_user(
    session: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "unauthorized", "message": "Not authenticated"},
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None:
        raise unauthorized
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise unauthorized from None
    try:
        user = await session.get(User, uuid.UUID(payload["sub"]))
    except (KeyError, ValueError):
        raise unauthorized from None
    if user is None or not user.is_active or str(user.company_id) != payload.get("cid"):
        raise unauthorized
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def accessible_company_ids(session: AsyncSession, user: User) -> frozenset[uuid.UUID]:
    extra = (await session.scalars(select(UserCompanyAccess.company_id).where(UserCompanyAccess.user_id == user.id))).all()
    return frozenset({user.company_id, *extra})


_audited_today: set[tuple[uuid.UUID, uuid.UUID, date]] = set()


async def current_actor(
    session: DB, user: CurrentUser, x_company_id: Annotated[str | None, Header()] = None
) -> Actor:
    """Requests are scoped to one company: the user's own, or another one they were granted
    (X-Company-Id header). Cross-company access is audited once per day [blueprint sec. 2]."""
    companies = await accessible_company_ids(session, user)
    selected = user.company_id
    if x_company_id and x_company_id not in ("", "all"):
        try:
            selected = uuid.UUID(x_company_id)
        except ValueError:
            raise HTTPException(400, detail={"code": "bad_company", "message": "Invalid X-Company-Id"}) from None
        if selected not in companies:
            raise HTTPException(403, detail={"code": "company_forbidden", "message": "No access to this company"})
    actor = Actor.for_user(user, company_id=selected, company_ids=companies)
    if selected != user.company_id:
        key = (user.id, selected, date.today())
        if key not in _audited_today:
            _audited_today.add(key)
            record_audit(session, actor, "company.cross_access", "company", selected, company_id=selected)
            await session.commit()
    return actor


CurrentActor = Annotated[Actor, Depends(current_actor)]


def require(*perms: Perm):
    async def dep(actor: CurrentActor) -> Actor:
        missing = [p for p in perms if not actor.has(p)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "forbidden", "message": f"Missing permission: {', '.join(missing)}"},
            )
        return actor

    return Depends(dep)
