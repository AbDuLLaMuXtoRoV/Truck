"""Gmail / Google Workspace connector (blueprint sec. 5).

- OAuth 2.0 with the least-privilege read-only scope; tokens encrypted at rest.
- Sync with users.history.list from the stored historyId (polled every minute; a Pub/Sub watch push
  can trigger a sync sooner). An expired historyId triggers a controlled re-sync of the last day.
- Replies are tracked by thread id and staff identity; out-of-office and other automatic emails
  never count as a human response.
"""

import base64
import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.utils import getaddresses, parseaddr
from html import unescape
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.domain.enums import AnalysisStatus, AttachmentStatus, MessageKind, TranscriptStatus
from app.models import Attachment, Mailbox, Message, User, utcnow
from app.services.response import record_staff_reply, start_clock

log = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly"
MAX_BODY = 8000

_http_factory: Callable[[], httpx.AsyncClient] = lambda: httpx.AsyncClient(timeout=30)  # noqa: E731


def set_http_factory(factory: Callable[[], httpx.AsyncClient]) -> None:
    """Test hook: route Google calls through a mock transport."""
    global _http_factory
    _http_factory = factory


class GmailError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


# --------------------------------------------------------------------------- OAuth


def is_configured() -> bool:
    s = get_settings()
    return bool(s.google_client_id and s.google_client_secret)


def redirect_uri() -> str:
    return f"{get_settings().public_url.rstrip('/')}/api/integrations/gmail/callback"


def make_state(user_id: uuid.UUID, company_id: uuid.UUID, department_id: uuid.UUID | None) -> str:
    payload = {"p": "gmail", "u": str(user_id), "c": str(company_id), "d": str(department_id) if department_id else None,
               "exp": int((datetime.now(UTC) + timedelta(minutes=10)).timestamp())}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


def read_state(state: str) -> dict:
    payload = jwt.decode(state, get_settings().jwt_secret, algorithms=["HS256"])
    if payload.get("p") != "gmail":
        raise jwt.InvalidTokenError("wrong purpose")
    return payload


def auth_url(state: str) -> str:
    params = {
        "client_id": get_settings().google_client_id,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


async def _token_request(data: dict) -> dict:
    s = get_settings()
    async with _http_factory() as http:
        resp = await http.post(TOKEN_URL, data={**data, "client_id": s.google_client_id, "client_secret": s.google_client_secret})
    body = resp.json() if resp.content else {}
    if resp.status_code != 200:
        raise GmailError(resp.status_code, body.get("error_description") or body.get("error") or "token error")
    return body


async def _api(method: str, path: str, token: str, params: dict | None = None) -> dict:
    async with _http_factory() as http:
        resp = await http.request(method, f"{API}{path}", params=params, headers={"Authorization": f"Bearer {token}"})
    body = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        raise GmailError(resp.status_code, (body.get("error") or {}).get("message", "gmail error") if isinstance(body.get("error"), dict) else str(body))
    return body


async def connect_mailbox(session: AsyncSession, code: str, state: str) -> Mailbox:
    claims = read_state(state)
    tokens = await _token_request({"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri()})
    access = tokens["access_token"]
    profile = await _api("GET", "/profile", access)
    email = profile["emailAddress"].lower()
    company_id = uuid.UUID(claims["c"])
    mailbox = await session.scalar(select(Mailbox).where(Mailbox.company_id == company_id, Mailbox.email_address == email))
    if mailbox is None:
        mailbox = Mailbox(id=uuid.uuid4(), company_id=company_id, email_address=email)
        session.add(mailbox)
    mailbox.department_id = uuid.UUID(claims["d"]) if claims.get("d") else mailbox.department_id
    mailbox.connected_by_user_id = uuid.UUID(claims["u"])
    if tokens.get("refresh_token"):
        mailbox.refresh_token_enc = encrypt(tokens["refresh_token"])
    mailbox.access_token_enc = encrypt(access)
    mailbox.token_expires_at = utcnow() + timedelta(seconds=int(tokens.get("expires_in", 3600)) - 60)
    mailbox.history_id = str(profile.get("historyId")) if profile.get("historyId") else None  # start from now
    mailbox.status = "connected"
    mailbox.is_enabled = True
    mailbox.last_error = None
    await session.flush()
    return mailbox


async def access_token(session: AsyncSession, mailbox: Mailbox) -> str:
    token = decrypt(mailbox.access_token_enc)
    if token and mailbox.token_expires_at and mailbox.token_expires_at > utcnow():
        return token
    refresh = decrypt(mailbox.refresh_token_enc)
    if not refresh:
        raise GmailError(401, "No refresh token — reconnect the mailbox")
    tokens = await _token_request({"refresh_token": refresh, "grant_type": "refresh_token"})
    mailbox.access_token_enc = encrypt(tokens["access_token"])
    mailbox.token_expires_at = utcnow() + timedelta(seconds=int(tokens.get("expires_in", 3600)) - 60)
    return tokens["access_token"]


# --------------------------------------------------------------------------- parsing


@dataclass
class ParsedEmail:
    id: str
    thread_id: str
    labels: list[str]
    from_name: str
    from_addr: str
    to: list[str]
    subject: str
    sent_at: datetime
    body: str
    headers: dict[str, str]
    attachments: list[dict] = field(default_factory=list)

    @property
    def is_automated(self) -> bool:
        h = {k.lower(): v.lower() for k, v in self.headers.items()}
        if h.get("auto-submitted", "no") != "no" or "x-autoreply" in h or "x-autorespond" in h:
            return True
        if h.get("precedence") in ("bulk", "junk", "list", "auto_reply") or "list-unsubscribe" in h or "list-id" in h:
            return True
        local = self.from_addr.split("@")[0].lower()
        if local in {"noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon", "postmaster", "notifications", "notification"}:
            return True
        subj = self.subject.lower()
        return subj.startswith(("out of office", "automatic reply", "auto:", "autoreply", "avtomatik javob", "автоответ"))


_QUOTE_START = re.compile(r"^(on .+ wrote:|.+ написал\(а\):|-----original message-----|from: .+)$", re.IGNORECASE)


def strip_quoted(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if _QUOTE_START.match(line.strip()):
            break
        if line.lstrip().startswith(">"):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _b64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _walk(part: dict, out: dict) -> None:
    mime = part.get("mimeType", "")
    body = part.get("body") or {}
    if part.get("filename"):
        out["attachments"].append({"filename": part["filename"], "mime": mime, "size": body.get("size"),
                                   "attachment_id": body.get("attachmentId")})
    elif mime == "text/plain" and body.get("data") and not out["plain"]:
        out["plain"] = _b64(body["data"]).decode("utf-8", "replace")
    elif mime == "text/html" and body.get("data") and not out["html"]:
        out["html"] = _b64(body["data"]).decode("utf-8", "replace")
    for sub in part.get("parts") or []:
        _walk(sub, out)


def _html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", html)
    return unescape(re.sub(r"<[^>]+>", " ", html))


def parse_message(raw: dict) -> ParsedEmail:
    payload = raw.get("payload") or {}
    headers = {h["name"]: h["value"] for h in payload.get("headers", [])}
    found = {"plain": "", "html": "", "attachments": []}
    _walk(payload, found)
    body = found["plain"] or _html_to_text(found["html"]) or raw.get("snippet", "")
    name, addr = parseaddr(headers.get("From", ""))
    return ParsedEmail(
        id=raw["id"],
        thread_id=raw.get("threadId", raw["id"]),
        labels=raw.get("labelIds", []),
        from_name=name or addr,
        from_addr=addr.lower(),
        to=[a.lower() for _, a in getaddresses([headers.get("To", "")]) if a],
        subject=headers.get("Subject", "")[:500],
        sent_at=datetime.fromtimestamp(int(raw.get("internalDate", "0")) / 1000, UTC) if raw.get("internalDate") else utcnow(),
        body=strip_quoted(body)[:MAX_BODY],
        headers=headers,
        attachments=found["attachments"],
    )


# --------------------------------------------------------------------------- ingestion


async def ingest_email(session: AsyncSession, mailbox: Mailbox, email: ParsedEmail) -> Message | None:
    exists = await session.scalar(select(Message.id).where(Message.mailbox_id == mailbox.id, Message.external_id == email.id))
    if exists:
        return None  # idempotent: the same Gmail message never produces two records
    outbound = "SENT" in email.labels or email.from_addr == mailbox.email_address.lower()
    staff_user = await session.scalar(
        select(User).where(User.company_id == mailbox.company_id, func.lower(User.email) == email.from_addr, User.is_active.is_(True))
    )
    if email.is_automated:
        sender_kind = "automated"
    elif outbound or staff_user is not None:
        sender_kind = "staff"
    else:
        sender_kind = "external"
    message = Message(
        id=uuid.uuid4(),
        company_id=mailbox.company_id,
        channel="email",
        mailbox_id=mailbox.id,
        thread_key=f"mail:{mailbox.id}:{email.thread_id}",
        external_id=email.id,
        thread_id=email.thread_id,
        subject=email.subject or None,
        from_address=f"{email.from_name} <{email.from_addr}>" if email.from_name != email.from_addr else email.from_addr,
        direction="outbound" if (outbound or sender_kind == "staff") else "inbound",
        sender_kind=sender_kind,
        sent_at=email.sent_at,
        kind=MessageKind.DOCUMENT if email.attachments else MessageKind.TEXT,
        text=email.body or None,
        raw={"headers": {k: v for k, v in email.headers.items() if k in ("From", "To", "Subject", "Date", "Message-ID", "In-Reply-To")},
             "labels": email.labels},
        analysis_status=AnalysisStatus.SKIPPED if sender_kind == "automated" else AnalysisStatus.PENDING,
        transcript_status=TranscriptStatus.NOT_NEEDED,
        is_command=False,
        classification="automated" if sender_kind == "automated" else None,
    )
    session.add(message)
    for a in email.attachments:
        session.add(Attachment(
            id=uuid.uuid4(), company_id=mailbox.company_id, message_id=message.id,
            kind=MessageKind.PHOTO if (a["mime"] or "").startswith("image/") else MessageKind.DOCUMENT,
            source_ref=a.get("attachment_id"), mime_type=a["mime"], file_name=a["filename"], file_size=a.get("size"),
            status=AttachmentStatus.PENDING if a.get("attachment_id") else AttachmentStatus.FAILED,
        ))
    await session.flush()
    if sender_kind == "external":
        await start_clock(session, message, channel_name=mailbox.email_address, department_id=mailbox.department_id,
                          sender_key=email.from_addr, sender_name=email.from_name)
    elif sender_kind == "staff":
        connected_by = await session.get(User, mailbox.connected_by_user_id) if mailbox.connected_by_user_id else None
        who = staff_user or None
        await record_staff_reply(
            session, message,
            answered_by_user_id=who.id if who else None,
            answered_by_name=who.full_name if who else (email.from_name or (connected_by.full_name if connected_by else None)),
        )
    return message


async def sync_mailbox(session: AsyncSession, mailbox: Mailbox) -> int:
    """Pull new messages since the stored historyId. Returns the number of new inbound/outbound emails."""
    token = await access_token(session, mailbox)
    if not mailbox.history_id:
        profile = await _api("GET", "/profile", token)
        mailbox.history_id = str(profile.get("historyId"))
        return 0
    ids: list[str] = []
    latest = mailbox.history_id
    try:
        page = None
        while True:
            params = {"startHistoryId": mailbox.history_id, "historyTypes": "messageAdded", "maxResults": 500}
            if page:
                params["pageToken"] = page
            data = await _api("GET", "/history", token, params)
            for h in data.get("history", []):
                for added in h.get("messagesAdded", []):
                    mid = added["message"]["id"]
                    if mid not in ids:
                        ids.append(mid)
            latest = str(data.get("historyId", latest))
            page = data.get("nextPageToken")
            if not page:
                break
    except GmailError as exc:
        if exc.status != 404:
            raise
        # historyId too old: controlled re-sync of the last day (ingestion is idempotent).
        log.warning("mailbox %s: history expired, re-syncing last day", mailbox.email_address)
        data = await _api("GET", "/messages", token, {"q": "newer_than:1d", "maxResults": 200})
        ids = [m["id"] for m in data.get("messages", [])]
        latest = str((await _api("GET", "/profile", token)).get("historyId", latest))
    parsed: list[ParsedEmail] = []
    for mid in ids:
        if await session.scalar(select(Message.id).where(Message.mailbox_id == mailbox.id, Message.external_id == mid)):
            continue  # already stored (duplicate notification)
        raw = await _api("GET", f"/messages/{mid}", token, {"format": "full"})
        if "DRAFT" not in raw.get("labelIds", []):
            parsed.append(parse_message(raw))
    count = 0
    for email in sorted(parsed, key=lambda e: e.sent_at):  # send order, so replies follow their questions
        if await ingest_email(session, mailbox, email) is not None:
            count += 1
    mailbox.history_id = latest
    mailbox.last_sync_at = utcnow()
    mailbox.status = "connected"
    mailbox.last_error = None
    return count


async def sync_all_mailboxes(sessionmaker: async_sessionmaker[AsyncSession]) -> int:
    from app.workers.queue import enqueue_analysis

    if not is_configured():
        return 0
    async with sessionmaker() as session:
        ids = list((await session.scalars(select(Mailbox.id).where(Mailbox.provider == "gmail", Mailbox.is_enabled.is_(True), Mailbox.status != "disconnected"))).all())
    total = 0
    for mid in ids:
        async with sessionmaker() as session:
            mailbox = await session.get(Mailbox, mid)
            try:
                n = await sync_mailbox(session, mailbox)
                await session.commit()
                total += n
                if n:
                    await enqueue_analysis(mid, kind="email")
            except (GmailError, httpx.HTTPError) as exc:
                await session.rollback()
                mailbox = await session.get(Mailbox, mid)
                mailbox.status = "error"
                mailbox.last_error = str(exc)[:500]
                await session.commit()
                log.warning("gmail sync failed for %s: %s", mailbox.email_address, exc)
    return total


async def download_attachment(session: AsyncSession, attachment: Attachment, message: Message) -> bytes:
    mailbox = await session.get(Mailbox, message.mailbox_id)
    token = await access_token(session, mailbox)
    data = await _api("GET", f"/messages/{message.external_id}/attachments/{attachment.source_ref}", token)
    return _b64(data.get("data", ""))
