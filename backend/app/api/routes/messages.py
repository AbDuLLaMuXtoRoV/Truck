import uuid
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, CurrentActor, require
from app.api.schemas import AuditOut, ExtractionOut, MessageOut
from app.api.serializers import serialize_messages
from app.core.rbac import Actor, Perm, can_read_task
from app.domain.enums import AttachmentStatus
from app.models import AIExtraction, Attachment, AuditLog, Message, Task, TaskMessage
from app.services.storage import get_storage

router = APIRouter(prefix="/api", tags=["messages"])


@router.get("/messages", response_model=list[MessageOut])
async def list_messages(
    session: DB,
    actor: Actor = require(Perm.MESSAGES_READ),
    group_id: uuid.UUID | None = None,
    analysis_status: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
):
    stmt = select(Message).where(Message.company_id == actor.company_id).options(selectinload(Message.attachments))
    if group_id:
        stmt = stmt.where(Message.group_id == group_id)
    if analysis_status:
        stmt = stmt.where(Message.analysis_status == analysis_status)
    if q:
        stmt = stmt.where(Message.text.ilike(f"%{q}%") | Message.transcript.ilike(f"%{q}%"))
    rows = (await session.scalars(stmt.order_by(Message.sent_at.desc()).limit(limit))).unique().all()
    return await serialize_messages(session, rows)


@router.get("/attachments/{attachment_id}/file")
async def attachment_file(attachment_id: uuid.UUID, session: DB, actor: CurrentActor):
    """Download a stored photo / document / voice note. Allowed with messages.read, or when the
    message belongs to a task the user can see."""
    att = await session.get(Attachment, attachment_id)
    if att is None or att.company_id != actor.company_id:
        raise HTTPException(404, detail={"code": "not_found", "message": "Attachment not found"})
    if not actor.has(Perm.MESSAGES_READ):
        tasks = (
            await session.scalars(
                select(Task).join(TaskMessage, TaskMessage.task_id == Task.id).where(TaskMessage.message_id == att.message_id)
            )
        ).all()
        if not any(can_read_task(actor, t) for t in tasks):
            raise HTTPException(404, detail={"code": "not_found", "message": "Attachment not found"})
    if att.status != AttachmentStatus.DOWNLOADED or not att.storage_key:
        raise HTTPException(409, detail={"code": "not_downloaded", "message": f"File is not available ({att.status})"})
    try:
        data = get_storage().read(att.storage_key)
    except (OSError, ValueError):
        raise HTTPException(410, detail={"code": "gone", "message": "File no longer stored"}) from None
    filename = att.file_name or f"{att.kind}-{att.id}"
    return Response(
        content=data,
        media_type=att.mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}",
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/ai/extractions", response_model=list[ExtractionOut])
async def extractions(
    session: DB,
    actor: Actor = require(Perm.MESSAGES_READ),
    group_id: uuid.UUID | None = None,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
):
    """Every model call with tokens, latency and raw output — the AI quality audit trail [B10]."""
    stmt = select(AIExtraction).where(AIExtraction.company_id == actor.company_id)
    if group_id:
        stmt = stmt.where(AIExtraction.group_id == group_id)
    if status:
        stmt = stmt.where(AIExtraction.status == status)
    rows = (await session.scalars(stmt.order_by(AIExtraction.created_at.desc()).limit(limit))).all()
    return [ExtractionOut.model_validate(r) for r in rows]


@router.get("/audit", response_model=list[AuditOut])
async def audit(
    session: DB,
    actor: Actor = require(Perm.AUDIT_READ),
    entity_type: str | None = None,
    entity_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    stmt = select(AuditLog).where(AuditLog.company_id == actor.company_id)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    rows = (await session.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(limit))).all()
    return [AuditOut.model_validate(r) for r in rows]
