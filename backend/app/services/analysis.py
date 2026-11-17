"""AI analysis pipeline: conversation window -> model -> proposals -> task engine (spec v1.1 §4)."""

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
    GroupKind,
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
from app.domain.similarity import similarity
from app.domain.truck_refs import extract_truck_refs, normalize_unit, resolve_unit
from app.models import (
    AIExtraction,
    Company,
    Department,
    Message,
    Task,
    TelegramGroup,
    TelegramUser,
    Truck,
    User,
    utcnow,
)
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
            out.append(AttachmentInput(ref=ref, media_type=mime, data_b64=base64.b64encode(data).decode("ascii"), file_name=a.file_name))
    return out


@dataclass
class AnalysisOutcome:
    status: str  # ok | no_pending | waiting | locked | disabled | ai_off | error | refusal
    tasks_created: list[str] = field(default_factory=list)
    updates_applied: int = 0
    duplicates_linked: int = 0
    retry_after_seconds: int | None = None


# --------------------------------------------------------------------------- lease


async def acquire_lease(session: AsyncSession, group_id: uuid.UUID, now: datetime) -> bool:
    result = await session.execute(
        update(TelegramGroup)
        .where(
            TelegramGroup.id == group_id,
            or_(TelegramGroup.analysis_lock_until.is_(None), TelegramGroup.analysis_lock_until < now),
        )
        .values(analysis_lock_until=now + timedelta(seconds=LEASE_SECONDS))
    )
    return result.rowcount == 1


async def release_lease(session: AsyncSession, group_id: uuid.UUID) -> None:
    await session.execute(
        update(TelegramGroup).where(TelegramGroup.id == group_id).values(analysis_lock_until=None)
    )


async def run_group_analysis(
    sessionmaker: async_sessionmaker[AsyncSession],
    group_id: uuid.UUID,
    *,
    extractor: Extractor | None = None,
    force: bool = False,
) -> AnalysisOutcome:
    """Job entry point. The lease is committed separately so no DB transaction stays open
    while the model is thinking."""
    now = utcnow()
    async with sessionmaker() as session:
        if not await acquire_lease(session, group_id, now):
            return AnalysisOutcome("locked")
        await session.commit()
    try:
        async with sessionmaker() as session:
            outcome = await analyze_group(session, group_id, extractor=extractor, force=force)
            await release_lease(session, group_id)
            await session.commit()
            return outcome
    except Exception:
        log.exception("analysis failed for group %s", group_id)
        async with sessionmaker() as session:
            await release_lease(session, group_id)
            await session.commit()
        raise


# --------------------------------------------------------------------------- core


async def analyze_group(
    session: AsyncSession,
    group_id: uuid.UUID,
    *,
    extractor: Extractor | None = None,
    now: datetime | None = None,
    force: bool = False,
) -> AnalysisOutcome:
    """Analyse pending messages of one group. Caller holds the lease and commits."""
    settings = get_settings()
    now = now or utcnow()
    group = await session.get(TelegramGroup, group_id)
    if group is None:
        return AnalysisOutcome("no_pending")

    pending = list(
        (
            await session.scalars(
                select(Message)
                .where(Message.group_id == group.id, Message.analysis_status == AnalysisStatus.PENDING)
                .order_by(Message.sent_at, Message.tg_message_id)
                .limit(MAX_WINDOW_MESSAGES)
            )
        ).all()
    )
    if not pending:
        return AnalysisOutcome("no_pending")
    if not group.is_enabled:
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

    ctx = await _build_context(session, group, pending, now)
    response = await extractor.extract(ctx.request)

    extraction = AIExtraction(
        id=uuid.uuid4(),
        company_id=group.company_id,
        group_id=group.id,
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

    outcome = await _apply_result(session, group, ctx, response.result, extraction, now)
    extraction.tasks_created = len(outcome.tasks_created)
    extraction.updates_applied = outcome.updates_applied + outcome.duplicates_linked
    _mark(pending, AnalysisStatus.DONE, now)
    await session.flush()
    return outcome


def _mark(messages: list[Message], status: AnalysisStatus, now: datetime) -> None:
    for m in messages:
        m.analysis_status = status
        m.analyzed_at = now


# --------------------------------------------------------------------------- context


@dataclass
class _Context:
    request: ExtractionRequest
    ref_map: dict[str, Message]
    sender_names: dict[uuid.UUID, str]
    trucks_by_unit: dict[str, Truck]
    departments_by_code: dict[str, Department]
    departments_by_id: dict[uuid.UUID, Department]


async def _build_context(
    session: AsyncSession, group: TelegramGroup, pending: list[Message], now: datetime
) -> _Context:
    settings = get_settings()
    company = await session.get(Company, group.company_id)

    first = pending[0]
    context_msgs = list(
        (
            await session.scalars(
                select(Message)
                .where(
                    Message.group_id == group.id,
                    Message.analysis_status != AnalysisStatus.PENDING,
                    Message.sent_at <= first.sent_at,
                    Message.id.not_in([m.id for m in pending]),
                )
                .order_by(Message.sent_at.desc())
                .limit(settings.analysis_context_messages)
            )
        ).all()
    )
    context_msgs.reverse()

    loaded_tg_ids = {m.tg_message_id for m in context_msgs} | {m.tg_message_id for m in pending}
    reply_ids = {
        m.reply_to_tg_message_id
        for m in (*context_msgs, *pending)
        if m.reply_to_tg_message_id and m.reply_to_tg_message_id not in loaded_tg_ids
    }
    if reply_ids:
        targets = (
            await session.scalars(
                select(Message).where(Message.group_id == group.id, Message.tg_message_id.in_(reply_ids))
            )
        ).all()
        context_msgs = sorted([*targets, *context_msgs], key=lambda m: (m.sent_at, m.tg_message_id))

    ordered = [*context_msgs, *pending]
    ref_map: dict[str, Message] = {}
    ref_by_tg: dict[int, str] = {}
    for i, m in enumerate(ordered, start=1):
        ref = f"m{i}"
        ref_map[ref] = m
        ref_by_tg[m.tg_message_id] = ref

    sender_ids = {m.sender_id for m in ordered if m.sender_id}
    sender_names: dict[uuid.UUID, str] = {}
    if sender_ids:
        tg_users = (await session.scalars(select(TelegramUser).where(TelegramUser.id.in_(sender_ids)))).all()
        staff_ids = set(
            (await session.scalars(select(User.telegram_user_id).where(User.telegram_user_id.in_(sender_ids)))).all()
        )
        for u in tg_users:
            tag = " [staff]" if u.id in staff_ids else (" [driver]" if u.driver_id else "")
            sender_names[u.id] = f"{u.display_name}{tag}"

    trucks = (await session.scalars(select(Truck).where(Truck.company_id == group.company_id))).all()
    trucks_by_unit = {normalize_unit(t.unit_number): t for t in trucks}
    trucks_by_id = {t.id: t for t in trucks}
    departments = (
        await session.scalars(select(Department).where(Department.company_id == group.company_id))
    ).all()

    hints: list[str] = []
    for m in pending:
        for unit in extract_truck_refs(m.content_for_ai):
            if unit not in hints:
                hints.append(unit)

    truck_ids = {t.id for u in hints if (t := trucks_by_unit.get(u))}
    if group.truck_id:
        truck_ids.add(group.truck_id)
    task_filter = Task.group_id == group.id
    if truck_ids:
        task_filter = or_(task_filter, Task.truck_id.in_(truck_ids))
    open_tasks = (
        await session.scalars(
            select(Task)
            .where(Task.company_id == group.company_id, Task.status.in_(list(OPEN_STATUSES)), task_filter)
            .order_by(Task.created_at.desc())
            .limit(settings.analysis_open_tasks_limit)
        )
    ).all()

    pending_ids = {m.id for m in pending}
    attachments = _collect_attachments(ref_map, pending_ids)
    request = ExtractionRequest(
        chat_title=group.title,
        chat_kind=group.kind,
        default_truck_unit=trucks_by_id[group.truck_id].unit_number if group.truck_id in trucks_by_id else None,
        department_code=next((d.code for d in departments if d.id == group.department_id), None),
        company_timezone=company.timezone if company else "UTC",
        now=now,
        truck_hints=hints,
        attachments=attachments,
        messages=[
            WindowMessage(
                ref=ref,
                is_new=m.id in pending_ids,
                sent_at=m.sent_at,
                sender=sender_names.get(m.sender_id, "unknown") if m.sender_id else "unknown",
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
                title=t.title,
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
    )


# --------------------------------------------------------------------------- apply


async def _apply_result(
    session: AsyncSession,
    group: TelegramGroup,
    ctx: _Context,
    result: ExtractionResult,
    extraction: AIExtraction,
    now: datetime,
) -> AnalysisOutcome:
    outcome = AnalysisOutcome("ok")
    for update_ in result.task_updates:
        if await _apply_update(session, group, ctx, update_, extraction):
            outcome.updates_applied += 1
    for proposal in result.new_tasks:
        created = await _apply_new_task(session, group, ctx, proposal, extraction, now)
        if created == "duplicate":
            outcome.duplicates_linked += 1
        elif created is not None:
            outcome.tasks_created.append(created)
    return outcome


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
    group_id: uuid.UUID,
    truck_id: uuid.UUID | None,
    category: TaskCategory,
    title: str,
    summary: str,
    now: datetime,
) -> Task | None:
    """Deterministic backstop for duplicates the model did not catch [B12]."""
    settings = get_settings()
    query = select(Task).where(
        Task.company_id == company_id,
        Task.status.in_(list(OPEN_STATUSES)),
        Task.category == category,
        Task.created_at >= now - timedelta(hours=settings.dedupe_window_hours),
    )
    if truck_id is not None:
        query = query.where(Task.truck_id == truck_id)
    else:
        query = query.where(Task.group_id == group_id, Task.truck_id.is_(None))
    for task in (await session.scalars(query.order_by(Task.created_at.desc()))).all():
        score = max(
            similarity(title, task.title),
            similarity(f"{title} {summary}", f"{task.title} {task.description or ''}"),
        )
        if score >= settings.dedupe_similarity:
            return task
    return None


async def _apply_new_task(
    session: AsyncSession,
    group: TelegramGroup,
    ctx: _Context,
    proposal: NewTask,
    extraction: AIExtraction,
    now: datetime,
) -> str | None:
    settings = get_settings()
    new_refs = [r for r in proposal.source_refs if r in ctx.request.new_refs]
    if not new_refs or proposal.confidence < settings.ai_drop_below:
        return None

    ai = Actor.ai(group.company_id)
    category = TaskCategory(proposal.category)
    dept_code = CATEGORY_DEPARTMENT[category]
    department = ctx.departments_by_code.get(dept_code) if dept_code else None
    department_id = department.id if department else group.department_id

    truck = resolve_unit(proposal.truck_unit, ctx.trucks_by_unit) if proposal.truck_unit else None
    truck_id = truck.id if truck else None
    truck_unit_raw = normalize_unit(proposal.truck_unit) if proposal.truck_unit and truck is None else None
    if truck_id is None and proposal.truck_unit is None and group.kind == GroupKind.TRUCK:
        truck_id = group.truck_id

    source_msgs = [ctx.ref_map[r] for r in proposal.source_refs if r in ctx.ref_map]
    new_msgs = [ctx.ref_map[r] for r in new_refs]

    duplicate = await find_duplicate(
        session,
        company_id=group.company_id,
        group_id=group.id,
        truck_id=truck_id,
        category=category,
        title=proposal.title,
        summary=proposal.summary,
        now=now,
    )
    if duplicate is not None:
        for m in new_msgs:
            await link_message(session, duplicate, m, TaskMessageRelation.DUPLICATE, ai, note=proposal.title)
        add_event(
            session,
            duplicate,
            ai,
            TaskEventType.AI_UPDATE,
            reason=f"Reported again: {proposal.summary}",
            data={"kind": "duplicate_report", "confidence": proposal.confidence, "extraction_id": str(extraction.id)},
        )
        return "duplicate"

    source_text = "\n".join(
        f"{ctx.sender_names.get(m.sender_id, 'unknown') if m.sender_id else 'unknown'}: {m.content_for_ai}"
        for m in source_msgs
    )
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
        due_at=_parse_deadline(proposal.deadline_iso, now),
        source=TaskSource.AI,
        confidence=proposal.confidence,
        group_id=group.id,
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
        },
    )

    # Routing [B5]
    routed_dept = ctx.departments_by_id.get(department_id) if department_id else None
    if (
        settings.auto_assign_enabled
        and proposal.confidence >= settings.ai_review_below
        and routed_dept is not None
        and routed_dept.default_assignee_user_id is not None
    ):
        await transition_task(
            session,
            task,
            TaskStatus.ASSIGNED,
            ai,
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
    session: AsyncSession,
    group: TelegramGroup,
    ctx: _Context,
    update_: TaskUpdate,
    extraction: AIExtraction,
) -> bool:
    settings = get_settings()
    if update_.confidence < settings.ai_drop_below:
        return False
    match = _CODE.fullmatch(update_.task_code.strip())
    if not match:
        return False
    task = await session.scalar(
        select(Task).where(Task.company_id == group.company_id, Task.number == int(match.group(1)))
    )
    if task is None or TaskStatus(task.status) not in OPEN_STATUSES:
        return False
    msgs = [ctx.ref_map[r] for r in update_.source_refs if r in ctx.request.new_refs]
    if not msgs:
        return False

    ai = Actor.ai(group.company_id)
    kind = TaskUpdateKind(update_.kind)
    relation = TaskMessageRelation.DUPLICATE if kind == TaskUpdateKind.DUPLICATE_REPORT else TaskMessageRelation.UPDATE
    for m in msgs:
        await link_message(session, task, m, relation, ai, note=update_.note)
    add_event(
        session,
        task,
        ai,
        TaskEventType.AI_UPDATE,
        reason=update_.note,
        data={"kind": kind.value, "confidence": update_.confidence, "extraction_id": str(extraction.id)},
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


async def groups_with_stale_pending(session: AsyncSession, now: datetime | None = None) -> list[uuid.UUID]:
    """Safety net: re-trigger analysis for windows whose job was lost (worker restart, AI outage)."""
    settings = get_settings()
    now = now or utcnow()
    cutoff = now - timedelta(seconds=settings.analysis_max_wait_seconds + 30)
    rows = await session.scalars(
        select(Message.group_id)
        .join(TelegramGroup, TelegramGroup.id == Message.group_id)
        .where(
            Message.analysis_status == AnalysisStatus.PENDING,
            Message.created_at < cutoff,
            TelegramGroup.is_enabled.is_(True),
        )
        .distinct()
    )
    return list(rows)


__all__ = [
    "AnalysisOutcome",
    "ExtractionResponse",
    "analyze_group",
    "find_duplicate",
    "groups_with_stale_pending",
    "run_group_analysis",
]
