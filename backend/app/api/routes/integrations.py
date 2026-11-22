"""Integrations admin: Telegram status, Gmail mailboxes (OAuth), TMS loads, staff roster
(blueprint sec. 5, 10 "Admin")."""

import logging
import uuid

import jwt
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import func, or_, select

from app.api.deps import DB, require
from app.api.schemas import DepartmentRef
from app.api.schemas_crm import (
    GmailConnectIn,
    GmailConnectOut,
    GmailStatus,
    IntegrationsOut,
    LoadImportIn,
    LoadImportOut,
    LoadOut,
    MailboxOut,
    MailboxPatchIn,
    Ref,
    TelegramIdentityOut,
    TelegramIdentityPatchIn,
    TelegramStatus,
    TmsStatus,
)
from app.config import get_settings
from app.core.rbac import Actor, Perm
from app.domain.enums import OPEN_STATUSES, BotMembership
from app.models import Department, Load, Mailbox, Message, ResponseClock, Task, TelegramGroup, TelegramUser, User
from app.services import gmail, tms
from app.services.audit import record_audit
from app.workers.queue import enqueue_analysis

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["integrations"])


async def mailbox_out(session, m: Mailbox) -> MailboxOut:
    dept = await session.get(Department, m.department_id) if m.department_id else None
    return MailboxOut(
        id=m.id, email_address=m.email_address, display_name=m.display_name,
        department=DepartmentRef(id=dept.id, code=dept.code, name=dept.name) if dept else None,
        status=m.status, is_enabled=m.is_enabled, last_sync_at=m.last_sync_at, last_error=m.last_error,
        message_count=await session.scalar(select(func.count()).select_from(Message).where(Message.mailbox_id == m.id)) or 0,
        unanswered=await session.scalar(select(func.count()).select_from(ResponseClock).where(
            ResponseClock.mailbox_id == m.id, ResponseClock.status == "pending")) or 0,
        supervisor_id=m.supervisor_id, manager_id=m.manager_id, backup_id=m.backup_id,
    )


@router.get("/integrations/status", response_model=IntegrationsOut)
async def status(session: DB, actor: Actor = require(Perm.GROUPS_READ)):
    s = get_settings()
    present = [BotMembership.MEMBER, BotMembership.ADMINISTRATOR]
    enabled = await session.scalar(select(func.count()).select_from(TelegramGroup).where(
        TelegramGroup.company_id == actor.company_id, TelegramGroup.is_enabled.is_(True), TelegramGroup.bot_status.in_(present))) or 0
    pending = await session.scalar(select(func.count()).select_from(TelegramGroup).where(
        TelegramGroup.company_id == actor.company_id, TelegramGroup.is_enabled.is_(False), TelegramGroup.bot_status.in_(present))) or 0
    boxes = (await session.scalars(select(Mailbox).where(Mailbox.company_id == actor.company_id).order_by(Mailbox.email_address))).all()
    last_import = await session.scalar(select(func.max(Load.updated_at)).where(Load.company_id == actor.company_id))
    return IntegrationsOut(
        telegram=TelegramStatus(connected=bool(s.telegram_bot_token) and s.telegram_mode != "off",
                                bot_username=s.telegram_bot_username or None, mode=s.telegram_mode,
                                groups_enabled=enabled, groups_pending=pending),
        gmail=GmailStatus(configured=gmail.is_configured(), mailboxes=[await mailbox_out(session, m) for m in boxes]),
        tms=TmsStatus(loads=await session.scalar(select(func.count()).select_from(Load).where(Load.company_id == actor.company_id)) or 0,
                      last_import_at=last_import),
    )


# --------------------------------------------------------------------------- Gmail


@router.get("/mailboxes", response_model=list[MailboxOut])
async def mailboxes(session: DB, actor: Actor = require(Perm.GROUPS_READ)):
    rows = (await session.scalars(select(Mailbox).where(Mailbox.company_id == actor.company_id).order_by(Mailbox.email_address))).all()
    return [await mailbox_out(session, m) for m in rows]


@router.post("/integrations/gmail/connect", response_model=GmailConnectOut)
async def gmail_connect(body: GmailConnectIn, actor: Actor = require(Perm.GROUPS_MANAGE)):
    if not gmail.is_configured():
        raise HTTPException(409, detail={"code": "gmail_not_configured",
                                         "message": "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first"})
    return GmailConnectOut(auth_url=gmail.auth_url(gmail.make_state(actor.user_id, actor.company_id, body.department_id)))


@router.get("/integrations/gmail/callback", include_in_schema=False)
async def gmail_callback(session: DB, code: str | None = None, state: str | None = None, error: str | None = None):
    """Google redirects here after consent; we store the mailbox and send the user back to the dashboard."""
    back = f"{get_settings().public_url.rstrip('/')}/settings?tab=integrations"
    if error or not code or not state:
        return RedirectResponse(f"{back}&gmail=error&reason={error or 'missing_code'}")
    try:
        mailbox = await gmail.connect_mailbox(session, code, state)
        record_audit(session, None, "mailbox.connected", "mailbox", mailbox.id, after={"email": mailbox.email_address},
                     company_id=mailbox.company_id)
        await session.commit()
    except jwt.PyJWTError:
        return RedirectResponse(f"{back}&gmail=error&reason=expired")
    except gmail.GmailError as exc:
        log.warning("gmail connect failed: %s", exc)
        return RedirectResponse(f"{back}&gmail=error&reason=google")
    return RedirectResponse(f"{back}&gmail=connected")


async def _mailbox(session, mailbox_id: uuid.UUID, actor: Actor) -> Mailbox:
    m = await session.get(Mailbox, mailbox_id)
    if m is None or m.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Mailbox not found"})
    return m


@router.patch("/mailboxes/{mailbox_id}", response_model=MailboxOut)
async def patch_mailbox(mailbox_id: uuid.UUID, body: MailboxPatchIn, session: DB, actor: Actor = require(Perm.GROUPS_MANAGE)):
    m = await _mailbox(session, mailbox_id, actor)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(m, key, value)
    record_audit(session, actor, "mailbox.updated", "mailbox", m.id, after={k: str(v) for k, v in changes.items()})
    await session.commit()
    return await mailbox_out(session, m)


@router.post("/mailboxes/{mailbox_id}/sync", response_model=MailboxOut)
async def sync_now(mailbox_id: uuid.UUID, session: DB, actor: Actor = require(Perm.GROUPS_MANAGE)):
    m = await _mailbox(session, mailbox_id, actor)
    try:
        n = await gmail.sync_mailbox(session, m)
        await session.commit()
        if n:
            await enqueue_analysis(m.id, kind="email")
    except gmail.GmailError as exc:
        await session.rollback()
        m = await _mailbox(session, mailbox_id, actor)
        m.status, m.last_error = "error", exc.message
        await session.commit()
    return await mailbox_out(session, m)


@router.delete("/mailboxes/{mailbox_id}", status_code=204)
async def disconnect(mailbox_id: uuid.UUID, session: DB, actor: Actor = require(Perm.GROUPS_MANAGE)):
    m = await _mailbox(session, mailbox_id, actor)
    m.status, m.is_enabled = "disconnected", False
    m.refresh_token_enc = m.access_token_enc = None  # forget the credentials
    record_audit(session, actor, "mailbox.disconnected", "mailbox", m.id)
    await session.commit()


# --------------------------------------------------------------------------- TMS loads


@router.post("/loads/import", response_model=LoadImportOut)
async def import_loads(body: LoadImportIn, session: DB, actor: Actor = require(Perm.FLEET_MANAGE)):
    records, errors = tms.parse_csv(body.csv)
    created, updated = await tms.upsert_loads(session, actor.company_id, records) if records else (0, 0)
    record_audit(session, actor, "loads.imported", "load", None, after={"created": created, "updated": updated})
    await session.commit()
    return LoadImportOut(created=created, updated=updated, errors=errors[:50])


@router.get("/loads", response_model=list[LoadOut])
async def loads(session: DB, actor: Actor = require(Perm.DASHBOARD_READ), q: str | None = Query(default=None, max_length=100),
                limit: int = Query(default=100, ge=1, le=500)):
    stmt = select(Load).where(Load.company_id == actor.company_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Load.load_ref.ilike(like), Load.truck_unit.ilike(like), Load.trailer_ref.ilike(like),
                              Load.driver_name.ilike(like), Load.broker.ilike(like)))
    rows = (await session.scalars(stmt.order_by(Load.updated_at.desc().nulls_last()).limit(limit))).all()
    open_counts = dict((await session.execute(
        select(Task.load_ref, func.count()).where(Task.company_id == actor.company_id, Task.status.in_(list(OPEN_STATUSES)),
                                                  Task.load_ref.in_([r.load_ref for r in rows])).group_by(Task.load_ref))).all()) if rows else {}
    return [LoadOut(id=r.id, load_ref=r.load_ref, truck_unit=r.truck_unit, trailer_ref=r.trailer_ref, driver_name=r.driver_name,
                    driver_phone=r.driver_phone, broker=r.broker, status=r.status, pickup=r.pickup, delivery=r.delivery,
                    open_issues=open_counts.get(r.load_ref, 0)) for r in rows]


# --------------------------------------------------------------------------- staff roster


@router.get("/roster/telegram", response_model=list[TelegramIdentityOut])
async def roster(session: DB, actor: Actor = require(Perm.GROUPS_READ)):
    """Telegram identities seen in the company's groups. Only staff replies stop the response clock."""
    people = (await session.scalars(select(TelegramUser).where(TelegramUser.company_id == actor.company_id)
                                    .order_by(TelegramUser.last_seen_at.desc().nulls_last()))).all()
    links = {u.telegram_user_id: u for u in (await session.scalars(select(User).where(
        User.company_id == actor.company_id, User.telegram_user_id.is_not(None)))).unique().all()}
    counts = dict((await session.execute(select(Message.sender_id, func.count()).where(
        Message.company_id == actor.company_id, Message.sender_id.is_not(None)).group_by(Message.sender_id))).all())
    return [TelegramIdentityOut(
        id=p.id, tg_user_id=p.tg_user_id, display_name=p.display_name, username=p.username,
        is_staff=p.is_staff or p.id in links,
        linked_user=Ref(id=links[p.id].id, full_name=links[p.id].full_name) if p.id in links else None,
        last_seen_at=p.last_seen_at, message_count=counts.get(p.id, 0),
    ) for p in people if not p.is_bot]


@router.patch("/roster/telegram/{identity_id}", response_model=TelegramIdentityOut)
async def patch_roster(identity_id: uuid.UUID, body: TelegramIdentityPatchIn, session: DB, actor: Actor = require(Perm.USERS_MANAGE)):
    person = await session.get(TelegramUser, identity_id)
    if person is None or person.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Not found"})
    changes = body.model_dump(exclude_unset=True)
    if "is_staff" in changes:
        person.is_staff = changes["is_staff"]
    if "linked_user_id" in changes:
        current = await session.scalar(select(User).where(User.telegram_user_id == person.id))
        if current is not None:
            current.telegram_user_id = None
        if changes["linked_user_id"] is not None:
            user = await session.get(User, changes["linked_user_id"])
            if user is None or user.company_id != actor.company_id:
                raise HTTPException(422, detail={"code": "invalid_user", "message": "Unknown user"})
            user.telegram_user_id = person.id
            person.is_staff = True
    record_audit(session, actor, "roster.updated", "telegram_user", person.id, after={k: str(v) for k, v in changes.items()})
    await session.commit()
    linked = await session.scalar(select(User).where(User.telegram_user_id == person.id))
    count = await session.scalar(select(func.count()).select_from(Message).where(Message.sender_id == person.id)) or 0
    return TelegramIdentityOut(id=person.id, tg_user_id=person.tg_user_id, display_name=person.display_name,
                               username=person.username, is_staff=person.is_staff or linked is not None,
                               linked_user=Ref(id=linked.id, full_name=linked.full_name) if linked else None,
                               last_seen_at=person.last_seen_at, message_count=count)
