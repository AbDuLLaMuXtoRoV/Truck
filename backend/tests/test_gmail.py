"""Gmail connector against a mocked Google API (no network, no real account)."""

import base64
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import func, select

from app.config import get_settings
from app.core.crypto import decrypt
from app.models import Mailbox, Message, ResponseClock
from app.services import gmail
from app.services.gmail import parse_message, sync_mailbox

ADDR = "dispatch@test-trucking.com"


def b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def gmail_message(mid, thread, frm, subject, body, *, labels=("INBOX",), extra_headers=(), ms=1_763_800_000_000, attach=False):
    parts = [{"mimeType": "text/plain", "body": {"data": b64(body)}}]
    if attach:
        parts.append({"mimeType": "application/pdf", "filename": "rate_con.pdf", "body": {"attachmentId": "ATT1", "size": 1234}})
    headers = [{"name": "From", "value": frm}, {"name": "To", "value": ADDR}, {"name": "Subject", "value": subject},
               *[{"name": k, "value": v} for k, v in extra_headers]]
    return {"id": mid, "threadId": thread, "labelIds": list(labels), "internalDate": str(ms),
            "payload": {"mimeType": "multipart/mixed", "headers": headers, "parts": parts}}


@pytest.fixture
def google(monkeypatch):
    """Mock Google endpoints; tests fill `state` to control responses."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    get_settings.cache_clear()
    state = {"history": [], "messages": {}, "history_id": "500", "history_404": False, "calls": []}

    def handler(req: httpx.Request) -> httpx.Response:
        state["calls"].append(f"{req.method} {req.url.path}")
        if req.url.host == "oauth2.googleapis.com":
            form = parse_qs(req.content.decode())
            if form.get("grant_type") == ["authorization_code"]:
                return httpx.Response(200, json={"access_token": "AT1", "refresh_token": "RT1", "expires_in": 3600})
            return httpx.Response(200, json={"access_token": "AT2", "expires_in": 3600})
        path = req.url.path.split("/users/me")[1]
        if path == "/profile":
            return httpx.Response(200, json={"emailAddress": ADDR.upper(), "historyId": state["history_id"]})
        if path == "/history":
            if state["history_404"]:
                return httpx.Response(404, json={"error": {"message": "Requested entity was not found."}})
            return httpx.Response(200, json={"history": [{"messagesAdded": [{"message": {"id": m}}]} for m in state["history"]],
                                             "historyId": state["history_id"]})
        if path == "/messages":
            return httpx.Response(200, json={"messages": [{"id": m} for m in state["messages"]]})
        if path.startswith("/messages/") and "/attachments/" in path:
            return httpx.Response(200, json={"data": b64("%PDF-1.4 rate con")})
        if path.startswith("/messages/"):
            return httpx.Response(200, json=state["messages"][path.split("/")[2]])
        return httpx.Response(404, json={})

    gmail.set_http_factory(lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    yield state
    gmail.set_http_factory(lambda: httpx.AsyncClient(timeout=30))


async def connected_mailbox(db, org) -> Mailbox:
    state = gmail.make_state(org.users["owner"].id, org.company.id, org.depts["DISPATCH"].id)
    async with db() as s:
        m = await gmail.connect_mailbox(s, "CODE", state)
        await s.commit()
        return m


def test_parse_message_strips_quotes_and_detects_automation():
    raw = gmail_message("m1", "t1", "Broker Bob <bob@broker.com>", "Re: Load 88231",
                        "Where is the POD?\n\nOn Mon, Nov 21, 2026 at 9:00 AM Dispatch wrote:\n> old text", attach=True)
    e = parse_message(raw)
    assert e.from_addr == "bob@broker.com" and e.from_name == "Broker Bob" and e.body == "Where is the POD?"
    assert e.attachments[0]["filename"] == "rate_con.pdf" and not e.is_automated
    ooo = parse_message(gmail_message("m2", "t1", "Alice <alice@co.com>", "Automatic reply: Load", "I'm out",
                                      extra_headers=[("Auto-Submitted", "auto-replied")]))
    assert ooo.is_automated
    assert parse_message(gmail_message("m3", "t3", "noreply@loadboard.com", "New loads", "x")).is_automated


async def test_oauth_connect_stores_encrypted_tokens(db, org, google):
    url = gmail.auth_url(gmail.make_state(org.users["owner"].id, org.company.id, None))
    q = parse_qs(urlparse(url).query)
    assert q["scope"] == [gmail.SCOPES] and q["access_type"] == ["offline"] and q["redirect_uri"][0].endswith("/api/integrations/gmail/callback")
    m = await connected_mailbox(db, org)
    assert m.email_address == ADDR and m.history_id == "500" and m.department_id == org.depts["DISPATCH"].id
    assert m.refresh_token_enc != "RT1" and decrypt(m.refresh_token_enc) == "RT1"


async def test_sync_starts_and_stops_clocks_by_thread(db, org, google):
    mailbox = await connected_mailbox(db, org)
    google["messages"] = {
        "a1": gmail_message("a1", "T1", "Broker Bob <bob@broker.com>", "Load 88231 rate con", "Please send the signed rate con", attach=True),
        "a2": gmail_message("a2", "T2", "Out <ooo@other.com>", "Automatic reply", "away", extra_headers=[("Auto-Submitted", "auto-replied")]),
    }
    google["history"], google["history_id"] = ["a1", "a2"], "510"
    async with db() as s:
        m = await s.get(Mailbox, mailbox.id)
        assert await sync_mailbox(s, m) == 2
        await s.commit()
        assert m.history_id == "510" and m.status == "connected"
        clocks = (await s.scalars(select(ResponseClock))).all()
        assert len(clocks) == 1 and clocks[0].channel == "email" and clocks[0].sender_key == "bob@broker.com"
        auto = await s.scalar(select(Message).where(Message.external_id == "a2"))
        assert auto.sender_kind == "automated" and auto.analysis_status == "skipped"

    # staff reply in the same thread (SENT label) stops the clock; an out-of-office would not
    google["messages"]["a3"] = gmail_message("a3", "T1", f"Dispatch <{ADDR}>", "Re: Load 88231 rate con", "Attached", labels=("SENT",))
    google["history"], google["history_id"] = ["a3", "a1"], "520"  # a1 delivered again: idempotent
    async with db() as s:
        m = await s.get(Mailbox, mailbox.id)
        assert await sync_mailbox(s, m) == 1
        await s.commit()
        clock = await s.scalar(select(ResponseClock))
        assert clock.status == "answered" and clock.answered_by_name == "Dispatch"
        assert await s.scalar(select(func.count()).select_from(Message).where(Message.mailbox_id == mailbox.id)) == 3


async def test_expired_history_triggers_controlled_resync(db, org, google):
    mailbox = await connected_mailbox(db, org)
    google["history_404"] = True
    google["messages"] = {"b1": gmail_message("b1", "T9", "c@cust.com", "Invoice 4471", "Did you get the invoice?")}
    google["history_id"] = "900"
    async with db() as s:
        m = await s.get(Mailbox, mailbox.id)
        assert await sync_mailbox(s, m) == 1
        assert m.history_id == "900"
    assert "GET /gmail/v1/users/me/messages" in google["calls"]


async def test_email_attachment_download(db, org, google, tmp_path, monkeypatch):
    from app.models import Attachment
    from app.workers.jobs import job_download_attachment

    monkeypatch.setenv("STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    mailbox = await connected_mailbox(db, org)
    google["messages"] = {"c1": gmail_message("c1", "T5", "bob@broker.com", "RC", "see attached", attach=True)}
    google["history"], google["history_id"] = ["c1"], "600"
    async with db() as s:
        await sync_mailbox(s, await s.get(Mailbox, mailbox.id))
        await s.commit()
        att = await s.scalar(select(Attachment))
    assert await job_download_attachment(att.id) == "downloaded"

