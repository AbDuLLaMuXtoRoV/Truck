import uuid
from datetime import timedelta

from sqlalchemy import func, select

from app.domain.enums import NotificationChannel
from app.models import Message, Notification, ResponseClock, ResponseEscalation, TelegramGroup, TelegramUser, User, utcnow
from app.services.ingest import ingest_update
from app.services.response import close_not_needed, needs_no_reply, run_response_checks
from tests.conftest import tg_message

DRIVER_A, DRIVER_B, STAFF_TG, BOT_TG = 5101, 5102, 5201, 5301


async def setup(db, org):
    """Truck 125 group belongs to ELD; eld_agent's Telegram account is linked (staff)."""
    async with db() as s:
        (await s.get(TelegramGroup, org.groups["t125"].id)).department_id = org.depts["ELD"].id
        tg = TelegramUser(id=uuid.uuid4(), company_id=org.company.id, tg_user_id=STAFF_TG, first_name="Javlon")
        s.add(tg)
        await s.flush()
        (await s.get(User, org.users["eld_agent"].id)).telegram_user_id = tg.id
        await s.commit()


async def say(db, text, user_id, *, reply_to=None, is_bot=False, **extra):
    upd = tg_message(-100125, text, user_id=user_id, reply_to=reply_to, **extra)
    upd["message"]["from"]["is_bot"] = is_bot
    async with db() as s:
        r = await ingest_update(s, upd)
        await s.commit()
    return r


async def clocks(db):
    async with db() as s:
        return list((await s.scalars(select(ResponseClock).order_by(ResponseClock.started_at))).all())


async def notified(db, kind):
    async with db() as s:
        rows = (await s.scalars(select(Notification).where(Notification.kind == kind,
                                                           Notification.channel == NotificationChannel.DASHBOARD))).all()
        return {r.user_id for r in rows}


def test_needs_no_reply_rules():
    for text in ("ok", "Rahmat aka", "спасибо!", "👍", "+", "Понял."):
        assert needs_no_reply(text, "text"), text
    assert needs_no_reply(None, "sticker")
    assert not needs_no_reply("125 ELD ishlamayapti", "text")
    assert not needs_no_reply(None, "photo")  # a photo without a caption still needs a look


async def test_driver_message_starts_clock_and_staff_reply_stops_it(db, org):
    await setup(db, org)
    await say(db, "Aka 125 ELD ishlamayapti", DRIVER_A, first_name="Aziz")
    [clock] = await clocks(db)
    assert clock.status == "pending" and clock.sender_name == "Aziz"
    assert clock.due_at - clock.started_at == timedelta(minutes=5)
    assert clock.department_id == org.depts["ELD"].id and clock.channel == "telegram"

    await say(db, "rahmat", DRIVER_A)  # an acknowledgement does not start a new clock
    assert len(await clocks(db)) == 1

    await say(db, "Hozir ko'raman", STAFF_TG, first_name="Javlon")
    [clock] = await clocks(db)
    assert clock.status == "answered" and clock.answered_by_name == "Eld Agent"  # portal name of the linked user
    assert clock.answered_by_user_id == org.users["eld_agent"].id
    assert clock.response_seconds is not None and clock.response_seconds >= 0
    async with db() as s:
        staff_msg = await s.scalar(select(Message).where(Message.sender_kind == "staff"))
    assert staff_msg.direction == "outbound"


async def test_reply_to_one_driver_does_not_answer_another(db, org):
    await setup(db, org)
    first = await say(db, "Trailer 1192 bo'sh, qayerga qo'yay?", DRIVER_A)
    await say(db, "Lumper 150$ to'ladim", DRIVER_B)
    async with db() as s:
        a_msg = await s.get(Message, first.message_id)
    await say(db, "Yard 3 ga qo'ying", STAFF_TG, reply_to=a_msg.tg_message_id)
    by_sender = {c.sender_key: c.status for c in await clocks(db)}
    assert by_sender == {str(DRIVER_A): "answered", str(DRIVER_B): "pending"}


async def test_bot_and_unlinked_people_do_not_stop_the_clock(db, org):
    await setup(db, org)
    await say(db, "ELD down", DRIVER_A)
    await say(db, "Auto: your message was received", BOT_TG, is_bot=True)
    await say(db, "I'm also a driver", DRIVER_B)
    assert [c.status for c in await clocks(db)] == ["pending", "pending"]


async def test_roster_flag_makes_telegram_user_staff(db, org):
    await setup(db, org)
    await say(db, "POD yubordim", DRIVER_A)
    async with db() as s:
        tg = TelegramUser(id=uuid.uuid4(), company_id=org.company.id, tg_user_id=5999, first_name="Night", is_staff=True)
        s.add(tg)
        await s.commit()
    await say(db, "Qabul qildim", 5999, first_name="Night")
    [clock] = await clocks(db)
    assert clock.status == "answered" and clock.answered_by_user_id is None and clock.answered_by_name


async def test_escalation_ladder_3_5_10(db, org):
    await setup(db, org)
    await say(db, "125 tormoz yomon", DRIVER_A)
    async with db() as s:
        assert await run_response_checks(s, utcnow() + timedelta(seconds=60)) == {"reminders": 0, "overdue": 0, "escalated": 0}
        assert (await run_response_checks(s, utcnow() + timedelta(seconds=185)))["reminders"] == 1
        assert (await run_response_checks(s, utcnow() + timedelta(seconds=190)))["reminders"] == 0  # idempotent
        assert (await run_response_checks(s, utcnow() + timedelta(seconds=305)))["overdue"] == 1
        assert (await run_response_checks(s, utcnow() + timedelta(seconds=605)))["escalated"] == 1
        await s.commit()
    eld = {org.users["eld_agent"].id, org.users["eld_agent2"].id, org.users["eld_lead"].id}
    assert await notified(db, "response_reminder") == eld  # the ELD team (nobody on shift -> whole team)
    assert await notified(db, "response_overdue") == {org.users["eld_lead"].id}  # supervisor
    assert await notified(db, "response_escalated") == {org.users["manager"].id, org.users["owner"].id}
    async with db() as s:
        levels = sorted(e.level for e in (await s.scalars(select(ResponseEscalation))).all())
    assert levels == [1, 2, 3]


async def test_late_check_jumps_to_highest_level_once(db, org):
    await setup(db, org)
    await say(db, "Reefer temp 50F!", DRIVER_A)
    async with db() as s:
        counts = await run_response_checks(s, utcnow() + timedelta(minutes=11))
        await s.commit()
        assert counts == {"reminders": 0, "overdue": 0, "escalated": 1}
        assert await s.scalar(select(func.count()).select_from(ResponseEscalation)) == 1


async def test_safety_critical_alerts_immediately(db, org):
    await setup(db, org)
    await say(db, "Avariya bo'ldi I-40 da, politsiya keldi", DRIVER_A)
    [clock] = await clocks(db)
    assert clock.critical and clock.level == 2
    recipients = await notified(db, "critical")
    assert {org.users["eld_lead"].id, org.users["manager"].id, org.users["owner"].id} <= recipients


async def test_no_reply_needed_closes_clock(db, org):
    await setup(db, org)
    await say(db, "FYI: I'm at the shipper", DRIVER_A)
    async with db() as s:
        clock = await s.scalar(select(ResponseClock))
        await close_not_needed(s, clock, reason="informational", user_id=org.users["eld_lead"].id)
        await s.commit()
        assert (await run_response_checks(s, utcnow() + timedelta(minutes=20))) == {"reminders": 0, "overdue": 0, "escalated": 0}
    [clock] = await clocks(db)
    assert clock.status == "not_needed" and clock.closed_reason == "informational"


async def test_disabled_group_never_starts_clocks(db, org):
    upd = tg_message(-100999, "hello, need help", user_id=DRIVER_A)
    async with db() as s:
        await ingest_update(s, upd)
        await s.commit()
    assert await clocks(db) == []
