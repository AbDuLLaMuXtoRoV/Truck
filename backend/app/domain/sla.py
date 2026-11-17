"""SLA defaults and deadline math (spec v1.1 §3) [C2]."""

from datetime import datetime, timedelta

from app.domain.enums import Priority, TaskCategory

DEFAULT_RESOLVE_MINUTES: dict[Priority, int] = {
    Priority.P1: 60,
    Priority.P2: 4 * 60,
    Priority.P3: 24 * 60,
    Priority.P4: 72 * 60,
}

REMINDER_FRACTION = 0.75  # remind the assignee at 75 % of the window
ESCALATE_MANAGER_FRACTION = 1.5  # lead at 100 %, managers at 150 %


def resolve_minutes(
    priority: Priority,
    category: TaskCategory | None,
    policies: dict[tuple[str, str | None], int] | None = None,
) -> int:
    policies = policies or {}
    if category is not None and (priority, category) in policies:
        return policies[(priority, category)]
    if (priority, None) in policies:
        return policies[(priority, None)]
    return DEFAULT_RESOLVE_MINUTES[Priority(priority)]


def compute_due_at(
    created_at: datetime,
    priority: Priority,
    category: TaskCategory | None,
    policies: dict[tuple[str, str | None], int] | None = None,
) -> datetime:
    return created_at + timedelta(minutes=resolve_minutes(priority, category, policies))


def reminder_at(created_at: datetime, due_at: datetime) -> datetime:
    return created_at + (due_at - created_at) * REMINDER_FRACTION


def manager_escalation_at(created_at: datetime, due_at: datetime) -> datetime:
    return created_at + (due_at - created_at) * ESCALATE_MANAGER_FRACTION
