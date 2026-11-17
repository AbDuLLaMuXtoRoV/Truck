"""Task state machine (spec v1.1 §5). Pure functions — no DB access — so they are easy to test."""

from app.core.rbac import Actor, Perm, can_manage_task, is_assignee
from app.domain.enums import ActorKind, TaskStatus

S = TaskStatus

TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    S.DETECTED: frozenset({S.NEEDS_REVIEW, S.ASSIGNED, S.CANCELLED}),
    S.NEEDS_REVIEW: frozenset({S.ASSIGNED, S.CANCELLED}),
    S.ASSIGNED: frozenset({S.IN_PROGRESS, S.BLOCKED, S.PENDING_VERIFICATION, S.NEEDS_REVIEW, S.CANCELLED}),
    S.IN_PROGRESS: frozenset({S.BLOCKED, S.PENDING_VERIFICATION, S.ASSIGNED, S.CANCELLED}),
    S.BLOCKED: frozenset({S.IN_PROGRESS, S.ASSIGNED, S.CANCELLED}),
    S.PENDING_VERIFICATION: frozenset({S.COMPLETED, S.IN_PROGRESS}),
    S.COMPLETED: frozenset({S.IN_PROGRESS}),  # reopen [C4]
    S.CANCELLED: frozenset({S.NEEDS_REVIEW}),  # restore
}

# The AI proposes; it can never complete or cancel anything [B9].
AI_ALLOWED_TARGETS: frozenset[TaskStatus] = frozenset(
    {S.NEEDS_REVIEW, S.ASSIGNED, S.BLOCKED, S.PENDING_VERIFICATION}
)

# Work transitions the assignee may perform on their own task.
ASSIGNEE_TRANSITIONS: frozenset[tuple[TaskStatus, TaskStatus]] = frozenset(
    {
        (S.ASSIGNED, S.IN_PROGRESS),
        (S.ASSIGNED, S.BLOCKED),
        (S.ASSIGNED, S.PENDING_VERIFICATION),
        (S.IN_PROGRESS, S.BLOCKED),
        (S.IN_PROGRESS, S.PENDING_VERIFICATION),
        (S.BLOCKED, S.IN_PROGRESS),
    }
)


class TransitionError(Exception):
    def __init__(self, code: str, message: str, *, http_status: int = 409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


def is_reopen(from_status: TaskStatus, to_status: TaskStatus) -> bool:
    return from_status == S.COMPLETED and to_status == S.IN_PROGRESS


def is_verification_rejection(from_status: TaskStatus, to_status: TaskStatus) -> bool:
    return from_status == S.PENDING_VERIFICATION and to_status == S.IN_PROGRESS


def reason_required(from_status: TaskStatus, to_status: TaskStatus) -> bool:
    return (
        to_status in (S.BLOCKED, S.CANCELLED)
        or is_reopen(from_status, to_status)
        or is_verification_rejection(from_status, to_status)
    )


def check_transition(
    task,
    to_status: TaskStatus,
    actor: Actor,
    *,
    reason: str | None = None,
    four_eyes: bool = True,
    new_assignee_id=None,
) -> None:
    """Raise TransitionError if `actor` may not move `task` to `to_status`.

    `new_assignee_id` is the assignee chosen together with a move to ASSIGNED (defaults to the
    task's current assignee).
    """
    from_status = TaskStatus(task.status)
    to_status = TaskStatus(to_status)
    assignee_id = new_assignee_id if new_assignee_id is not None else task.assignee_id

    if to_status == from_status:
        raise TransitionError("no_op", f"Task is already {to_status.value}")
    if to_status not in TRANSITIONS[from_status]:
        raise TransitionError(
            "invalid_transition", f"Cannot move a task from {from_status.value} to {to_status.value}"
        )
    if reason_required(from_status, to_status) and not (reason and reason.strip()):
        raise TransitionError("reason_required", "A reason is required for this change", http_status=422)
    if to_status == S.ASSIGNED and assignee_id is None:
        raise TransitionError("assignee_required", "Choose an assignee first", http_status=422)

    if actor.kind == ActorKind.AI:
        if to_status not in AI_ALLOWED_TARGETS:
            raise TransitionError("ai_forbidden", "The AI may not perform this change", http_status=403)
        return
    if actor.kind == ActorKind.SYSTEM:
        return

    _check_user_permission(task, from_status, to_status, actor, four_eyes=four_eyes)


def _check_user_permission(task, from_status, to_status, actor: Actor, *, four_eyes: bool) -> None:
    def deny(msg: str) -> TransitionError:
        return TransitionError("forbidden", msg, http_status=403)

    manages = can_manage_task(actor, task)

    # Review decisions on candidates.
    if from_status in (S.DETECTED, S.NEEDS_REVIEW):
        if not (manages and actor.has(Perm.TASKS_REVIEW)):
            raise deny("Reviewing tasks requires the tasks.review permission for this department")
        return

    # Verification, rejection and reopen.
    if to_status == S.COMPLETED or from_status in (S.PENDING_VERIFICATION, S.COMPLETED):
        if not (manages and actor.has(Perm.TASKS_VERIFY)):
            raise deny("Verifying tasks requires the tasks.verify permission for this department")
        if to_status == S.COMPLETED and four_eyes and is_assignee(actor, task):
            raise deny("The assignee cannot verify their own task (four-eyes rule)")
        return

    if to_status == S.CANCELLED or from_status == S.CANCELLED:
        if not (manages and actor.has(Perm.TASKS_CANCEL)):
            raise deny("Cancelling or restoring tasks requires the tasks.cancel permission")
        return

    if manages:
        return
    if is_assignee(actor, task) and (from_status, to_status) in ASSIGNEE_TRANSITIONS:
        return
    raise deny("Only the assignee or a department lead can change this task")
