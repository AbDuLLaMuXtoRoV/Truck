import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select, update

from app.api.deps import DB, CurrentActor, CurrentUser
from app.api.schemas import LoginIn, MeOut, MePatchIn, NotificationOut, TelegramLinkOut, TokenOut
from app.config import get_settings
from app.core.rbac import Actor, ROLE_PERMISSIONS
from app.core.security import create_access_token, new_link_token, verify_password
from app.domain.enums import NotificationChannel, NotificationStatus, Role
from app.models import Company, Notification, User, utcnow
from app.services.audit import record_audit

router = APIRouter(prefix="/api", tags=["auth"])


async def me_out(session, user: User) -> MeOut:
    company = await session.get(Company, user.company_id)
    return MeOut(
        id=user.id,
        full_name=user.full_name,
        role=user.role,
        department_id=user.department_id,
        email=user.email,
        is_active=user.is_active,
        telegram_linked=user.telegram_user_id is not None,
        language=user.language or "uz",
        company_id=company.id,
        company_name=company.name,
        company_timezone=company.timezone,
        permissions=sorted(p.value for p in ROLE_PERMISSIONS[Role(user.role)]),
    )


@router.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn, session: DB, request: Request):
    user = await session.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "Wrong email or password"},
        )
    user.last_login_at = utcnow()
    record_audit(
        session, Actor.for_user(user), "auth.login", "user", user.id,
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return TokenOut(access_token=create_access_token(user.id, user.company_id), user=await me_out(session, user))


@router.get("/auth/me", response_model=MeOut)
async def me(session: DB, user: CurrentUser):
    return await me_out(session, user)


@router.patch("/me", response_model=MeOut)
async def patch_me(body: MePatchIn, session: DB, user: CurrentUser):
    """Own profile: display name and language (UI + notifications)."""
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(user, key, value)
    await session.commit()
    return await me_out(session, user)


@router.post("/me/telegram-link", response_model=TelegramLinkOut)
async def telegram_link(session: DB, user: CurrentUser):
    """Deep link that binds this account to a Telegram user, enabling DM notifications [A6]."""
    settings = get_settings()
    token = new_link_token()
    user.tg_link_token = token
    user.tg_link_token_expires_at = utcnow() + timedelta(minutes=30)
    await session.commit()
    deep_link = f"https://t.me/{settings.telegram_bot_username}?start={token}" if settings.telegram_bot_username else None
    return TelegramLinkOut(deep_link=deep_link, token=token, expires_at=user.tg_link_token_expires_at)


def _mine(actor):
    return (Notification.user_id == actor.user_id, Notification.channel == NotificationChannel.DASHBOARD)


@router.get("/notifications", response_model=list[NotificationOut])
async def notifications(
    session: DB, actor: CurrentActor, unread_only: bool = False, limit: int = Query(default=50, ge=1, le=200)
):
    q = select(Notification).where(*_mine(actor))
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    rows = (await session.scalars(q.order_by(Notification.created_at.desc()).limit(limit))).all()
    return [NotificationOut.model_validate(n) for n in rows]


@router.get("/notifications/unread-count")
async def unread_count(session: DB, actor: CurrentActor) -> dict[str, int]:
    n = await session.scalar(
        select(func.count()).select_from(Notification).where(*_mine(actor), Notification.read_at.is_(None))
    )
    return {"unread": n or 0}


@router.post("/notifications/{notification_id}/read", status_code=204)
async def read_one(notification_id: uuid.UUID, session: DB, actor: CurrentActor):
    await session.execute(
        update(Notification)
        .where(Notification.id == notification_id, *_mine(actor), Notification.read_at.is_(None))
        .values(read_at=utcnow(), status=NotificationStatus.READ)
    )
    await session.commit()


@router.post("/notifications/read-all", status_code=204)
async def read_all(session: DB, actor: CurrentActor):
    await session.execute(
        update(Notification)
        .where(*_mine(actor), Notification.read_at.is_(None))
        .values(read_at=utcnow(), status=NotificationStatus.READ)
    )
    await session.commit()
