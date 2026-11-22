import uuid
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import NotificationChannel, NotificationKind, Role
from app.i18n import status_label, t, task_title
from app.models import Company, Department, Notification, TelegramUser, User


def _format_due(due: datetime | None, tz_name: str) -> str:
    if due is None:
        return "—"
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
    return due.astimezone(tz).strftime("%d.%m %H:%M %Z")


async def notify_task(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: NotificationKind,
    task,
    title_key: str,
    body_key: str | None = None,
) -> None:
    """Notification about a task, written in the recipient's language and company time zone.

    Dashboard notification always; Telegram DM too when the user linked their account and
    pressed Start (bots cannot DM first) [A6]. DMs are sent by a rate-limited job [A5]."""
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        return
    company = await session.get(Company, task.company_id)
    lang = user.language
    params = {
        "code": task.code,
        "title": task_title(task, lang),
        "priority": task.priority,
        "status": status_label(task.status, lang),
        "due": _format_due(task.due_at, company.timezone if company else "UTC"),
    }
    title = t(title_key, lang, **params)[:255]
    body = t(body_key, lang, **params) if body_key else None
    session.add(
        Notification(
            company_id=task.company_id,
            user_id=user_id,
            task_id=task.id,
            channel=NotificationChannel.DASHBOARD,
            kind=kind,
            title=title,
            body=body,
        )
    )
    if user.telegram_user_id is None:
        return
    tg_user = await session.get(TelegramUser, user.telegram_user_id)
    if tg_user is not None and tg_user.can_dm:
        session.add(
            Notification(
                company_id=task.company_id,
                user_id=user_id,
                task_id=task.id,
                channel=NotificationChannel.TELEGRAM_DM,
                kind=kind,
                title=title,
                body=body,
            )
        )


async def notify_keyed(
    session: AsyncSession,
    *,
    company_id: uuid.UUID,
    user_id: uuid.UUID,
    kind: NotificationKind,
    title_key: str,
    body_key: str | None = None,
    params: dict | None = None,
    task_id: uuid.UUID | None = None,
    message_id: uuid.UUID | None = None,
) -> None:
    """Generic notification rendered in the recipient's language (dashboard + DM when linked)."""
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        return
    params = params or {}
    title = t(title_key, user.language, **params)[:255]
    body = t(body_key, user.language, **params) if body_key else None
    channels = [NotificationChannel.DASHBOARD]
    if user.telegram_user_id is not None:
        tg_user = await session.get(TelegramUser, user.telegram_user_id)
        if tg_user is not None and tg_user.can_dm:
            channels.append(NotificationChannel.TELEGRAM_DM)
    for channel in channels:
        session.add(
            Notification(
                company_id=company_id,
                user_id=user_id,
                task_id=task_id,
                message_id=message_id,
                channel=channel,
                kind=kind,
                title=title,
                body=body,
            )
        )


async def company_executives(session: AsyncSession, company_id: uuid.UUID) -> list[uuid.UUID]:
    """Managers and owners of a company, including owners who oversee it from another company."""
    from app.models import UserCompanyAccess

    own = await manager_ids(session, company_id)
    cross = (
        await session.scalars(
            select(User.id)
            .join(UserCompanyAccess, UserCompanyAccess.user_id == User.id)
            .where(UserCompanyAccess.company_id == company_id, User.role == Role.OWNER, User.is_active.is_(True))
        )
    ).all()
    return list(dict.fromkeys([*own, *cross]))


async def department_lead_ids(session: AsyncSession, department_id: uuid.UUID | None) -> list[uuid.UUID]:
    if department_id is None:
        return []
    dept = await session.get(Department, department_id)
    if dept and dept.lead_user_id:
        return [dept.lead_user_id]
    rows = await session.scalars(
        select(User.id).where(
            User.department_id == department_id, User.role == Role.DEPT_LEAD, User.is_active.is_(True)
        )
    )
    return list(rows)


async def manager_ids(session: AsyncSession, company_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await session.scalars(
        select(User.id).where(
            User.company_id == company_id,
            User.role.in_([Role.MANAGER, Role.OWNER]),
            User.is_active.is_(True),
        )
    )
    return list(rows)


async def leads_or_managers(
    session: AsyncSession, company_id: uuid.UUID, department_id: uuid.UUID | None
) -> list[uuid.UUID]:
    return await department_lead_ids(session, department_id) or await manager_ids(session, company_id)
