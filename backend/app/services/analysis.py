"""AI analysis pipeline: conversation window -> model -> labels + proposals -> case engine.

Works on a *channel*: a Telegram group or a Gmail mailbox (blueprint sec. 3). Besides creating and
updating issues it labels every new message (actionable / informational / automated / duplicate /
spam) so messages that need no reply stop their 5-minute response clock, and links issues across
channels by load / trailer / truck.
"""

import base64
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.extractor import Extractor, ExtractionResponse, get_extractor
from app.ai.prompts import AttachmentInput, ExtractionRequest, OpenTaskSummary, WindowMessage
from app.ai.schemas import ExtractionResult, NewTask, TaskUpdate
from app.config import get_settings
from app.core.rbac import Actor
from app.domain.enums import (
    CATEGORY_DEPARTMENT,
    OPEN_STATUSES,
    AnalysisStatus,
    AttachmentStatus,
    MessageKind,
    Priority,
    TaskCategory,
    TaskEventType,
    TaskMessageRelation,
    TaskSource,
    TaskStatus,
    TaskUpdateKind,
    TranscriptStatus,
)
from app.domain.identifiers import extract_load_refs, extract_trailer_refs, normalize_trailer
from app.domain.similarity import similarity
from app.domain.truck_refs import extract_truck_refs, normalize_unit, resolve_unit
from app.models import (
    AIExtraction,
    Company,
    Department,
    Load,
    Mailbox,
    Message,
    ResponseClock,
    Task,
    TelegramGroup,
    TelegramUser,
    Truck,
    User,
    utcnow,
)
from app.services.response import close_not_needed, link_clock_to_task
from app.services.storage import get_storage
from app.services.tasks import add_event, create_task, link_message, transition_task

log = logging.getLogger(__name__)

MAX_WINDOW_MESSAGES = 60
LEASE_SECONDS = 300
TRANSCRIPT_WAIT_SECONDS = 180
DOWNLOAD_WAIT_SECONDS = 120

# Attachments the model can read directly [B8]: images and PDFs, size-capped, a few per window.
VISION_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_ATTACHMENTS_PER_WINDOW = 4


@dataclass
class AnalysisOutcome:
    status: str  # ok | no_pending | waiting | locked | disabled | ai_off | error | refusal
    tasks_created: list[str] = field(default_factory=list)
    updates_applied: int = 0
    duplicates_linked: int = 0
    retry_after_seconds: int | None = None


# --------------------------------------------------------------------------- channels


@dataclass
class Channel:
    kind: str  # telegram | email
    id: uuid.UUID
    company_id: uuid.UUID
    title: str
    chat_kind: str  # truck | dispatch | department | other | email
    truck_id: uuid.UUID | None
    department_id: uuid.UUID | None
    enabled: bool

    @property
    def model(self):
        return TelegramGroup if self.kind == "telegram" else Mailbox

    @property
    def message_col(self):
        return Message.group_id if self.kind == "telegram" else Message.mailbox_id

    @property
    def task_col(self):
        return Task.group_id if self.kind == "telegram" else Task.mailbox_id


async def load_channel(session: AsyncSession, kind: str, channel_id: uuid.UUID) -> Channel | None:
    if kind == "telegram":
        g = await session.get(TelegramGroup, channel_id)
        if g is None:
            return None
        return Channel("telegram", g.id, g.company_id, g.title, g.kind, g.truck_id, g.department_id, g.is_enabled)
    m = await session.get(Mailbox, channel_id)
    if m is None:
        return None
    return Channel("email", m.id, m.company_id, m.display_name or m.email_address, "email", None, m.department_id,
                   m.is_enabled and m.status == "connected")


# --------------------------------------------------------------------------- lease


async def acquire_lease(session: AsyncSession, channel_id: uuid.UUID, now: datetime, kind: str = "telegram") -> bool:
    model = TelegramGroup if kind == "telegram" else Mailbox
    result = await session.execute(
        update(model)
        .where(model.id == channel_id, or_(model.analysis_lock_until.is_(None), model.analysis_lock_until < now))
        .values(analysis_lock_until=now + timedelta(seconds=LEASE_SECONDS))
    )
    return result.rowcount == 1


async def release_lease(session: AsyncSession, channel_id: uuid.UUID, kind: str = "telegram") -> None:
    model = TelegramGroup if kind == "telegram" else Mailbox
    await session.execute(update(model).where(model.id == channel_id).values(analysis_lock_until=None))


async def run_channel_analysis(
    sessionmaker: async_sessionmaker[AsyncSession],
    kind: str,
    channel_id: uuid.UUID,
    *,
    extractor: Extractor | None = None,
    force: bool = False,
) -> AnalysisOutcome:
    """Job entry point. The lease is committed separately so no DB transaction stays open
    while the model is thinking."""
    now = utcnow()
    async with sessionmaker() as session:
        if not await acquire_lease(session, channel_id, now, kind):
            return AnalysisOutcome("locked")
        await session.commit()
    try:
        async with sessionmaker() as session:
            outcome = await analyze_channel(session, kind, channel_id, extractor=extractor, force=force)
            await release_lease(session, channel_id, kind)
            await session.commit()
            return outcome
    except Exception:
        log.exception("analysis failed for %s %s", kind, channel_id)
        async with sessionmaker() as session:
            await release_lease(session, channel_id, kind)
            await session.commit()
        raise


async def run_group_analysis(sessionmaker, group_id: uuid.UUID, *, extractor: Extractor | None = None,
                             force: bool = False) -> AnalysisOutcome:
    return await run_channel_analysis(sessionmaker, "telegram", group_id, extractor=extractor, force=force)


async def analyze_group(session: AsyncSession, group_id: uuid.UUID, *, extractor: Extractor | None = None,
                        now: datetime | None = None, force: bool = False) -> AnalysisOutcome:
    return await analyze_channel(session, "telegram", group_id, extractor=extractor, now=now, force=force)


# --------------------------------------------------------------------------- core


async def analyze_channel(
    session: AsyncSession,
    kind: str,
    channel_id: uuid.UUID,
    *,
    extractor: Extractor | None = None,
    now: datetime | None = None,
    force: bool = False,
) -> AnalysisOutcome:
    """Analyse pending messages of one channel. Caller holds the lease and commits."""
    settings = get_settings()
    now = now or utcnow()
    ch = await load_channel(session, kind, channel_id)
    if ch is None:
        return AnalysisOutcome("no_pending")

    pending = list(
        (
            await session.scalars(
                select(Message)
                .where(ch.message_col == ch.id, Message.analysis_status == AnalysisStatus.PENDING)
                .order_by(Message.sent_at, Message.created_at)
                .limit(MAX_WINDOW_MESSAGES)
            )
        ).all()
    )
    if not pending:
        return AnalysisOutcome("no_pending")
    if not ch.enabled:
        _mark(pending, AnalysisStatus.SKIPPED, now)
        return AnalysisOutcome("disabled")

    extractor = extractor or get_extractor()
    if extractor is None:
        return AnalysisOutcome("ai_off")

    if not force:
        newest = max(m.created_at for m in pending)
        oldest = min(m.created_at for m in pending)
        quiet_for = (now - newest).total_seconds()
        waited = (now - oldest).total_seconds()
        transcribing = any(
            m.transcript_status == TranscriptStatus.PENDING
            and (now - m.created_at).total_seconds() < TRANSCRIPT_WAIT_SECONDS
            for m in pending
        )
        downloading = any(
            a.status == AttachmentStatus.PENDING
            and a.kind in (MessageKind.PHOTO, MessageKind.DOCUMENT)
            and (now - m.created_at).total_seconds() < DOWNLOAD_WAIT_SECONDS
            for m in pending
            for a in m.attachments
        )
        if waited < settings.analysis_max_wait_seconds and (
            quiet_for < settings.analysis_debounce_seconds - 2 or transcribing or downloading
        ):
            retry = max(5, int(settings.analysis_debounce_seconds - quiet_for))
            return AnalysisOutcome("waiting", retry_after_seconds=retry)

    ctx = await _build_context(session, ch, pending, now)
    response = await extractor.extract(ctx.request)

    extraction = AIExtraction(
        id=uuid.uuid4(),
        company_id=ch.company_id,
        group_id=ch.id if ch.kind == "telegram" else None,
        message_ids=[str(m.id) for m in pending],
        model=response.model,
        prompt_version=response.prompt_version,
        status=response.status,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
        cache_read_tokens=response.cache_read_tokens,
        latency_ms=response.latency_ms,
        request_id=response.request_id,
        raw_output=response.result.model_dump() if response.result else None,
        error=response.error,
    )
    session.add(extraction)

    if response.status != "ok" or response.result is None:
        if response.status == "refusal" or not response.retryable:
            # Not retryable: hand the window to humans instead of looping forever.
            _mark(pending, AnalysisStatus.FAILED, now)
        return AnalysisOutcome(response.status)

    outcome = await _apply_result(session, ch, ctx, response.result, extraction, now)
    extraction.tasks_created = len(outcome.tasks_created)
    extraction.updates_applied = outcome.updates_applied + outcome.duplicates_linked
    _mark(pending, AnalysisStatus.DONE, now)
    await session.flush()
    return outcome


def _mark(messages: list[Message], status: AnalysisStatus, now: datetime) -> None:
    for m in messages:
        m.analysis_status = status
        m.analyzed_at = now


def _collect_attachments(ref_map: dict[str, Message], pending_ids: set) -> list[AttachmentInput]:
    storage = get_storage()
    out: list[AttachmentInput] = []
    for ref, m in ref_map.items():
        if m.id not in pending_ids:
            continue
        for a in m.attachments:
            if len(out) >= MAX_ATTACHMENTS_PER_WINDOW:
                return out
            if a.status != AttachmentStatus.DOWNLOADED or not a.storage_key:
                continue
            mime = (a.mime_type or "").lower()
            if mime == "image/jpg":
                mime = "image/jpeg"
            limit = MAX_PDF_BYTES if mime == "application/pdf" else MAX_IMAGE_BYTES
            if mime not in VISION_TYPES and mime != "application/pdf":
                continue
            if a.file_size and a.file_size > limit:
                continue
            try:
                data = storage.read(a.storage_key)
            except (OSError, ValueError):
                log.warning("attachment %s missing from storage", a.id)
                continue
            if len(data) > limit:
                continue
            out.append(AttachmentInput(ref=ref, media_type=mime, data_b64=base64.b64encode(data).decode("ascii"),
                                       file_name=a.file_name))
    return out


# --------------------------------------------------------------------------- context


@dataclass
class _Context:
    request: ExtractionRequest
    ref_map: dict[str, Message]
    sender_names: dict[uuid.UUID, str]
    trucks_by_unit: dict[str, Truck]
    departments_by_code: dict[str, Department]
    departments_by_id: dict[uuid.UUID, Department]
    loads_by_ref: dict[str, Load]


def _sender_label(m: Message, sender_names: dict[uuid.UUID, str]) -> str:
    if m.sender_id:
        return sender_names.get(m.sender_id, "unknown")
    label = m.from_address or "unknown"
    if m.sender_kind == "staff":
        label += " [staff]"
    elif m.sender_kind == "automated":
        label += " [automated]"
    return label


async def _build_context(session: AsyncSession, ch: Channel, pending: list[Message], now: datetime) -> _Context:
    settings = get_settings()
    company = await session.get(Company, ch.company_id)
    pending_ids = {m.id for m in pending}

    first = pending[0]
    context_q = select(Message).where(
        ch.message_col == ch.id,
        Message.analysis_status != AnalysisStatus.PENDING,
        Message.sent_at <= first.sent_at,
        Message.id.not_in(list(pending_ids)),
    )
    if ch.kind == "email":  # email context = earlier messages of the same threads only
        context_q = context_q.where(Message.thread_key.in_({m.thread_key for m in pending if m.thread_key}))
    context_msgs = list(
        (await session.scalars(context_q.order_by(Message.sent_at.desc()).limit(settings.analysis_context_messages))).all()
    )
    context_msgs.reverse()

    if ch.kind == "telegram":
        loaded_tg_ids = {m.tg_message_id for m in context_msgs} | {m.tg_message_id for m in pending}
        reply_ids = {
            m.reply_to_tg_message_id
            for m in (*context_msgs, *pending)
            if m.reply_to_tg_message_id and m.reply_to_tg_message_id not in loaded_tg_ids
        }
        if reply_ids:
            targets = (
                await session.scalars(select(Message).where(Message.group_id == ch.id, Message.tg_message_id.in_(reply_ids)))
            ).all()
            context_msgs = sorted([*targets, *context_msgs], key=lambda m: (m.sent_at, m.created_at))

    ordered = [*context_msgs, *pending]
    ref_map: dict[str, Message] = {}
    ref_by_tg: dict[int, str] = {}
    for i, m in enumerate(ordered, start=1):
        ref = f"m{i}"
        ref_map[ref] = m
        if m.tg_message_id is not None:
            ref_by_tg[m.tg_message_id] = ref

    sender_ids = {m.sender_id for m in ordered if m.sender_id}
    sender_names: dict[uuid.UUID, str] = {}
    if sender_ids:
        tg_users = (await session.scalars(select(TelegramUser).where(TelegramUser.id.in_(sender_ids)))).all()
        staff_ids = set(
            (await session.scalars(select(User.telegram_user_id).where(User.telegram_user_id.in_(sender_ids)))).all()
        )
        for u in tg_users:
            tag = " [staff]" if (u.id in staff_ids or u.is_staff) else (" [driver]" if u.driver_id else "")
            sender_names[u.id] = f"{u.display_name}{tag}"

    trucks = (await session.scalars(select(Truck).where(Truck.company_id == ch.company_id))).all()
    trucks_by_unit = {normalize_unit(t.unit_number): t for t in trucks}
    trucks_by_id = {t.id: t for t in trucks}
    departments = (await session.scalars(select(Department).where(Department.company_id == ch.company_id))).all()

    hints: list[str] = []
    load_refs: list[str] = []
    trailer_refs: list[str] = []
    for m in pending:
        content = m.content_for_ai
        for unit in extract_truck_refs(content):
            if unit not in hints:
                hints.append(unit)
        load_refs += [x for x in extract_load_refs(content) if x not in load_refs]
        trailer_refs += [x for x in extract_trailer_refs(content) if x not in trailer_refs]

    loads = (
        (await session.scalars(select(Load).where(Load.company_id == ch.company_id, Load.load_ref.in_(load_refs)))).all()
        if load_refs else []
    )
    for ld in loads:
        if ld.truck_unit and normalize_unit(ld.truck_unit) not in hints:
            hints.append(normalize_unit(ld.truck_unit))
        if ld.trailer_ref and ld.trailer_ref not in trailer_refs:
            trailer_refs.append(ld.trailer_ref)

    # Cross-channel matching: the same truck, load or trailer may already have an open issue
    # that came from another group or from email.
    truck_ids = {t.id for u in hints if (t := trucks_by_unit.get(u))}
    if ch.truck_id:
        truck_ids.add(ch.truck_id)
    conds = [ch.task_col == ch.id]
    if truck_ids:
        conds.append(Task.truck_id.in_(truck_ids))
    if load_refs:
        conds.append(Task.load_ref.in_(load_refs))
    if trailer_refs:
        conds.append(Task.trailer_ref.in_(trailer_refs))
    open_tasks = (
        await session.scalars(
            select(Task)
            .where(Task.company_id == ch.company_id, Task.status.in_(list(OPEN_STATUSES)), or_(*conds))
            .order_by(Task.created_at.desc())
            .limit(settings.analysis_open_tasks_limit)
        )
    ).all()

    attachments = _collect_attachments(ref_map, pending_ids)
    request = ExtractionRequest(
        chat_title=ch.title,
        chat_kind=ch.chat_kind,
        default_truck_unit=trucks_by_id[ch.truck_id].unit_number if ch.truck_id in trucks_by_id else None,
        department_code=next((d.code for d in departments if d.id == ch.department_id), None),
        company_timezone=company.timezone if company else "UTC",
        now=now,
        truck_hints=hints,
        attachments=attachments,
        known_loads=[
            f"Load {ld.load_ref}: truck {ld.truck_unit or '-'}, trailer {ld.trailer_ref or '-'}, "
            f"driver {ld.driver_name or '-'}, status {ld.status or '-'}, broker {ld.broker or '-'}"
            for ld in loads
        ],
        messages=[
            WindowMessage(
                ref=ref,
                is_new=m.id in pending_ids,
                sent_at=m.sent_at,
                sender=_sender_label(m, sender_names),
                content=m.content_for_ai,
                reply_to_ref=ref_by_tg.get(m.reply_to_tg_message_id) if m.reply_to_tg_message_id else None,
                edited=m.edited_at is not None,
            )
            for ref, m in ref_map.items()
        ],
        open_tasks=[
            OpenTaskSummary(
                code=t.code,
                category=t.category,
                priority=t.priority,
                status=t.status,
                truck_unit=trucks_by_id[t.truck_id].unit_number if t.truck_id in trucks_by_id else t.truck_unit_raw,
                title=t.title + (f" [load {t.load_ref}]" if t.load_ref else "") + (f" [trailer {t.trailer_ref}]" if t.trailer_ref else ""),
                created_at=t.created_at,
            )
            for t in open_tasks
        ],
    )
    return _Context(
        request=request,
        ref_map=ref_map,
        sender_names=sender_names,
        trucks_by_unit=trucks_by_unit,
        departments_by_code={d.code: d for d in departments},
        departments_by_id={d.id: d for d in departments},
        loads_by_ref={ld.load_ref: ld for ld in loads},
    )


# --------------------------------------------------------------------------- apply


async def _apply_result(
    session: AsyncSession, ch: Channel, ctx: _Context, result: ExtractionResult, extraction: AIExtraction, now: datetime
) -> AnalysisOutcome:
    outcome = AnalysisOutcome("ok")
    await _apply_labels(session, ctx, result)
    for update_ in result.task_updates:
        if await _apply_update(session, ch, ctx, update_, extraction):
            outcome.updates_applied += 1
    for proposal in result.new_tasks:
        created = await _apply_new_task(session, ch, ctx, proposal, extraction, now)
        if created == "duplicate":
            outcome.duplicates_linked += 1
        elif created is not None:
            outcome.tasks_created.append(created)
    return outcome


async def _apply_labels(session: AsyncSession, ctx: _Context, result: ExtractionResult) -> None:
    """Messages that need no reply stop their response clock (configurable exception, recorded)."""
    for label in result.message_labels:
        if label.ref not in ctx.request.new_refs:
            continue
        message = ctx.ref_map[label.ref]
        message.classification = label.label
        if not label.requires_response:
            clock = await session.scalar(select(ResponseClock).where(ResponseClock.message_id == message.id))
            if clock is not None and clock.status == "pending" and not clock.critical:
                await close_not_needed(session, clock, reason=f"ai:{label.label}")


def _parse_deadline(value: str | None, now: datetime) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed <= now:
        return None
    return parsed


async def find_duplicate(
    session: AsyncSession,
    *,
    company_id: uuid.UUID,
    group_id: uuid.UUID | None = None,
    mailbox_id: uuid.UUID | None = None,
    truck_id: uuid.UUID | None,
    category: TaskCategory,
    title: str,
    summary: str,
    now: datetime,
    load_ref: str | None = None,
    trailer_ref: str | None = None,
) -> Task | None:
    """Deterministic backstop for duplicates the model did not catch [B12] — also across channels
    when the same load or trailer is involved (blueprint sec. 2 cross-channel case linking)."""
    settings = get_settings()
    base = [
        Task.company_id == company_id,
        Task.status.in_(list(OPEN_STATUSES)),
        Task.category == category,
        Task.created_at >= now - timedelta(hours=settings.dedupe_window_hours),
    ]
    # 1) same load / trailer anywhere: a looser text match is enough
    ident = [c for c in ((Task.load_ref == load_ref) if load_ref else None,
                         (Task.trailer_ref == trailer_ref) if trailer_ref else None) if c is not None]
    if ident:
        for task in (await session.scalars(select(Task).where(*base, or_(*ident)).order_by(Task.created_at.desc()))).all():
            score = max(similarity(title, task.title), similarity(f"{title} {summary}", f"{task.title} {task.description or ''}"))
            if score >= 0.3:
                return task
    # 2) same truck, or same channel when no truck is known
    query = select(Task).where(*base)
    if truck_id is not None:
        query = query.where(Task.truck_id == truck_id)
    elif group_id is not None:
        query = query.where(Task.group_id == group_id, Task.truck_id.is_(None))
    elif mailbox_id is not None:
        query = query.where(Task.mailbox_id == mailbox_id, Task.truck_id.is_(None))
    else:
        return None
    for task in (await session.scalars(query.order_by(Task.created_at.desc()))).all():
        score = max(
            similarity(title, task.title),
            similarity(f"{title} {summary}", f"{task.title} {task.description or ''}"),
        )
        if score >= settings.dedupe_similarity:
            return task
    return None


async def _apply_new_task(
    session: AsyncSession, ch: Channel, ctx: _Context, proposal: NewTask, extraction: AIExtraction, now: datetime
) -> str | None:
    settings = get_settings()
    new_refs = [r for r in proposal.source_refs if r in ctx.request.new_refs]
    if not new_refs or proposal.confidence < settings.ai_drop_below:
        return None

    ai = Actor.ai(ch.company_id)
    category = TaskCategory(proposal.category)
    dept_code = CATEGORY_DEPARTMENT[category]
    department = ctx.departments_by_code.get(dept_code) if dept_code else None
    department_id = department.id if department else ch.department_id

    load = ctx.loads_by_ref.get(proposal.load_reference or "")
    truck_unit = proposal.truck_unit or (load.truck_unit if load else None)
    truck = resolve_unit(truck_unit, ctx.trucks_by_unit) if truck_unit else None
    truck_id = truck.id if truck else (load.truck_id if load and load.truck_id else None)
    truck_unit_raw = normalize_unit(truck_unit) if truck_unit and truck_id is None else None
    if truck_id is None and truck_unit is None and ch.chat_kind == "truck":
        truck_id = ch.truck_id
    trailer_ref = normalize_trailer(proposal.trailer_ref) or (load.trailer_ref if load else None)
    driver_name = proposal.driver_name or (load.driver_name if load else None)

    source_msgs = [ctx.ref_map[r] for r in proposal.source_refs if r in ctx.ref_map]
    new_msgs = [ctx.ref_map[r] for r in new_refs]

    duplicate = await find_duplicate(
        session,
        company_id=ch.company_id,
        group_id=ch.id if ch.kind == "telegram" else None,
        mailbox_id=ch.id if ch.kind == "email" else None,
        truck_id=truck_id,
        category=category,
        title=proposal.title,
        summary=proposal.summary,
        now=now,
        load_ref=proposal.load_reference,
        trailer_ref=trailer_ref,
    )
    if duplicate is not None:
        for m in new_msgs:
            await link_message(session, duplicate, m, TaskMessageRelation.DUPLICATE, ai, note=proposal.title)
            await link_clock_to_task(session, m.id, duplicate)
        add_event(
            session,
            duplicate,
            ai,
            TaskEventType.AI_UPDATE,
            reason=f"Reported again: {proposal.summary}",
            data={"kind": "duplicate_report", "confidence": proposal.confidence, "extraction_id": str(extraction.id),
                  "channel": ch.kind},
        )
        return "duplicate"

    source_text = "\n".join(f"{_sender_label(m, ctx.sender_names)}: {m.content_for_ai}" for m in source_msgs)
    new_ids = {m.id for m in new_msgs}
    task = await create_task(
        session,
        actor=ai,
        title=proposal.title,
        description=proposal.summary,
        i18n={
            "uz": {"title": proposal.title_uz[:200], "summary": proposal.summary_uz},
            "ru": {"title": proposal.title_ru[:200], "summary": proposal.summary_ru},
        },
        category=category,
        priority=Priority(proposal.priority),
        department_id=department_id,
        truck_id=truck_id,
        truck_unit_raw=truck_unit_raw,
        load_ref=proposal.load_reference,
        load_id=load.id if load else None,
        issue_type=proposal.issue_type,
        amount=proposal.amount,
        trailer_ref=trailer_ref,
        driver_name=driver_name,
        due_at=_parse_deadline(proposal.deadline_iso, now),
        source=TaskSource.AI,
        confidence=proposal.confidence,
        group_id=ch.id if ch.kind == "telegram" else None,
        mailbox_id=ch.id if ch.kind == "email" else None,
        source_message=new_msgs[0],
        source_text=source_text,
        status=TaskStatus.DETECTED,
        linked_messages=[
            (m, TaskMessageRelation.SOURCE if m.id in new_ids else TaskMessageRelation.CONTEXT) for m in source_msgs
        ],
        event_data={
            "why": proposal.why_task,
            "assignee_hint": proposal.assignee_hint,
            "extraction_id": str(extraction.id),
            "channel": ch.kind,
        },
    )
    for m in new_msgs:
        await link_clock_to_task(session, m.id, task)

    # Routing [B5]
    routed_dept = ctx.departments_by_id.get(department_id) if department_id else None
    if (
        settings.auto_assign_enabled
        and proposal.confidence >= settings.ai_review_below
        and routed_dept is not None
        and routed_dept.default_assignee_user_id is not None
    ):
        await transition_task(
            session, task, TaskStatus.ASSIGNED, ai,
            assignee_id=routed_dept.default_assignee_user_id,
            data={"routing": "auto", "confidence": proposal.confidence},
        )
    else:
        await transition_task(
            session, task, TaskStatus.NEEDS_REVIEW, ai, data={"routing": "review", "confidence": proposal.confidence}
        )
    return task.code


_CODE = re.compile(r"T-?(\d+)", re.IGNORECASE)


async def _apply_update(
    session: AsyncSession, ch: Channel, ctx: _Context, update_: TaskUpdate, extraction: AIExtraction
) -> bool:
    settings = get_settings()
    if update_.confidence < settings.ai_drop_below:
        return False
    match = _CODE.fullmatch(update_.task_code.strip())
    if not match:
        return False
    task = await session.scalar(select(Task).where(Task.company_id == ch.company_id, Task.number == int(match.group(1))))
    if task is None or TaskStatus(task.status) not in OPEN_STATUSES:
        return False
    msgs = [ctx.ref_map[r] for r in update_.source_refs if r in ctx.request.new_refs]
    if not msgs:
        return False

    ai = Actor.ai(ch.company_id)
    kind = TaskUpdateKind(update_.kind)
    relation = TaskMessageRelation.DUPLICATE if kind == TaskUpdateKind.DUPLICATE_REPORT else TaskMessageRelation.UPDATE
    for m in msgs:
        await link_message(session, task, m, relation, ai, note=update_.note)
        await link_clock_to_task(session, m.id, task)
    add_event(
        session,
        task,
        ai,
        TaskEventType.AI_UPDATE,
        reason=update_.note,
        data={"kind": kind.value, "confidence": update_.confidence, "extraction_id": str(extraction.id), "channel": ch.kind},
    )

    status = TaskStatus(task.status)
    working = (TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS)
    if kind == TaskUpdateKind.BLOCKER and status in working:
        await transition_task(session, task, TaskStatus.BLOCKED, ai, reason=update_.note)
    elif kind == TaskUpdateKind.COMPLETION_CLAIM and status in working:
        # The AI never completes a task — a human verifies [B3, B9].
        await transition_task(session, task, TaskStatus.PENDING_VERIFICATION, ai, reason=update_.note)
    return True


# --------------------------------------------------------------------------- sweeper


async def channels_with_stale_pending(session: AsyncSession, now: datetime | None = None) -> list[tuple[str, uuid.UUID]]:
    """Safety net: re-trigger analysis for windows whose job was lost (worker restart, AI outage)."""
    settings = get_settings()
    now = now or utcnow()
    cutoff = now - timedelta(seconds=settings.analysis_max_wait_seconds + 30)
    groups = await session.scalars(
        select(Message.group_id)
        .join(TelegramGroup, TelegramGroup.id == Message.group_id)
        .where(Message.analysis_status == AnalysisStatus.PENDING, Message.created_at < cutoff,
               TelegramGroup.is_enabled.is_(True))
        .distinct()
    )
    mailboxes = await session.scalars(
        select(Message.mailbox_id)
        .join(Mailbox, Mailbox.id == Message.mailbox_id)
        .where(Message.analysis_status == AnalysisStatus.PENDING, Message.created_at < cutoff, Mailbox.is_enabled.is_(True))
        .distinct()
    )
    return [("telegram", g) for g in groups] + [("email", m) for m in mailboxes]


async def groups_with_stale_pending(session: AsyncSession, now: datetime | None = None) -> list[uuid.UUID]:
    return [cid for kind, cid in await channels_with_stale_pending(session, now) if kind == "telegram"]


__all__ = [
    "AnalysisOutcome",
    "ExtractionResponse",
    "analyze_channel",
    "analyze_group",
    "channels_with_stale_pending",
    "find_duplicate",
    "groups_with_stale_pending",
    "run_channel_analysis",
    "run_group_analysis",
]
