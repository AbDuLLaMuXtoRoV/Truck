import uuid
from datetime import timedelta

from sqlalchemy import select

from app.models import AuditLog, Message, Task, utcnow
from tests.conftest import auth_headers, tg_message


async def create(client, h, **body):
    resp = await client.post("/api/tasks", json={"title": "Test task", **body}, headers=h)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_login_and_me(client, org):
    bad = await client.post("/api/auth/login", json={"email": "manager@test-trucking.com", "password": "wrong"})
    assert bad.status_code == 401 and bad.json()["detail"]["code"] == "invalid_credentials"
    h = await auth_headers(client, "manager")
    me = (await client.get("/api/auth/me", headers=h)).json()
    assert me["role"] == "manager" and "tasks.review" in me["permissions"]
    assert me["company_timezone"] == "America/Chicago"


async def test_requires_auth(client, org):
    assert (await client.get("/api/tasks")).status_code == 401
    assert (await client.get("/api/tasks", headers={"Authorization": "Bearer junk"})).status_code == 401


async def test_task_lifecycle_over_http(client, org):
    mgr = await auth_headers(client, "manager")
    agent = await auth_headers(client, "eld_agent")
    lead = await auth_headers(client, "eld_lead")
    eld = str(org.depts["ELD"].id)

    task = await create(client, mgr, category="eld", priority="P2", department_id=eld, truck_id=str(org.trucks["125"].id))
    assert task["status"] == "needs_review" and task["code"] == "T-1" and task["due_at"]

    # The agent can see it (same department) but cannot review it.
    detail = (await client.get(f"/api/tasks/{task['id']}", headers=agent)).json()
    assert detail["allowed_transitions"] == []
    resp = await client.post(f"/api/tasks/{task['id']}/assign", json={"assignee_id": str(org.users["eld_agent"].id)}, headers=agent)
    assert resp.status_code == 403

    # Lead approves and assigns.
    resp = await client.post(
        f"/api/tasks/{task['id']}/transition",
        json={"to_status": "assigned", "assignee_id": str(org.users["eld_agent"].id)},
        headers=lead,
    )
    assert resp.status_code == 200 and resp.json()["assignee"]["full_name"] == "Eld Agent"

    # Agent works it.
    detail = (await client.get(f"/api/tasks/{task['id']}", headers=agent)).json()
    assert set(detail["allowed_transitions"]) == {"in_progress", "blocked", "pending_verification"}
    for status in ("in_progress", "pending_verification"):
        resp = await client.post(f"/api/tasks/{task['id']}/transition", json={"to_status": status}, headers=agent)
        assert resp.status_code == 200, resp.text

    # Agent cannot verify; lead can.
    resp = await client.post(f"/api/tasks/{task['id']}/transition", json={"to_status": "completed"}, headers=agent)
    assert resp.status_code in (403, 409)
    resp = await client.post(f"/api/tasks/{task['id']}/transition", json={"to_status": "completed"}, headers=lead)
    assert resp.status_code == 200 and resp.json()["completed_at"]

    # Reopen requires a reason and increments the counter.
    resp = await client.post(f"/api/tasks/{task['id']}/transition", json={"to_status": "in_progress"}, headers=lead)
    assert resp.status_code == 422 and resp.json()["detail"]["code"] == "reason_required"
    resp = await client.post(
        f"/api/tasks/{task['id']}/transition", json={"to_status": "in_progress", "reason": "Driver says ELD down again"}, headers=lead
    )
    body = resp.json()
    assert body["reopen_count"] == 1 and body["status"] == "in_progress"
    types = [e["type"] for e in body["events"]]
    assert types[0] == "created" and "reopened" in types and types.count("status_changed") == 4


async def test_visibility_is_scoped_by_department(client, org):
    mgr = await auth_headers(client, "manager")
    await create(client, mgr, title="ELD thing", department_id=str(org.depts["ELD"].id))
    acct = await create(client, mgr, title="Accounting thing", department_id=str(org.depts["ACCOUNTING"].id))

    eld_agent = await auth_headers(client, "eld_agent")
    listed = (await client.get("/api/tasks", headers=eld_agent)).json()
    assert [t["title"] for t in listed["items"]] == ["ELD thing"] and listed["total"] == 1
    assert (await client.get(f"/api/tasks/{acct['id']}", headers=eld_agent)).status_code == 404

    viewer = await auth_headers(client, "viewer")
    assert (await client.get("/api/tasks", headers=viewer)).json()["total"] == 2
    resp = await client.post("/api/tasks", json={"title": "x"}, headers=viewer)
    assert resp.status_code == 403


async def test_filters_and_search(client, org):
    mgr = await auth_headers(client, "manager")
    await create(client, mgr, title="Fix ELD on 125", priority="P1", truck_id=str(org.trucks["125"].id))
    await create(client, mgr, title="Upload POD", priority="P4", load_ref="88231")
    by_priority = (await client.get("/api/tasks?priority=P1", headers=mgr)).json()
    assert [t["title"] for t in by_priority["items"]] == ["Fix ELD on 125"]
    by_code = (await client.get("/api/tasks?q=T-2", headers=mgr)).json()
    assert [t["code"] for t in by_code["items"]] == ["T-2"]
    by_load = (await client.get("/api/tasks?q=88231", headers=mgr)).json()
    assert by_load["total"] == 1
    by_truck = (await client.get(f"/api/tasks?truck_id={org.trucks['125'].id}", headers=mgr)).json()
    assert by_truck["total"] == 1


async def test_overdue_is_a_flag_not_a_status(client, org, db):
    mgr = await auth_headers(client, "manager")
    task = await create(client, mgr, assignee_id=str(org.users["eld_agent"].id), department_id=str(org.depts["ELD"].id))
    async with db() as s:
        t = await s.get(Task, uuid.UUID(task["id"]))
        t.due_at = utcnow() - timedelta(hours=1)
        await s.commit()
    listed = (await client.get("/api/tasks?overdue=true", headers=mgr)).json()
    assert listed["total"] == 1
    assert listed["items"][0]["status"] == "assigned" and listed["items"][0]["is_overdue"] is True
    summary = (await client.get("/api/dashboard/summary", headers=mgr)).json()
    assert summary["overdue"] == 1 and summary["open_tasks"] == 1
    eld = next(d for d in summary["by_department"] if d["code"] == "ELD")
    assert eld == {**eld, "open": 1, "overdue": 1}


async def test_merge_duplicates(client, org):
    mgr = await auth_headers(client, "manager")
    a = await create(client, mgr, title="ELD broken 125")
    b = await create(client, mgr, title="ELD not working 125")
    resp = await client.post(f"/api/tasks/{b['id']}/merge", json={"into_task_id": a["id"]}, headers=mgr)
    assert resp.status_code == 200
    merged = (await client.get(f"/api/tasks/{b['id']}", headers=mgr)).json()
    assert merged["status"] == "cancelled" and merged["merged_into_id"] == a["id"]
    assert "Duplicate of T-1" in merged["cancel_reason"]


async def test_dashboard_summary_counts_groups(client, org):
    h = await auth_headers(client, "manager")
    s = (await client.get("/api/dashboard/summary", headers=h)).json()
    assert s["connected_groups"] == 3 and s["enabled_groups"] == 2 and s["pending_groups"] == 1


async def test_group_allow_list_requires_groups_manage(client, org, db):
    gid = org.groups["disabled"].id
    mgr = await auth_headers(client, "manager")
    assert (await client.patch(f"/api/groups/{gid}", json={"is_enabled": True}, headers=mgr)).status_code == 403
    owner = await auth_headers(client, "owner")
    resp = await client.patch(
        f"/api/groups/{gid}", json={"is_enabled": True, "kind": "truck", "truck_id": str(org.trucks["127"].id)}, headers=owner
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_enabled"] and body["truck"]["unit_number"] == "127"
    async with db() as s:
        audit = (await s.scalars(select(AuditLog).where(AuditLog.action == "group.updated"))).all()
    assert len(audit) == 1
    # explicit null clears the truck
    resp = await client.patch(f"/api/groups/{gid}", json={"truck_id": None}, headers=owner)
    assert resp.json()["truck"] is None


async def test_telegram_webhook_requires_secret(client, org, db):
    update = tg_message(-100125, "Aka ELD ishlamayapti")
    assert (await client.post("/api/telegram/webhook", json=update)).status_code == 401
    bad = {"X-Telegram-Bot-Api-Secret-Token": "nope"}
    assert (await client.post("/api/telegram/webhook", json=update, headers=bad)).status_code == 401
    ok = {"X-Telegram-Bot-Api-Secret-Token": "test-secret"}
    resp = await client.post("/api/telegram/webhook", json=update, headers=ok)
    assert resp.status_code == 200 and resp.json()["action"] == "stored"
    async with db() as s:
        assert (await s.scalar(select(Message))).text == "Aka ELD ishlamayapti"


async def test_messages_endpoint_permission(client, org):
    agent = await auth_headers(client, "eld_agent")
    assert (await client.get("/api/messages", headers=agent)).status_code == 403
    mgr = await auth_headers(client, "manager")
    assert (await client.get("/api/messages", headers=mgr)).status_code == 200


async def test_user_admin(client, org):
    mgr = await auth_headers(client, "manager")
    body = {"email": "new@test-trucking.com", "full_name": "New", "password": "longenough1", "role": "agent"}
    assert (await client.post("/api/users", json=body, headers=mgr)).status_code == 403
    owner = await auth_headers(client, "owner")
    assert (await client.post("/api/users", json=body, headers=owner)).status_code == 201
    assert (await client.post("/api/users", json=body, headers=owner)).status_code == 409


async def test_telegram_link_token(client, org):
    h = await auth_headers(client, "eld_agent")
    body = (await client.post("/api/me/telegram-link", headers=h)).json()
    assert body["deep_link"] == f"https://t.me/smart_truck_test_bot?start={body['token']}"
    assert len(body["token"]) <= 64


async def test_cannot_reference_another_companys_rows(client, org):
    mgr = await auth_headers(client, "manager")
    foreign = str(uuid.uuid4())
    for field in ("department_id", "truck_id"):
        resp = await client.post("/api/tasks", json={"title": "x", field: foreign}, headers=mgr)
        assert resp.status_code == 422, field
    task = await create(client, mgr)
    resp = await client.patch(f"/api/tasks/{task['id']}", json={"truck_id": foreign}, headers=mgr)
    assert resp.status_code == 422


async def test_agent_cannot_skip_review_by_assigning_others(client, org):
    agent = await auth_headers(client, "eld_agent")
    other = str(org.users["eld_agent2"].id)
    resp = await client.post("/api/tasks", json={"title": "x", "assignee_id": other}, headers=agent)
    assert resp.status_code == 403
    own = await create(client, agent, assignee_id=str(org.users["eld_agent"].id))
    assert own["status"] == "assigned"
    lead = await auth_headers(client, "eld_lead")
    led = await create(client, lead, assignee_id=other, department_id=str(org.depts["ELD"].id))
    assert led["status"] == "assigned"


async def test_explicit_null_on_required_fields_is_422_not_500(client, org):
    owner = await auth_headers(client, "owner")
    task = await create(client, owner)
    for body in ({"title": None}, {"priority": None}, {"category": None}):
        assert (await client.patch(f"/api/tasks/{task['id']}", json=body, headers=owner)).status_code == 422
    gid = org.groups["disabled"].id
    for body in ({"is_enabled": None}, {"kind": None}):
        assert (await client.patch(f"/api/groups/{gid}", json=body, headers=owner)).status_code == 422
    uid = org.users["eld_agent"].id
    assert (await client.patch(f"/api/users/{uid}", json={"role": None}, headers=owner)).status_code == 422
    # nullable fields can still be cleared
    assert (await client.patch(f"/api/tasks/{task['id']}", json={"due_at": None}, headers=owner)).status_code == 200


async def test_login_accepts_internal_domains(client, org, db):
    from app.models import User

    async with db() as s:
        u = await s.get(User, org.users["viewer"].id)
        u.email = "ops@company.local"
        await s.commit()
    resp = await client.post("/api/auth/login", json={"email": "OPS@company.local", "password": "password123"})
    assert resp.status_code == 200


async def test_notifications_read_one_and_count(client, org):
    mgr = await auth_headers(client, "manager")
    await create(client, mgr, title="for agent", assignee_id=str(org.users["eld_agent"].id), department_id=str(org.depts["ELD"].id))
    agent = await auth_headers(client, "eld_agent")
    assert (await client.get("/api/notifications/unread-count", headers=agent)).json() == {"unread": 1}
    [n] = (await client.get("/api/notifications", headers=agent)).json()
    assert n["kind"] == "assigned"
    assert (await client.post(f"/api/notifications/{n['id']}/read", headers=agent)).status_code == 204
    assert (await client.get("/api/notifications/unread-count", headers=agent)).json() == {"unread": 0}
    assert (await client.get("/api/notifications?limit=-1", headers=agent)).status_code == 422


async def test_unrouted_filter_and_due_sort(client, org):
    mgr = await auth_headers(client, "manager")
    await create(client, mgr, title="routed", department_id=str(org.depts["ELD"].id))
    await create(client, mgr, title="unrouted")
    listed = (await client.get("/api/tasks?unrouted=true", headers=mgr)).json()
    assert [t["title"] for t in listed["items"]] == ["unrouted"]
    ordered = (await client.get("/api/tasks?sort=due_asc", headers=mgr)).json()["items"]
    dues = [t["due_at"] for t in ordered]
    assert dues == sorted(dues)


async def test_meta(client, org):
    meta = (await client.get("/api/meta")).json()
    assert "pending_verification" in meta["statuses"]
    assert meta["transitions"]["completed"] == ["in_progress"]


async def test_attachment_download_permissions(client, org, db, tmp_path, monkeypatch):
    from app.config import get_settings
    from app.domain.enums import AttachmentStatus, TaskMessageRelation
    from app.models import Attachment, TaskMessage
    from app.services.ingest import ingest_update
    from app.services.storage import get_storage
    from tests.conftest import tg_message as tgm

    monkeypatch.setenv("STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    upd = tgm(-100125, None, caption="BOL", document={"file_id": "D1", "file_unique_id": "UD1", "file_name": "bol 88.pdf",
                                                      "mime_type": "application/pdf", "file_size": 10})
    async with db() as s:
        r = await ingest_update(s, upd)
        await s.commit()
        att = await s.scalar(select(Attachment))
        att.storage_key = get_storage().save("c/bol.pdf", b"%PDF-1.4 fake")
        att.status = AttachmentStatus.DOWNLOADED
        await s.commit()
        att_id = att.id

    mgr = await auth_headers(client, "manager")
    resp = await client.get(f"/api/attachments/{att_id}/file", headers=mgr)
    assert resp.status_code == 200 and resp.content == b"%PDF-1.4 fake"
    assert resp.headers["content-type"] == "application/pdf" and "bol%2088.pdf" in resp.headers["content-disposition"]

    agent = await auth_headers(client, "eld_agent")  # no messages.read, no linked task yet
    assert (await client.get(f"/api/attachments/{att_id}/file", headers=agent)).status_code == 404
    task = await create(client, mgr, department_id=str(org.depts["ELD"].id))
    async with db() as s:
        s.add(TaskMessage(task_id=uuid.UUID(task["id"]), message_id=r.message_id, relation=TaskMessageRelation.SOURCE))
        await s.commit()
    assert (await client.get(f"/api/attachments/{att_id}/file", headers=agent)).status_code == 200
    assert (await client.get(f"/api/attachments/{uuid.uuid4()}/file", headers=mgr)).status_code == 404


async def test_login_lockout_after_five_wrong_passwords(client, org):
    from app.api.routes import auth as auth_routes

    auth_routes._failed_logins.clear()
    body = {"email": "viewer@test-trucking.com", "password": "wrong-password"}
    for _ in range(5):
        assert (await client.post("/api/auth/login", json=body)).status_code == 401
    locked = await client.post("/api/auth/login", json={**body, "password": "password123"})
    assert locked.status_code == 429 and locked.json()["detail"]["code"] == "too_many_attempts"
    # other accounts are unaffected
    assert (await client.post("/api/auth/login", json={"email": "manager@test-trucking.com", "password": "password123"})).status_code == 200
    auth_routes._failed_logins.clear()
