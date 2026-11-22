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


async def me_out(session, user: User, selected_company_id: uuid.UUID | None = None) -> MeOut:
    from app.api.deps import accessible_company_ids
    from app.api.schemas import CompanyRef

    company = await session.get(Company, selected_company_id or user.company_id)
    ids = await accessible_company_ids(session, user)
    companies = (await session.scalars(select(Company).where(Company.id.in_(ids)).order_by(Company.name))).all()
    return MeOut(
        home_company_id=user.company_id,
        companies=[CompanyRef(id=c.id, name=c.name) for c in companies],
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


MAX_FAILED_LOGINS = 5
LOCKOUT = timedelta(minutes=15)
_failed_logins: dict[str, list] = {}


def _recent_failures(email: str) -> list:
    cutoff = utcnow() - LOCKOUT
    attempts = [t for t in _failed_logins.get(email, []) if t > cutoff]
    _failed_logins[email] = attempts
    return attempts


@router.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn, session: DB, request: Request):
    """Password login. After 5 wrong passwords an account is locked for 15 minutes (brute-force
    protection for a publicly reachable dashboard)."""
    email = body.email.strip().lower()
    if len(_recent_failures(email)) >= MAX_FAILED_LOGINS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "too_many_attempts", "message": "Too many wrong passwords. Try again in 15 minutes."},
        )
    user = await session.scalar(select(User).where(func.lower(User.email) == email))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        _failed_logins.setdefault(email, []).append(utcnow())
        if user is not None:
            record_audit(session, Actor.for_user(user), "auth.login_failed", "user", user.id,
                         ip=request.headers.get("x-forwarded-for") or (request.client.host if request.client else None))
            await session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "invalid_credentials", "message": "Wrong email or password"},
        )
    _failed_logins.pop(email, None)
    user.last_login_at = utcnow()
    record_audit(
        session, Actor.for_user(user), "auth.login", "user", user.id,
        ip=request.client.host if request.client else None,
    )
    await session.commit()
    return TokenOut(access_token=create_access_token(user.id, user.company_id), user=await me_out(session, user))


@router.get("/auth/me", response_model=MeOut)
async def me(session: DB, user: CurrentUser, actor: CurrentActor):
    return await me_out(session, user, actor.company_id)


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
