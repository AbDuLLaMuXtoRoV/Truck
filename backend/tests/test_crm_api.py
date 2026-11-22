import uuid
from datetime import timedelta

from sqlalchemy import select

from app.domain.enums import TaskStatus
from app.models import (
    AuditLog,
    Company,
    Department,
    Handover,
    Mailbox,
    ResponseClock,
    Task,
    TelegramGroup,
    TelegramUser,
    UserCompanyAccess,
    utcnow,
)
from app.services.ingest import ingest_update
from app.services.response import run_response_checks
from tests.conftest import auth_headers, tg_message


TITLES = {-100125: "Truck 125", -100900: "Dispatch Team"}


async def driver_says(db, text, user_id=6001, chat=-100125, first_name="Aziz"):
    upd = tg_message(chat, text, user_id=user_id, first_name=first_name)
    upd["message"]["chat"]["title"] = TITLES.get(chat, f"chat {chat}")  # ingestion syncs titles from Telegram
    async with db() as s:
        r = await ingest_update(s, upd)
        await s.commit()
    return r


async def eld_group(db, org):
    async with db() as s:
        (await s.get(TelegramGroup, org.groups["t125"].id)).department_id = org.depts["ELD"].id
        await s.commit()


# --------------------------------------------------------------------------- inbox


async def test_inbox_lists_conversations_with_timers(client, org, db):
    await eld_group(db, org)
    await driver_says(db, "125 ELD ishlamayapti")
    await driver_says(db, "Dispatch, lumper 150$ kim to'laydi?", chat=-100900, user_id=6002, first_name="Bekzod")
    h = await auth_headers(client, "manager")
    convs = (await client.get("/api/inbox", headers=h)).json()
    assert {c["channel_name"] for c in convs} == {"Truck 125", "Dispatch Team"}
    c = next(c for c in convs if c["channel_name"] == "Truck 125")
    assert c["source"] == "telegram" and c["unanswered"] == 1 and c["department"]["code"] == "ELD"
    assert 0 < c["oldest_pending"]["seconds_left"] <= 300 and c["last_message"]["sender_name"] == "Aziz"
    assert (await client.get("/api/inbox?state=overdue", headers=h)).json() == []
    assert len((await client.get("/api/inbox?state=unanswered&q=lumper", headers=h)).json()) == 1

    thread = (await client.get(f"/api/inbox/thread?key={c['key']}", headers=h)).json()
    assert thread["channel_name"] == "Truck 125" and thread["messages"][0]["clock"]["status"] == "pending"

    # department scoping: the ELD agent sees the ELD conversation only
    agent = await auth_headers(client, "eld_agent")
    assert [x["channel_name"] for x in (await client.get("/api/inbox", headers=agent)).json()] == ["Truck 125"]
    other = next(x for x in convs if x["channel_name"] == "Dispatch Team")
    assert (await client.get(f"/api/inbox/thread?key={other['key']}", headers=agent)).status_code == 404


async def test_overdue_sorts_first_and_no_reply_needed(client, org, db):
    await eld_group(db, org)
    await driver_says(db, "First problem")
    async with db() as s:
        clock = await s.scalar(select(ResponseClock))
        clock.started_at -= timedelta(minutes=7)
        clock.due_at -= timedelta(minutes=7)
        await s.commit()
    await driver_says(db, "Another question", chat=-100900, user_id=6003)
    h = await auth_headers(client, "manager")
    convs = (await client.get("/api/inbox", headers=h)).json()
    assert convs[0]["channel_name"] == "Truck 125" and convs[0]["oldest_pending"]["seconds_left"] < 0
    resp = await client.post(f"/api/inbox/clocks/{convs[0]['oldest_pending']['id']}/no-response", json={"reason": "FYI only"}, headers=h)
    assert resp.status_code == 200 and resp.json()["status"] == "not_needed"
    async with db() as s:
        assert await s.scalar(select(AuditLog).where(AuditLog.action == "response.no_reply_needed")) is not None


async def test_create_issue_from_message_links_clock_and_escalation_flow(client, org, db):
    await eld_group(db, org)
    r = await driver_says(db, "Trailer T-1192 qaytarilmadi, customer bo'sh dedi")
    h = await auth_headers(client, "manager")
    task = (await client.post(f"/api/inbox/messages/{r.message_id}/task", json={"category": "trailer", "priority": "P2"},
                              headers=h)).json()
    assert task["source_channel"] == "telegram" and task["response_status"] == "unanswered"
    async with db() as s:
        await run_response_checks(s, utcnow() + timedelta(minutes=6))
        await s.commit()
    detail = (await client.get(f"/api/tasks/{task['id']}", headers=h)).json()
    assert detail["response"]["message_answered"] is False and detail["response"]["pending"]["level"] == 2
    kinds = [e["kind"] for e in detail["escalations"]]
    assert kinds == ["overdue"] and detail["escalations"][0]["clock"]["channel_name"] == "Truck 125"

    detail = (await client.post(f"/api/tasks/{task['id']}/escalate", json={"reason": "Customer threatening fees"}, headers=h)).json()
    # (the ladder step was simulated 6 minutes in the future, so compare without order)
    assert sorted(e["kind"] for e in detail["escalations"]) == ["manual", "overdue"]
    feed = (await client.get("/api/escalations", headers=h)).json()
    assert {e["kind"] for e in feed} == {"overdue", "manual"} and feed[0]["task"]["code"] == task["code"]


async def test_cross_channel_link_message(client, org, db):
    await eld_group(db, org)
    r1 = await driver_says(db, "Load 88231 POD yo'q")
    r2 = await driver_says(db, "88231 bo'yicha broker ham so'rayapti", chat=-100900, user_id=6004)
    h = await auth_headers(client, "manager")
    task = (await client.post(f"/api/inbox/messages/{r1.message_id}/task", json={}, headers=h)).json()
    detail = (await client.post(f"/api/tasks/{task['id']}/link-message", json={"message_id": str(r2.message_id)}, headers=h)).json()
    assert len(detail["messages"]) == 2 and {m["group"]["title"] for m in detail["messages"]} == {"Truck 125", "Dispatch Team"}


async def test_response_stats(client, org, db):
    await eld_group(db, org)
    await driver_says(db, "Help with ELD")
    async with db() as s:
        tg = TelegramUser(id=uuid.uuid4(), company_id=org.company.id, tg_user_id=6100, first_name="Staff", is_staff=True)
        s.add(tg)
        await s.commit()
    await driver_says(db, "On it", user_id=6100, first_name="Staff")
    await driver_says(db, "Second question", user_id=6005)
    h = await auth_headers(client, "manager")
    stats = (await client.get("/api/dashboard/response?days=7", headers=h)).json()
    assert stats["answered_today"] == 1 and stats["unanswered_0_5"] == 1 and stats["within_sla_pct_today"] == 100.0
    assert stats["trend"][-1]["inbound"] == 2 and stats["by_department"][0]["code"] == "ELD"
    badges = (await client.get("/api/dashboard/badges", headers=h)).json()
    assert badges["unanswered"] == 1 and badges["overdue_responses"] == 0


# --------------------------------------------------------------------------- multi-company


async def second_company(db, org, *, grant=True) -> Company:
    async with db() as s:
        c2 = Company(id=uuid.uuid4(), name="Second Freight", timezone="America/New_York", settings={})
        s.add(c2)
        await s.flush()
        s.add(Department(company_id=c2.id, code="DISPATCH", name="Dispatch"))
        s.add(Task(company_id=c2.id, number=1, title="C2 issue", status=TaskStatus.NEEDS_REVIEW))
        if grant:
            s.add(UserCompanyAccess(user_id=org.users["owner"].id, company_id=c2.id))
        await s.commit()
        return c2


async def test_company_switching_is_scoped_and_audited(client, org, db):
    c2 = await second_company(db, org)
    owner = await auth_headers(client, "owner")
    me = (await client.get("/api/auth/me", headers=owner)).json()
    assert {c["name"] for c in me["companies"]} == {"Test Trucking", "Second Freight"}

    scoped = {**owner, "X-Company-Id": str(c2.id)}
    assert (await client.get("/api/auth/me", headers=scoped)).json()["company_name"] == "Second Freight"
    assert [t["title"] for t in (await client.get("/api/tasks", headers=scoped)).json()["items"]] == ["C2 issue"]
    assert "C2 issue" not in [t["title"] for t in (await client.get("/api/tasks", headers=owner)).json()["items"]]
    async with db() as s:
        assert await s.scalar(select(AuditLog).where(AuditLog.action == "company.cross_access")) is not None

    mgr = await auth_headers(client, "manager")  # no access to company 2
    assert (await client.get("/api/tasks", headers={**mgr, "X-Company-Id": str(c2.id)})).status_code == 403
    assert (await client.get("/api/tasks", headers={**mgr, "X-Company-Id": "nonsense"})).status_code == 400


async def test_owner_overview_and_create_company(client, org, db):
    await second_company(db, org)
    owner = await auth_headers(client, "owner")
    ov = (await client.get("/api/owner/overview", headers=owner)).json()
    assert ov["companies"] == 2 and ov["telegram_groups"] == 2 and {p["name"] for p in ov["per_company"]} == {"Test Trucking", "Second Freight"}
    assert ov["open_issues"] == 1
    created = await client.post("/api/companies", json={"name": "Third Logistics"}, headers=owner)
    assert created.status_code == 201
    assert len((await client.get("/api/companies", headers=owner)).json()) == 3
    mgr = await auth_headers(client, "manager")
    assert (await client.post("/api/companies", json={"name": "x"}, headers=mgr)).status_code == 403
    assert (await client.get("/api/owner/overview", headers=mgr)).json()["companies"] == 1


# --------------------------------------------------------------------------- shifts & handover


async def test_shift_handover_keeps_owner_until_accepted(client, org, db):
    mgr = await auth_headers(client, "manager")
    task = (await client.post("/api/tasks", json={"title": "ELD issue", "department_id": str(org.depts["ELD"].id),
                                                  "assignee_id": str(org.users["eld_agent"].id)}, headers=mgr)).json()
    agent = await auth_headers(client, "eld_agent")
    assert (await client.post("/api/shifts/start", headers=agent)).json()["status"] == "active"
    coverage = {r["code"]: r for r in (await client.get("/api/shifts/coverage", headers=mgr)).json()}
    assert [u["full_name"] for u in coverage["ELD"]["on_duty"]] == ["Eld Agent"]

    end = (await client.post("/api/shifts/end", json={"handover_to_user_id": str(org.users["eld_agent2"].id), "note": "watch 125"},
                             headers=agent)).json()
    assert end["shift"]["status"] == "ended" and end["handover"]["task_count"] == 1
    # still owned by the outgoing agent until accepted
    assert (await client.get(f"/api/tasks/{task['id']}", headers=mgr)).json()["assignee"]["full_name"] == "Eld Agent"

    agent2 = await auth_headers(client, "eld_agent2")
    me2 = (await client.get("/api/shifts/me", headers=agent2)).json()
    assert len(me2["incoming_handovers"]) == 1 and me2["incoming_handovers"][0]["tasks"][0]["code"] == task["code"]
    assert (await client.get("/api/dashboard/badges", headers=agent2)).json()["pending_handovers"] == 1
    hid = me2["incoming_handovers"][0]["id"]
    assert (await client.post(f"/api/handovers/{hid}/accept", headers=agent)).status_code == 403  # not addressed to them
    assert (await client.post(f"/api/handovers/{hid}/accept", headers=agent2)).json()["status"] == "accepted"
    assert (await client.get(f"/api/tasks/{task['id']}", headers=mgr)).json()["assignee"]["full_name"] == "Eld Agent2"
    assert (await client.post(f"/api/handovers/{hid}/accept", headers=agent2)).status_code == 409


async def test_unaccepted_handover_alerts_supervisor(client, org, db):
    from app.services.shifts import run_coverage_checks

    agent = await auth_headers(client, "eld_agent")
    await client.post("/api/shifts/start", headers=agent)
    await client.post("/api/shifts/end", json={"handover_to_user_id": str(org.users["eld_agent2"].id)}, headers=agent)
    async with db() as s:
        assert (await run_coverage_checks(s))["handover_alerts"] == 0
        assert (await run_coverage_checks(s, utcnow() + timedelta(minutes=16)))["handover_alerts"] == 1
        assert (await run_coverage_checks(s, utcnow() + timedelta(minutes=30)))["handover_alerts"] == 0
        await s.commit()
        assert (await s.scalar(select(Handover))).alerted_at is not None


# --------------------------------------------------------------------------- integrations / TMS / roster


async def test_loads_import_and_search(client, org):
    owner = await auth_headers(client, "owner")
    csv_text = "Load #,Truck,Trailer,Driver,Broker,Status\n88231,126,1192,Alex K.,CH Robinson,In transit\n,1,2,3,4,5\n"
    res = (await client.post("/api/loads/import", json={"csv": csv_text}, headers=owner)).json()
    assert res["created"] == 1 and res["updated"] == 0 and len(res["errors"]) == 1
    again = (await client.post("/api/loads/import", json={"csv": csv_text.replace("In transit", "Delivered")}, headers=owner)).json()
    assert again["updated"] == 1
    [load] = (await client.get("/api/loads?q=alex", headers=owner)).json()
    assert load["trailer_ref"] == "T-1192" and load["truck_unit"] == "126" and load["status"] == "Delivered"
    bad = (await client.post("/api/loads/import", json={"csv": "foo,bar\n1,2"}, headers=owner)).json()
    assert bad["created"] == 0 and "load number" in bad["errors"][0]


async def test_roster_marks_staff(client, org, db):
    await driver_says(db, "Salom", user_id=6200, first_name="Nightshift")
    owner = await auth_headers(client, "owner")
    [person] = [p for p in (await client.get("/api/roster/telegram", headers=owner)).json() if p["tg_user_id"] == 6200]
    assert person["is_staff"] is False and person["message_count"] == 1
    linked = (await client.patch(f"/api/roster/telegram/{person['id']}", json={"linked_user_id": str(org.users["eld_agent"].id)},
                                 headers=owner)).json()
    assert linked["is_staff"] and linked["linked_user"]["full_name"] == "Eld Agent"
    mgr = await auth_headers(client, "manager")
    assert (await client.patch(f"/api/roster/telegram/{person['id']}", json={"is_staff": False}, headers=mgr)).status_code == 403


async def test_integrations_status_and_mailbox_admin(client, org, db):
    async with db() as s:
        s.add(Mailbox(company_id=org.company.id, email_address="dispatch@test-trucking.com", status="connected"))
        await s.commit()
    owner = await auth_headers(client, "owner")
    st = (await client.get("/api/integrations/status", headers=owner)).json()
    assert st["gmail"]["configured"] is False and st["gmail"]["mailboxes"][0]["email_address"] == "dispatch@test-trucking.com"
    assert st["telegram"]["groups_enabled"] == 2 and st["telegram"]["groups_pending"] == 1
    assert (await client.post("/api/integrations/gmail/connect", json={}, headers=owner)).status_code == 409
    mid = st["gmail"]["mailboxes"][0]["id"]
    patched = (await client.patch(f"/api/mailboxes/{mid}", json={"department_id": str(org.depts["ACCOUNTING"].id)}, headers=owner)).json()
    assert patched["department"]["code"] == "ACCOUNTING"
    assert (await client.delete(f"/api/mailboxes/{mid}", headers=owner)).status_code == 204
    async with db() as s:
        m = await s.get(Mailbox, uuid.UUID(mid))
        assert m.status == "disconnected" and m.refresh_token_enc is None


async def test_group_escalation_policy_and_company_move(client, org, db):
    c2 = await second_company(db, org)
    owner = await auth_headers(client, "owner")
    gid = org.groups["t125"].id
    resp = (await client.patch(f"/api/groups/{gid}", json={"supervisor_id": str(org.users["eld_lead"].id)}, headers=owner)).json()
    assert resp["supervisor_id"] == str(org.users["eld_lead"].id)
    moved = await client.patch(f"/api/groups/{gid}", json={"company_id": str(c2.id)}, headers=owner)
    assert moved.status_code == 200
    async with db() as s:
        g = await s.get(TelegramGroup, gid)
        assert g.company_id == c2.id and g.truck_id is None and g.supervisor_id is None
