import uuid

from app.core.rbac import Actor
from app.domain.enums import Priority, TaskCategory, TaskStatus
from app.models import Task, TelegramUser, User
from app.services.ingest import ingest_update
from app.services.tasks import create_task
from app.telegram.actions import keyboard_for

AGENT_TG, LEAD_TG, STRANGER_TG = 7001, 7002, 7999


async def setup(db, org) -> int:
    """Link eld_agent and eld_lead to Telegram; create a task assigned to the agent."""
    async with db() as s:
        for key, tg_id in (("eld_agent", AGENT_TG), ("eld_lead", LEAD_TG)):
            tg = TelegramUser(id=uuid.uuid4(), company_id=org.company.id, tg_user_id=tg_id, first_name=key, can_dm=True)
            s.add(tg)
            await s.flush()
            (await s.get(User, org.users[key].id)).telegram_user_id = tg.id
        task = await create_task(
            s, actor=Actor.for_user(org.users["eld_lead"]), title="Fix ELD on 125",
            i18n={"uz": {"title": "125-mashinada ELD ni tuzatish", "summary": None}},
            category=TaskCategory.ELD, priority=Priority.P2,
            department_id=org.depts["ELD"].id, assignee_id=org.users["eld_agent"].id,
        )
        await s.commit()
        return task.number


async def tap(db, tg_id: int, data: str, text: str = "T-1 sizga biriktirildi") -> list[tuple[str, dict]]:
    update = {"update_id": 1, "callback_query": {
        "id": "cb", "from": {"id": tg_id, "first_name": "x", "language_code": "uz"}, "data": data,
        "message": {"message_id": 55, "chat": {"id": tg_id, "type": "private"}, "text": text}}}
    async with db() as s:
        result = await ingest_update(s, update)
        await s.commit()
    assert result.action == "button"
    return result.telegram_calls


async def status_of(db, number: int) -> Task:
    from sqlalchemy import select

    async with db() as s:
        return await s.scalar(select(Task).where(Task.number == number))


def labels(markup) -> list[str]:
    return [b["text"] for row in (markup or {}).get("inline_keyboard", []) for b in row]


async def test_full_flow_start_done_confirm(db, org):
    n = await setup(db, org)

    calls = await tap(db, AGENT_TG, f"t:{n}:start")
    assert (await status_of(db, n)).status == TaskStatus.IN_PROGRESS
    answer = dict(calls)["answerCallbackQuery"]
    assert "Ishda" in answer["text"]
    edit = dict(calls)["editMessageText"]
    assert edit["text"].endswith("▸ 🔧 Ishda · Javlon ELD Agent") or "▸ 🔧 Ishda" in edit["text"]
    assert labels(edit["reply_markup"]) == ["✓ Bajardim", "⏸ Muammo bor"]

    calls = await tap(db, AGENT_TG, f"t:{n}:done", text=edit["text"])
    assert (await status_of(db, n)).status == TaskStatus.PENDING_VERIFICATION
    edit = dict(calls)["editMessageText"]
    assert edit["text"].count("▸ ") == 1  # status line replaced, not stacked
    assert labels(edit["reply_markup"]) == []  # the agent cannot confirm their own work

    calls = await tap(db, AGENT_TG, f"t:{n}:confirm")  # forged tap: still refused (four-eyes)
    assert dict(calls)["answerCallbackQuery"]["show_alert"] is True
    assert (await status_of(db, n)).status == TaskStatus.PENDING_VERIFICATION

    await tap(db, LEAD_TG, f"t:{n}:confirm")
    task = await status_of(db, n)
    assert task.status == TaskStatus.COMPLETED and task.verified_by_id == org.users["eld_lead"].id


async def test_send_back_uses_default_reason(db, org):
    n = await setup(db, org)
    await tap(db, AGENT_TG, f"t:{n}:done")
    await tap(db, LEAD_TG, f"t:{n}:back")
    task = await status_of(db, n)
    assert task.status == TaskStatus.IN_PROGRESS


async def test_stuck_two_step_then_continue(db, org):
    n = await setup(db, org)
    calls = await tap(db, AGENT_TG, f"t:{n}:stuck")
    markup = dict(calls)["editMessageReplyMarkup"]["reply_markup"]
    assert labels(markup)[:3] == ["Ehtiyot qism kutilmoqda", "Haydovchidan javob kutilmoqda", "Pul yoki ruxsat kutilmoqda"]
    assert (await status_of(db, n)).status == TaskStatus.ASSIGNED  # nothing changed yet

    calls = await tap(db, AGENT_TG, f"t:{n}:stuck2")
    task = await status_of(db, n)
    assert task.status == TaskStatus.BLOCKED and task.blocked_reason == "Haydovchidan javob kutilmoqda"
    assert labels(dict(calls)["editMessageText"]["reply_markup"]) == ["▶ Davom ettirish"]

    await tap(db, AGENT_TG, f"t:{n}:resume")
    assert (await status_of(db, n)).status == TaskStatus.IN_PROGRESS


async def test_unlinked_and_stale_taps_are_refused(db, org):
    n = await setup(db, org)
    calls = await tap(db, STRANGER_TG, f"t:{n}:start")
    assert "ulang" in dict(calls)["answerCallbackQuery"]["text"] and dict(calls)["answerCallbackQuery"]["show_alert"]
    await tap(db, AGENT_TG, f"t:{n}:start")
    calls = await tap(db, AGENT_TG, f"t:{n}:start")  # old button pressed again
    assert dict(calls)["answerCallbackQuery"]["show_alert"] is True
    calls = await tap(db, AGENT_TG, "t:9999:start")
    assert dict(calls)["answerCallbackQuery"]["show_alert"] is True
    calls = await tap(db, AGENT_TG, "garbage")
    assert dict(calls)["answerCallbackQuery"]["text"] == "?"


async def test_other_users_task_cannot_be_started(db, org):
    n = await setup(db, org)
    async with db() as s:
        tg = TelegramUser(id=uuid.uuid4(), company_id=org.company.id, tg_user_id=7003, first_name="a2", can_dm=True)
        s.add(tg)
        await s.flush()
        (await s.get(User, org.users["eld_agent2"].id)).telegram_user_id = tg.id
        await s.commit()
    calls = await tap(db, 7003, f"t:{n}:start")
    assert dict(calls)["answerCallbackQuery"]["show_alert"] is True
    assert (await status_of(db, n)).status == TaskStatus.ASSIGNED


async def test_mytasks_lists_tasks_with_buttons(db, org):
    n = await setup(db, org)
    msg = {"update_id": 2, "message": {"message_id": 9, "date": 0, "chat": {"id": AGENT_TG, "type": "private"},
           "from": {"id": AGENT_TG, "first_name": "J", "language_code": "uz"}, "text": "/mytasks"}}
    async with db() as s:
        result = await ingest_update(s, msg)
    sends = [p for m, p in result.telegram_calls if m == "sendMessage"]
    assert sends[0]["text"] == "Sizning vazifalaringiz (1):"
    assert f"T-{n}" in sends[1]["text"] and "125-mashinada ELD ni tuzatish" in sends[1]["text"]
    assert labels(sends[1]["reply_markup"]) == ["▶ Boshlash", "✓ Bajardim", "⏸ Muammo bor"]

    # The lead sees work waiting for confirmation.
    await tap(db, AGENT_TG, f"t:{n}:done")
    msg["message"]["from"]["id"] = msg["message"]["chat"]["id"] = LEAD_TG
    async with db() as s:
        result = await ingest_update(s, msg)
    sends = [p for m, p in result.telegram_calls if m == "sendMessage"]
    assert labels(sends[1]["reply_markup"]) == ["✓ Tasdiqlash", "↩ Qaytarish"]


async def test_mytasks_not_linked(db, org):
    msg = {"update_id": 3, "message": {"message_id": 9, "date": 0, "chat": {"id": 1, "type": "private"},
           "from": {"id": 1, "first_name": "J", "language_code": "ru"}, "text": "/mytasks"}}
    async with db() as s:
        result = await ingest_update(s, msg)
    assert result.telegram_calls[0][1]["text"].startswith("Сначала привяжите")


async def test_keyboard_respects_language(db, org):
    n = await setup(db, org)
    async with db() as s:
        from sqlalchemy import select

        task = await s.scalar(select(Task).where(Task.number == n))
        markup = keyboard_for(task, Actor.for_user(org.users["eld_agent"]), "ru")
    assert labels(markup) == ["▶ Начать", "✓ Сделал", "⏸ Есть проблема"]
