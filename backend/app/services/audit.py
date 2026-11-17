from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Actor
from app.models import AuditLog


def record_audit(
    session: AsyncSession,
    actor: Actor | None,
    action: str,
    entity_type: str,
    entity_id: Any = None,
    *,
    before: dict | None = None,
    after: dict | None = None,
    ip: str | None = None,
    company_id=None,
) -> AuditLog:
    log = AuditLog(
        company_id=company_id or (actor.company_id if actor else None),
        actor_kind=actor.kind if actor else "system",
        actor_user_id=actor.user_id if actor else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        before=before,
        after=after,
        ip=ip,
    )
    session.add(log)
    return log
