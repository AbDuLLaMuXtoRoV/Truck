"""Role-based access control. The matrix is documented in docs/03-rbac.md — keep them in sync."""

import uuid
from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.enums import ActorKind, Role


class Perm(StrEnum):
    DASHBOARD_READ = "dashboard.read"
    TASKS_READ_ALL = "tasks.read_all"
    TASKS_READ_DEPARTMENT = "tasks.read_department"
    TASKS_CREATE = "tasks.create"
    TASKS_UPDATE_ALL = "tasks.update_all"
    TASKS_UPDATE_DEPARTMENT = "tasks.update_department"
    TASKS_REVIEW = "tasks.review"
    TASKS_VERIFY = "tasks.verify"
    TASKS_CANCEL = "tasks.cancel"
    MESSAGES_READ = "messages.read"
    GROUPS_READ = "groups.read"
    GROUPS_MANAGE = "groups.manage"
    FLEET_MANAGE = "fleet.manage"
    USERS_MANAGE = "users.manage"
    AUDIT_READ = "audit.read"


_ALL = frozenset(Perm)

ROLE_PERMISSIONS: dict[Role, frozenset[Perm]] = {
    Role.OWNER: _ALL,
    Role.ADMIN: _ALL,
    Role.MANAGER: frozenset(
        {
            Perm.DASHBOARD_READ,
            Perm.TASKS_READ_ALL,
            Perm.TASKS_CREATE,
            Perm.TASKS_UPDATE_ALL,
            Perm.TASKS_REVIEW,
            Perm.TASKS_VERIFY,
            Perm.TASKS_CANCEL,
            Perm.MESSAGES_READ,
            Perm.GROUPS_READ,
            Perm.FLEET_MANAGE,
        }
    ),
    Role.DEPT_LEAD: frozenset(
        {
            Perm.DASHBOARD_READ,
            Perm.TASKS_READ_DEPARTMENT,
            Perm.TASKS_CREATE,
            Perm.TASKS_UPDATE_DEPARTMENT,
            Perm.TASKS_REVIEW,
            Perm.TASKS_VERIFY,
            Perm.TASKS_CANCEL,
            Perm.GROUPS_READ,
        }
    ),
    Role.AGENT: frozenset({Perm.DASHBOARD_READ, Perm.TASKS_READ_DEPARTMENT, Perm.TASKS_CREATE}),
    Role.VIEWER: frozenset({Perm.DASHBOARD_READ, Perm.TASKS_READ_ALL, Perm.GROUPS_READ}),
}


@dataclass(frozen=True)
class Actor:
    """Who is performing an action: a portal user, the AI pipeline, or the system (SLA jobs)."""

    kind: ActorKind
    company_id: uuid.UUID
    user_id: uuid.UUID | None = None
    role: Role | None = None
    department_id: uuid.UUID | None = None
    permissions: frozenset[Perm] = field(default_factory=frozenset)

    @classmethod
    def for_user(cls, user) -> "Actor":
        role = Role(user.role)
        return cls(
            kind=ActorKind.USER,
            company_id=user.company_id,
            user_id=user.id,
            role=role,
            department_id=user.department_id,
            permissions=ROLE_PERMISSIONS[role],
        )

    @classmethod
    def ai(cls, company_id: uuid.UUID) -> "Actor":
        return cls(kind=ActorKind.AI, company_id=company_id)

    @classmethod
    def system(cls, company_id: uuid.UUID) -> "Actor":
        return cls(kind=ActorKind.SYSTEM, company_id=company_id)

    @property
    def is_user(self) -> bool:
        return self.kind == ActorKind.USER

    def has(self, perm: Perm) -> bool:
        return perm in self.permissions


def can_read_task(actor: Actor, task) -> bool:
    if task.company_id != actor.company_id:
        return False
    if not actor.is_user or actor.has(Perm.TASKS_READ_ALL):
        return True
    if actor.user_id is not None and actor.user_id in (task.assignee_id, task.created_by_id):
        return True
    return (
        actor.has(Perm.TASKS_READ_DEPARTMENT)
        and actor.department_id is not None
        and task.department_id == actor.department_id
    )


def can_manage_task(actor: Actor, task) -> bool:
    """Lead-level control over a task (edit, reassign, review, verify, cancel — subject to the specific perm)."""
    if task.company_id != actor.company_id:
        return False
    if not actor.is_user or actor.has(Perm.TASKS_UPDATE_ALL):
        return True
    return (
        actor.has(Perm.TASKS_UPDATE_DEPARTMENT)
        and actor.department_id is not None
        and task.department_id == actor.department_id
    )


def is_assignee(actor: Actor, task) -> bool:
    return actor.user_id is not None and actor.user_id == task.assignee_id
