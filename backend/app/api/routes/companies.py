"""Multi-company: company list/switching and the owner overview across companies (blueprint sec. 2, 10)."""

import statistics
import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.deps import DB, CurrentActor, require
from app.api.schemas_crm import CompanyCreateIn, CompanyOut, CompanyStats, OwnerOverviewOut
from app.core.rbac import Actor, Perm
from app.domain.enums import OPEN_STATUSES, BotMembership, Role, TaskStatus
from app.models import (
    Company,
    Department,
    Mailbox,
    ResponseClock,
    ResponseEscalation,
    Task,
    TelegramGroup,
    UserCompanyAccess,
    utcnow,
)
from app.services.audit import record_audit

router = APIRouter(prefix="/api", tags=["companies"])

DEFAULT_DEPARTMENTS = [
    ("DISPATCH", "Dispatch"),
    ("ACCOUNTING", "Accounting"),
    ("ELD", "ELD / Compliance"),
    ("FLEET", "Fleet / Maintenance"),
    ("TRAILER", "Trailers"),
    ("SAFETY", "Safety"),
    ("HR", "HR"),
]


async def _counts(session, company_id: uuid.UUID) -> tuple[int, int]:
    groups = await session.scalar(select(func.count()).select_from(TelegramGroup).where(
        TelegramGroup.company_id == company_id, TelegramGroup.is_enabled.is_(True),
        TelegramGroup.bot_status.in_([BotMembership.MEMBER, BotMembership.ADMINISTRATOR]))) or 0
    boxes = await session.scalar(select(func.count()).select_from(Mailbox).where(
        Mailbox.company_id == company_id, Mailbox.is_enabled.is_(True), Mailbox.status == "connected")) or 0
    return groups, boxes


@router.get("/companies", response_model=list[CompanyOut])
async def companies(session: DB, actor: CurrentActor):
    rows = (await session.scalars(select(Company).where(Company.id.in_(actor.company_ids)).order_by(Company.name))).all()
    out = []
    for c in rows:
        groups, boxes = await _counts(session, c.id)
        out.append(CompanyOut(id=c.id, name=c.name, timezone=c.timezone, is_home=c.id == actor.home_company_id,
                              telegram_groups=groups, mailboxes=boxes))
    return out


@router.post("/companies", response_model=CompanyOut, status_code=201)
async def create_company(body: CompanyCreateIn, session: DB, actor: CurrentActor):
    if actor.role != Role.OWNER:
        raise HTTPException(403, detail={"code": "forbidden", "message": "Only an owner can add companies"})
    company = Company(id=uuid.uuid4(), name=body.name.strip(), timezone=body.timezone, settings={"four_eyes": True})
    session.add(company)
    await session.flush()
    for code, name in DEFAULT_DEPARTMENTS:
        session.add(Department(company_id=company.id, code=code, name=name))
    session.add(UserCompanyAccess(user_id=actor.user_id, company_id=company.id, granted_by_user_id=actor.user_id))
    record_audit(session, actor, "company.created", "company", company.id, after={"name": company.name}, company_id=company.id)
    await session.commit()
    return CompanyOut(id=company.id, name=company.name, timezone=company.timezone, is_home=False)


@router.get("/owner/overview", response_model=OwnerOverviewOut)
async def owner_overview(session: DB, actor: Actor = require(Perm.TASKS_READ_ALL)):
    """Executive view across every company this user may access (cross-company access is audited)."""
    now = utcnow()
    day_ago = now - timedelta(hours=24)
    rows = (await session.scalars(select(Company).where(Company.id.in_(actor.company_ids)).order_by(Company.name))).all()
    per: list[CompanyStats] = []
    for c in rows:
        groups, boxes = await _counts(session, c.id)
        pending = (await session.scalars(select(ResponseClock.due_at).where(
            ResponseClock.company_id == c.id, ResponseClock.status == "pending"))).all()
        answered = [s for s in (await session.scalars(select(ResponseClock.response_seconds).where(
            ResponseClock.company_id == c.id, ResponseClock.status == "answered", ResponseClock.answered_at >= day_ago))).all()
            if s is not None]
        per.append(CompanyStats(
            company_id=c.id, name=c.name, telegram_groups=groups, gmail_accounts=boxes,
            unanswered=sum(1 for d in pending if d > now),
            overdue_responses=sum(1 for d in pending if d <= now),
            open_issues=await session.scalar(select(func.count()).select_from(Task).where(
                Task.company_id == c.id, Task.status.in_(list(OPEN_STATUSES)))) or 0,
            resolved_24h=await session.scalar(select(func.count()).select_from(Task).where(
                Task.company_id == c.id, Task.status == TaskStatus.COMPLETED, Task.completed_at >= day_ago)) or 0,
            escalations_24h=await session.scalar(select(func.count()).select_from(ResponseEscalation).where(
                ResponseEscalation.company_id == c.id, ResponseEscalation.created_at >= day_ago)) or 0,
            median_response_seconds_24h=int(statistics.median(answered)) if answered else None,
            within_sla_pct_24h=round(100 * sum(1 for s in answered if s <= 300) / len(answered), 1) if answered else None,
        ))
    if len(rows) > 1:
        record_audit(session, actor, "company.overview", "company", None, after={"companies": len(rows)})
        await session.commit()
    return OwnerOverviewOut(
        companies=len(per),
        telegram_groups=sum(p.telegram_groups for p in per),
        gmail_accounts=sum(p.gmail_accounts for p in per),
        unanswered=sum(p.unanswered for p in per),
        overdue_responses=sum(p.overdue_responses for p in per),
        open_issues=sum(p.open_issues for p in per),
        resolved_24h=sum(p.resolved_24h for p in per),
        escalations_24h=sum(p.escalations_24h for p in per),
        per_company=per,
    )
