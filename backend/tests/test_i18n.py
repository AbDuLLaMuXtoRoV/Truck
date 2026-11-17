from sqlalchemy import select

from app.core.rbac import Actor
from app.domain.enums import GroupKind, NotificationChannel, TaskCategory
from app.i18n import group_text, norm_lang, t
from app.models import Notification, TelegramGroup, User
from app.services.ingest import ingest_update
from app.services.tasks import create_task
from tests.conftest import auth_headers, tg_message


def test_language_normalisation_and_fallback():
    assert norm_lang("ru-RU") == "ru" and norm_lang("uz") == "uz" and norm_lang("en-GB") == "en"
    assert norm_lang("de") == "uz" and norm_lang(None) == "uz"  # company default
    assert t("bot.hello", "ru").startswith("Здравствуйте")


def test_group_texts_are_trilingual():
    text = group_text("task_ack", code="T-7")
    assert text.count("T-7") == 3 and "ko‘rib" in text and "проверку" in text and "review" in text


async def test_notifications_follow_recipient_language(db, org):
    async with db() as s:
        agent = await s.get(User, org.users["eld_agent"].id)
        agent.language = "ru"
        await s.commit()
    async with db() as s:
        await create_task(
            s, actor=Actor.for_user(org.users["manager"]), title="Fix ELD on 125",
            i18n={"ru": {"title": "Починить ELD на 125", "summary": None}},
            category=TaskCategory.ELD, department_id=org.depts["ELD"].id, assignee_id=org.users["eld_agent"].id,
        )
        await s.commit()
        n = await s.scalar(select(Notification).where(Notification.channel == NotificationChannel.DASHBOARD))
    assert n.title == "T-1 назначена вам: Починить ELD на 125"
    assert n.body.startswith("Приоритет P3, срок ")


async def test_patch_me_language(client, org):
    h = await auth_headers(client, "eld_agent")
    assert (await client.get("/api/auth/me", headers=h)).json()["language"] == "uz"
    resp = await client.patch("/api/me", json={"language": "ru"}, headers=h)
    assert resp.status_code == 200 and resp.json()["language"] == "ru"
    assert (await client.patch("/api/me", json={"language": "de"}, headers=h)).status_code == 422
    assert (await client.patch("/api/me", json={"language": None}, headers=h)).status_code == 422


async def test_private_start_replies_in_users_language(db, org):
    update = {"update_id": 1, "message": {"message_id": 1, "date": 0, "chat": {"id": 5, "type": "private"},
              "from": {"id": 5, "first_name": "Ivan", "language_code": "ru"}, "text": "/start"}}
    async with db() as s:
        result = await ingest_update(s, update)
    assert result.replies[0].text.startswith("Здравствуйте")


async def test_new_group_is_auto_mapped_but_stays_disabled(db, org):
    async with db() as s:
        r1 = await ingest_update(s, tg_message(-100700, "salom"))
        await s.commit()
    # tg_message() titles chats "chat <id>", so craft the titles explicitly:
    cases = {-100701: "Truck 126 – Bekzod", -100702: "Dispatch Team 2", -100703: "Buxgalteriya", -100704: "Random chat"}
    for chat_id, title in cases.items():
        upd = tg_message(chat_id, "salom")
        upd["message"]["chat"]["title"] = title
        async with db() as s:
            res = await ingest_update(s, upd)
            await s.commit()
        assert res.action == "group_pending" and "Smart Truck" in res.replies[0].text
    async with db() as s:
        groups = {g.tg_chat_id: g for g in (await s.scalars(select(TelegramGroup))).all()}
    assert groups[-100701].kind == GroupKind.TRUCK and groups[-100701].truck_id == org.trucks["126"].id
    assert groups[-100702].kind == GroupKind.DISPATCH and groups[-100702].department_id == org.depts["DISPATCH"].id
    assert groups[-100703].kind == GroupKind.DEPARTMENT and groups[-100703].department_id == org.depts["ACCOUNTING"].id
    assert groups[-100704].kind == GroupKind.OTHER
    assert not any(g.is_enabled for cid, g in groups.items() if cid in cases)
    assert r1.action == "group_pending"
