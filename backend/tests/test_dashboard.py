from datetime import timedelta

from app.core.rbac import Actor
from app.domain.enums import Priority, TaskCategory, TaskSource, TaskStatus
from app.models import AIExtraction, utcnow
from app.services.tasks import create_task, transition_task
from tests.conftest import auth_headers


async def seed(db, org):
    mgr = Actor.for_user(org.users["manager"])
    ai = Actor.ai(org.company.id)
    async with db() as s:
        # AI task approved, AI task rejected, AI task waiting for review, one manual task completed.
        t1 = await create_task(s, actor=ai, title="ELD down 125", category=TaskCategory.ELD, department_id=org.depts["ELD"].id,
                               source=TaskSource.AI, confidence=0.9, status=TaskStatus.NEEDS_REVIEW,
                               i18n={"ru": {"title": "ELD не работает 125", "summary": None}})
        await transition_task(s, t1, TaskStatus.ASSIGNED, mgr, assignee_id=org.users["eld_agent"].id)
        t2 = await create_task(s, actor=ai, title="ok aka", source=TaskSource.AI, confidence=0.6, status=TaskStatus.NEEDS_REVIEW,
                               department_id=org.depts["ELD"].id)
        await transition_task(s, t2, TaskStatus.CANCELLED, mgr, reason="not a task")
        await create_task(s, actor=ai, title="POD 118", source=TaskSource.AI, confidence=0.75, status=TaskStatus.NEEDS_REVIEW,
                          department_id=org.depts["ACCOUNTING"].id)
        t4 = await create_task(s, actor=mgr, title="Manual", assignee_id=org.users["acct_lead"].id,
                               department_id=org.depts["ACCOUNTING"].id, priority=Priority.P4)
        await transition_task(s, t4, TaskStatus.PENDING_VERIFICATION, Actor.for_user(org.users["acct_lead"]))
        await transition_task(s, t4, TaskStatus.COMPLETED, mgr)
        s.add_all([
            AIExtraction(company_id=org.company.id, model="m", prompt_version="v", status="ok", latency_ms=4000),
            AIExtraction(company_id=org.company.id, model="m", prompt_version="v", status="ok", latency_ms=6000),
            AIExtraction(company_id=org.company.id, model="m", prompt_version="v", status="error", latency_ms=100),
        ])
        await s.commit()


async def test_badges(client, org, db):
    await seed(db, org)
    mgr = await auth_headers(client, "manager")
    b = (await client.get("/api/dashboard/badges", headers=mgr)).json()
    assert {k: b[k] for k in ("needs_review", "overdue", "my_open", "pending_groups")} == {
        "needs_review": 1, "overdue": 0, "my_open": 0, "pending_groups": 1,
    }
    assert b["unanswered"] == 0 and b["overdue_responses"] == 0 and b["pending_handovers"] == 0
    agent = await auth_headers(client, "eld_agent")
    b = (await client.get("/api/dashboard/badges", headers=agent)).json()
    assert b["my_open"] == 1 and b["needs_review"] == 0 and b["pending_groups"] == 0  # agents can't read groups


async def test_trend_has_every_day(client, org, db):
    await seed(db, org)
    h = await auth_headers(client, "manager")
    days = (await client.get("/api/dashboard/trend?days=7", headers=h)).json()["days"]
    assert len(days) == 7 and days == sorted(days, key=lambda d: d["date"])
    today = days[-1]
    assert today["created"] == 4 and today["ai_created"] == 3 and today["completed"] == 1
    assert sum(d["created"] for d in days[:-1]) == 0
    assert (await client.get("/api/dashboard/trend?days=3", headers=h)).status_code == 422


async def test_activity_feed_is_scoped(client, org, db):
    await seed(db, org)
    mgr = await auth_headers(client, "manager")
    feed = (await client.get("/api/dashboard/activity?limit=50", headers=mgr)).json()
    assert feed[0]["created_at"] >= feed[-1]["created_at"]
    kinds = {e["actor_kind"] for e in feed}
    assert {"ai", "user"} <= kinds
    named = next(e for e in feed if e["actor_kind"] == "user")
    assert named["actor_name"]
    ru = next(e for e in feed if e["task"]["title"] == "ELD down 125")
    assert ru["task"]["i18n"]["ru"]["title"] == "ELD не работает 125"

    acct = await auth_headers(client, "acct_agent")  # accounting only
    titles = {e["task"]["title"] for e in (await client.get("/api/dashboard/activity", headers=acct)).json()}
    assert titles == {"POD 118", "Manual"}


async def test_ai_stats(client, org, db):
    await seed(db, org)
    h = await auth_headers(client, "manager")
    s = (await client.get("/api/dashboard/ai", headers=h)).json()
    assert s["ai_tasks"] == 3 and s["approved"] == 1 and s["rejected"] == 1 and s["pending_review"] == 1
    assert s["model_calls"] == 3 and s["failed_calls"] == 1 and s["avg_latency_ms"] == 5000
    assert abs(s["avg_confidence"] - 0.75) < 1e-6


async def test_ai_stats_empty(client, org):
    h = await auth_headers(client, "manager")
    s = (await client.get("/api/dashboard/ai", headers=h)).json()
    assert s["ai_tasks"] == 0 and s["avg_confidence"] is None and s["avg_latency_ms"] is None


async def test_old_tasks_outside_trend_window(client, org, db):
    async with db() as s:
        t = await create_task(s, actor=Actor.for_user(org.users["manager"]), title="old")
        t.created_at = utcnow() - timedelta(days=30)
        await s.commit()
    h = await auth_headers(client, "manager")
    days = (await client.get("/api/dashboard/trend?days=14", headers=h)).json()["days"]
    assert sum(d["created"] for d in days) == 0
