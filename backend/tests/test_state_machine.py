import uuid
from types import SimpleNamespace

import pytest

from app.core.rbac import Actor, ROLE_PERMISSIONS
from app.domain.enums import ActorKind, Role, TaskStatus as S
from app.domain.task_state import TRANSITIONS, TransitionError, check_transition

COMPANY = uuid.uuid4()
ELD = uuid.uuid4()
ACCT = uuid.uuid4()


def user(role: Role, dept=None) -> Actor:
    return Actor(
        kind=ActorKind.USER, company_id=COMPANY, user_id=uuid.uuid4(), role=role,
        department_id=dept, permissions=ROLE_PERMISSIONS[role],
    )


def task(status: S, *, dept=ELD, assignee=None):
    return SimpleNamespace(
        status=status, company_id=COMPANY, department_id=dept, assignee_id=assignee, created_by_id=None
    )


def allowed(t, to, actor, **kw) -> bool:
    try:
        check_transition(t, to, actor, **kw)
        return True
    except TransitionError:
        return False


def test_every_status_has_transition_rules():
    assert set(TRANSITIONS) == set(S)


def test_invalid_transition_rejected():
    with pytest.raises(TransitionError) as exc:
        check_transition(task(S.NEEDS_REVIEW), S.COMPLETED, user(Role.MANAGER))
    assert exc.value.code == "invalid_transition"


@pytest.mark.parametrize(
    ("frm", "to"),
    [(S.ASSIGNED, S.BLOCKED), (S.IN_PROGRESS, S.CANCELLED), (S.COMPLETED, S.IN_PROGRESS), (S.PENDING_VERIFICATION, S.IN_PROGRESS)],
)
def test_reason_required(frm, to):
    mgr = user(Role.MANAGER)
    t = task(frm, assignee=uuid.uuid4())
    with pytest.raises(TransitionError) as exc:
        check_transition(t, to, mgr)
    assert exc.value.code == "reason_required"
    check_transition(t, to, mgr, reason="waiting for part")


def test_assigned_requires_assignee():
    with pytest.raises(TransitionError) as exc:
        check_transition(task(S.NEEDS_REVIEW), S.ASSIGNED, user(Role.MANAGER))
    assert exc.value.code == "assignee_required"


def test_ai_can_never_complete_or_cancel():
    ai = Actor.ai(COMPANY)
    assert not allowed(task(S.PENDING_VERIFICATION), S.COMPLETED, ai)
    assert not allowed(task(S.NEEDS_REVIEW), S.CANCELLED, ai, reason="spam")
    assert allowed(task(S.IN_PROGRESS, assignee=uuid.uuid4()), S.PENDING_VERIFICATION, ai)
    assert allowed(task(S.DETECTED), S.NEEDS_REVIEW, ai)


def test_four_eyes_blocks_self_verification():
    lead = user(Role.DEPT_LEAD, ELD)
    t = task(S.PENDING_VERIFICATION, assignee=lead.user_id)
    assert not allowed(t, S.COMPLETED, lead)
    assert allowed(t, S.COMPLETED, lead, four_eyes=False)
    assert allowed(t, S.COMPLETED, user(Role.MANAGER))


def test_agent_can_work_own_task_only():
    agent = user(Role.AGENT, ELD)
    own = task(S.ASSIGNED, assignee=agent.user_id)
    other = task(S.ASSIGNED, assignee=uuid.uuid4())
    assert allowed(own, S.IN_PROGRESS, agent)
    assert allowed(task(S.IN_PROGRESS, assignee=agent.user_id), S.PENDING_VERIFICATION, agent)
    assert not allowed(other, S.IN_PROGRESS, agent)
    # Agents cannot verify, cancel or review even their own tasks.
    assert not allowed(task(S.PENDING_VERIFICATION, assignee=agent.user_id), S.COMPLETED, agent, four_eyes=False)
    assert not allowed(own, S.CANCELLED, agent, reason="x")
    assert not allowed(task(S.NEEDS_REVIEW), S.CANCELLED, agent, reason="x")


def test_department_lead_scoped_to_department():
    lead = user(Role.DEPT_LEAD, ELD)
    assert allowed(task(S.NEEDS_REVIEW, dept=ELD, assignee=uuid.uuid4()), S.ASSIGNED, lead)
    assert not allowed(task(S.NEEDS_REVIEW, dept=ACCT, assignee=uuid.uuid4()), S.ASSIGNED, lead)
    assert not allowed(task(S.PENDING_VERIFICATION, dept=ACCT, assignee=uuid.uuid4()), S.COMPLETED, lead)


def test_unrouted_tasks_need_manager():
    lead = user(Role.DEPT_LEAD, ELD)
    unrouted = task(S.NEEDS_REVIEW, dept=None, assignee=uuid.uuid4())
    assert not allowed(unrouted, S.ASSIGNED, lead)
    assert allowed(unrouted, S.ASSIGNED, user(Role.MANAGER))


def test_viewer_cannot_change_anything():
    viewer = user(Role.VIEWER)
    for frm, targets in TRANSITIONS.items():
        for to in targets:
            assert not allowed(task(frm, assignee=uuid.uuid4()), to, viewer, reason="x"), (frm, to)


def test_cross_company_denied():
    mgr = user(Role.MANAGER)
    foreign = task(S.ASSIGNED, assignee=uuid.uuid4())
    foreign.company_id = uuid.uuid4()
    assert not allowed(foreign, S.IN_PROGRESS, mgr)
