import uuid
from collections.abc import AsyncIterator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Actor, Perm
from app.core.security import decode_access_token
from app.db import session_factory
from app.models import User

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


async def current_actor(user: CurrentUser) -> Actor:
    return Actor.for_user(user)


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
