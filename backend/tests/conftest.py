import os

os.environ.update(
    {
        "ENV": "test",
        "TASK_QUEUE": "inline",
        "AI_ENABLED": "false",
        "TELEGRAM_BOT_TOKEN": "",
        "TELEGRAM_WEBHOOK_SECRET": "test-secret",
        "TELEGRAM_BOT_USERNAME": "smart_truck_test_bot",
        "JWT_SECRET": "test-jwt-secret-with-enough-length-123",
    }
)

import functools  # noqa: E402
import uuid  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.ai.extractor import ExtractionResponse, set_extractor  # noqa: E402
from app.ai.prompts import ExtractionRequest  # noqa: E402
from app.ai.schemas import ExtractionResult  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db import init_engine, session_factory  # noqa: E402
from app.domain.enums import GroupKind, Role  # noqa: E402
from app.models import Base, Company, Department, TelegramGroup, Truck, User, utcnow  # noqa: E402

PASSWORD = "password123"


@functools.cache
def _password_hash() -> str:
    return hash_password(PASSWORD)  # bcrypt is deliberately slow; hash once per test session


@dataclass
class Org:
    company: Company
    depts: dict[str, Department]
    users: dict[str, User]
    trucks: dict[str, Truck]
    groups: dict[str, TelegramGroup] = field(default_factory=dict)


@pytest.fixture(autouse=True)
def _reset_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
    set_extractor(None)


@pytest.fixture
async def db():
    engine = init_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield session_factory()
    await engine.dispose()


@pytest.fixture
async def org(db) -> Org:
    async with db() as s:
        company = Company(id=uuid.uuid4(), name="Test Trucking", timezone="America/Chicago", settings={"four_eyes": True})
        s.add(company)
        await s.flush()
        depts = {}
        for code in ("ELD", "DISPATCH", "FLEET", "ACCOUNTING", "SAFETY", "HR"):
            depts[code] = Department(id=uuid.uuid4(), company_id=company.id, code=code, name=code.title())
            s.add(depts[code])
        await s.flush()
        pw = _password_hash()

        def mk(key, role, dept=None):
            return User(
                id=uuid.uuid4(),
                company_id=company.id,
                email=f"{key}@test-trucking.com",
                full_name=key.replace("_", " ").title(),
                password_hash=pw,
                role=role,
                department_id=depts[dept].id if dept else None,
            )

        users = {
            "owner": mk("owner", Role.OWNER),
            "manager": mk("manager", Role.MANAGER),
            "eld_lead": mk("eld_lead", Role.DEPT_LEAD, "ELD"),
            "eld_agent": mk("eld_agent", Role.AGENT, "ELD"),
            "eld_agent2": mk("eld_agent2", Role.AGENT, "ELD"),
            "acct_lead": mk("acct_lead", Role.DEPT_LEAD, "ACCOUNTING"),
            "acct_agent": mk("acct_agent", Role.AGENT, "ACCOUNTING"),
            "viewer": mk("viewer", Role.VIEWER),
        }
        s.add_all(users.values())
        await s.flush()
        depts["ELD"].lead_user_id = users["eld_lead"].id
        depts["ELD"].default_assignee_user_id = users["eld_agent"].id
        depts["ACCOUNTING"].lead_user_id = users["acct_lead"].id

        trucks = {}
        for unit in ("125", "126", "127", "112"):
            trucks[unit] = Truck(id=uuid.uuid4(), company_id=company.id, unit_number=unit)
            s.add(trucks[unit])
        await s.flush()

        groups = {
            "t125": TelegramGroup(
                id=uuid.uuid4(), company_id=company.id, tg_chat_id=-100125, title="Truck 125",
                chat_type="supergroup", kind=GroupKind.TRUCK, truck_id=trucks["125"].id, is_enabled=True,
            ),
            "dispatch": TelegramGroup(
                id=uuid.uuid4(), company_id=company.id, tg_chat_id=-100900, title="Dispatch Team",
                chat_type="supergroup", kind=GroupKind.DISPATCH, department_id=depts["DISPATCH"].id, is_enabled=True,
            ),
            "disabled": TelegramGroup(
                id=uuid.uuid4(), company_id=company.id, tg_chat_id=-100999, title="Not yet allowed",
                chat_type="supergroup", kind=GroupKind.OTHER, is_enabled=False,
            ),
        }
        s.add_all(groups.values())
        await s.commit()
        return Org(company=company, depts=depts, users=users, trucks=trucks, groups=groups)


@pytest.fixture
async def client(db):
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def auth_headers(client: httpx.AsyncClient, key: str) -> dict[str, str]:
    resp = await client.post("/api/auth/login", json={"email": f"{key}@test-trucking.com", "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# --------------------------------------------------------------------------- telegram update builders

_counter = {"id": 1}


def tg_message(chat_id: int, text: str | None = None, *, user_id: int = 5001, first_name: str = "Aziz",
               message_id: int | None = None, reply_to: int | None = None, **extra) -> dict:
    if message_id is None:
        _counter["id"] += 1
        message_id = _counter["id"]
    msg = {
        "message_id": message_id,
        "date": int(utcnow().timestamp()),
        "chat": {"id": chat_id, "type": "supergroup", "title": f"chat {chat_id}"},
        "from": {"id": user_id, "is_bot": False, "first_name": first_name},
        **extra,
    }
    if text is not None:
        msg["text"] = text
    if reply_to:
        msg["reply_to_message"] = {"message_id": reply_to}
    return {"update_id": message_id, "message": msg}


# --------------------------------------------------------------------------- fake LLM


class FakeExtractor:
    """Returns whatever `responder(request)` builds; records every request."""

    model = "fake-model"

    def __init__(self, responder):
        self.responder = responder
        self.requests: list[ExtractionRequest] = []

    async def extract(self, request: ExtractionRequest) -> ExtractionResponse:
        self.requests.append(request)
        out = self.responder(request)
        if isinstance(out, ExtractionResponse):
            return out
        return ExtractionResponse(status="ok", model=self.model, result=ExtractionResult.model_validate(out))
