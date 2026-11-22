from datetime import timedelta

import pytest
from sqlalchemy import select

from app.ai.extractor import ExtractionResponse, set_extractor
from app.config import get_settings
from app.core.rbac import Actor
from app.domain.enums import (
    AnalysisStatus,
    Priority,
    TaskCategory,
    TaskEventType,
    TaskMessageRelation,
    TaskSource,
    TaskStatus,
)
from app.models import AIExtraction, Message, Task, TaskEvent, TaskMessage, utcnow
from app.services.analysis import acquire_lease, analyze_group, run_group_analysis
from app.services.ingest import ingest_update
from app.services.tasks import create_task, transition_task
from tests.conftest import FakeExtractor, tg_message


def new_task(refs=("m1",), **over):
    base = {
        "source_refs": list(refs),
        "title": "Fix ELD not connecting on truck 125",
        "summary": "Driver reports the ELD is not working.",
        "title_uz": "125-mashinada ELD ulanishini tuzatish",
        "summary_uz": "Haydovchi ELD ishlamayotganini aytmoqda.",
        "title_ru": "Починить подключение ELD на траке 125",
        "summary_ru": "Водитель сообщает, что ELD не работает.",
        "category": "eld",
        "issue_type": "eld_error",
        "priority": "P2",
        "truck_unit": "125",
        "trailer_ref": None,
        "load_reference": None,
        "driver_name": None,
        "amount": None,
        "deadline_iso": None,
        "assignee_hint": None,
        "why_task": "Equipment failure blocks compliant driving.",
        "confidence": 0.9,
    }
    base.update(over)
    return base


def result(new_tasks=(), updates=(), labels=()):
    return {"message_labels": list(labels), "new_tasks": list(new_tasks), "task_updates": list(updates)}


async def say(db, chat_id, text, **kw):
    async with db() as s:
        r = await ingest_update(s, tg_message(chat_id, text, **kw))
        await s.commit()
        return r


async def analyze(db, group_id, fake, *, after_seconds=120, force=False):
    async with db() as s:
        outcome = await analyze_group(s, group_id, extractor=fake, now=utcnow() + timedelta(seconds=after_seconds), force=force)
        await s.commit()
        return outcome


async def tasks(db):
    async with db() as s:
        return list((await s.scalars(select(Task).order_by(Task.number))).all())


async def existing_task(db, org, status=TaskStatus.ASSIGNED, **kw):
    async with db() as s:
        t = await create_task(
            s,
            actor=Actor.for_user(org.users["manager"]),
            title=kw.pop("title", "Fix ELD not connecting on truck 125"),
            category=kw.pop("category", TaskCategory.ELD),
            priority=Priority.P2,
            department_id=org.depts["ELD"].id,
            truck_id=org.trucks["125"].id,
            assignee_id=org.users["eld_agent"].id,
            group_id=org.groups["t125"].id,
            **kw,
        )
        if status == TaskStatus.IN_PROGRESS:
            await transition_task(s, t, status, Actor.for_user(org.users["eld_agent"]))
        await s.commit()
        return t


# --------------------------------------------------------------------------- windowing


async def test_debounce_waits_for_quiet_chat(db, org):
    await say(db, -100125, "Aka ELD ishlamayapti")
    fake = FakeExtractor(lambda req: result())
    early = await analyze(db, org.groups["t125"].id, fake, after_seconds=10)
    assert early.status == "waiting" and early.retry_after_seconds
    assert fake.requests == []
    later = await analyze(db, org.groups["t125"].id, fake, after_seconds=120)
    assert later.status == "ok" and len(fake.requests) == 1


async def test_max_wait_forces_busy_chat(db, org):
    await say(db, -100125, "first")
    async with db() as s:
        m = await s.scalar(select(Message))
        m.created_at = utcnow() - timedelta(seconds=400)
        await s.commit()
    await say(db, -100125, "still talking")
    fake = FakeExtractor(lambda req: result())
    outcome = await analyze(db, org.groups["t125"].id, fake, after_seconds=5)
    assert outcome.status == "ok"
    assert [m.is_new for m in fake.requests[0].messages] == [True, True]


async def test_ai_disabled_keeps_messages_pending(db, org):
    await say(db, -100125, "Aka ELD ishlamayapti")
    async with db() as s:
        outcome = await analyze_group(s, org.groups["t125"].id, extractor=None, force=True)
        msg = await s.scalar(select(Message))
    assert outcome.status == "ai_off" and msg.analysis_status == AnalysisStatus.PENDING


# --------------------------------------------------------------------------- new tasks


async def test_creates_task_for_review_with_routing(db, org):
    await say(db, -100125, "Aka ELD ishlamayapti")
    fake = FakeExtractor(lambda req: result([new_task()]))
    outcome = await analyze(db, org.groups["t125"].id, fake)
    assert outcome.tasks_created == ["T-1"]

    [task] = await tasks(db)
    assert task.status == TaskStatus.NEEDS_REVIEW  # auto-assign is off in the pilot [B5]
    assert task.source == TaskSource.AI and task.confidence == 0.9
    assert task.department_id == org.depts["ELD"].id
    assert task.truck_id == org.trucks["125"].id
    assert "ELD ishlamayapti" in task.source_text
    assert task.i18n["uz"]["title"] == "125-mashinada ELD ulanishini tuzatish"
    assert task.i18n["ru"]["summary"] == "Водитель сообщает, что ELD не работает."
    assert task.due_at is not None  # SLA applied

    async with db() as s:
        events = (await s.scalars(select(TaskEvent).where(TaskEvent.task_id == task.id).order_by(TaskEvent.created_at))).all()
        links = (await s.scalars(select(TaskMessage).where(TaskMessage.task_id == task.id))).all()
        extraction = await s.scalar(select(AIExtraction))
        msg = await s.scalar(select(Message))
    assert [e.type for e in events] == [TaskEventType.CREATED, TaskEventType.STATUS_CHANGED]
    assert events[0].actor_kind == "ai" and events[0].data["why"]
    assert [link.relation for link in links] == [TaskMessageRelation.SOURCE]
    assert extraction.status == "ok" and extraction.tasks_created == 1 and extraction.raw_output
    assert msg.analysis_status == AnalysisStatus.DONE


async def test_low_confidence_dropped_but_logged(db, org):
    await say(db, -100125, "ok aka")
    fake = FakeExtractor(lambda req: result([new_task(confidence=0.3)]))
    outcome = await analyze(db, org.groups["t125"].id, fake)
    assert outcome.tasks_created == [] and await tasks(db) == []
    async with db() as s:
        extraction = await s.scalar(select(AIExtraction))
    assert extraction.raw_output["new_tasks"][0]["confidence"] == 0.3


async def test_context_messages_cannot_create_tasks(db, org):
    await say(db, -100125, "ELD ishlamayapti")
    await analyze(db, org.groups["t125"].id, FakeExtractor(lambda req: result()))
    await say(db, -100125, "rahmat")
    fake = FakeExtractor(lambda req: result([new_task(refs=["m1"])]))  # m1 is the old (context) message
    await analyze(db, org.groups["t125"].id, fake)
    assert [m.is_new for m in fake.requests[0].messages] == [False, True]
    assert await tasks(db) == []


async def test_unknown_truck_number_kept_raw(db, org):
    await say(db, -100900, "Truck 999 lumper chek kerak")
    fake = FakeExtractor(lambda req: result([new_task(title="Reimburse lumper for truck 999", category="accounting", truck_unit="999")]))
    await analyze(db, org.groups["dispatch"].id, fake)
    [task] = await tasks(db)
    assert task.truck_id is None and task.truck_unit_raw == "999"
    assert task.department_id == org.depts["ACCOUNTING"].id
    assert fake.requests[0].truck_hints == ["999"]


async def test_dedupe_backstop_links_instead_of_creating(db, org):
    existing = await existing_task(db, org)
    await say(db, -100125, "Aka ELD hali ham ishlamayapti")
    fake = FakeExtractor(lambda req: result([new_task(title="Fix ELD connection on truck 125")]))
    outcome = await analyze(db, org.groups["t125"].id, fake)
    assert outcome.tasks_created == [] and outcome.duplicates_linked == 1
    assert len(await tasks(db)) == 1
    async with db() as s:
        link = await s.scalar(select(TaskMessage).where(TaskMessage.task_id == existing.id))
    assert link.relation == TaskMessageRelation.DUPLICATE


async def test_open_tasks_are_sent_as_context(db, org):
    existing = await existing_task(db, org)
    await say(db, -100125, "hello")
    fake = FakeExtractor(lambda req: result())
    await analyze(db, org.groups["t125"].id, fake)
    req = fake.requests[0]
    assert [t.code for t in req.open_tasks] == [existing.code]
    assert req.default_truck_unit == "125" and req.chat_kind == "truck"


async def test_auto_assign_when_enabled(db, org, monkeypatch):
    monkeypatch.setenv("AUTO_ASSIGN_ENABLED", "true")
    get_settings.cache_clear()
    await say(db, -100125, "Aka ELD ishlamayapti")
    await analyze(db, org.groups["t125"].id, FakeExtractor(lambda req: result([new_task(confidence=0.95)])))
    [task] = await tasks(db)
    assert task.status == TaskStatus.ASSIGNED and task.assignee_id == org.users["eld_agent"].id


# --------------------------------------------------------------------------- updates to existing tasks


async def test_completion_claim_moves_to_pending_verification_only(db, org):
    existing = await existing_task(db, org, status=TaskStatus.IN_PROGRESS)
    await say(db, -100125, "ELD tuzatdim, ishlayapti")
    update = {"task_code": existing.code, "source_refs": ["m1"], "kind": "completion_claim",
              "note": "Driver says ELD is fixed", "confidence": 0.9}
    outcome = await analyze(db, org.groups["t125"].id, FakeExtractor(lambda req: result(updates=[update])))
    assert outcome.updates_applied == 1
    [task] = await tasks(db)
    assert task.status == TaskStatus.PENDING_VERIFICATION  # never COMPLETED by the AI [B3, B9]


async def test_blocker_update_blocks_task_with_reason(db, org):
    existing = await existing_task(db, org, status=TaskStatus.IN_PROGRESS)
    await say(db, -100125, "Zapchast kelmadi hali, kutyapmiz")
    update = {"task_code": existing.code, "source_refs": ["m1"], "kind": "blocker",
              "note": "Waiting for a replacement part", "confidence": 0.8}
    await analyze(db, org.groups["t125"].id, FakeExtractor(lambda req: result(updates=[update])))
    [task] = await tasks(db)
    assert task.status == TaskStatus.BLOCKED and task.blocked_reason == "Waiting for a replacement part"


async def test_update_for_unknown_or_closed_task_ignored(db, org):
    await say(db, -100125, "done")
    update = {"task_code": "T-404", "source_refs": ["m1"], "kind": "completion_claim", "note": "x", "confidence": 0.9}
    outcome = await analyze(db, org.groups["t125"].id, FakeExtractor(lambda req: result(updates=[update])))
    assert outcome.updates_applied == 0


# --------------------------------------------------------------------------- failures


async def test_refusal_hands_window_to_humans(db, org):
    await say(db, -100125, "something")
    fake = FakeExtractor(lambda req: ExtractionResponse(status="refusal", model="fake", error="refusal: cyber"))
    outcome = await analyze(db, org.groups["t125"].id, fake)
    assert outcome.status == "refusal"
    async with db() as s:
        msg = await s.scalar(select(Message))
        extraction = await s.scalar(select(AIExtraction))
    assert msg.analysis_status == AnalysisStatus.FAILED
    assert extraction.status == "refusal"


async def test_retryable_error_keeps_messages_pending(db, org):
    await say(db, -100125, "something")
    fake = FakeExtractor(lambda req: ExtractionResponse(status="error", model="fake", error="rate_limited", retryable=True))
    await analyze(db, org.groups["t125"].id, fake)
    async with db() as s:
        msg = await s.scalar(select(Message))
    assert msg.analysis_status == AnalysisStatus.PENDING


async def test_lease_prevents_concurrent_analysis(db, org):
    await say(db, -100125, "something")
    async with db() as s:
        assert await acquire_lease(s, org.groups["t125"].id, utcnow())
        await s.commit()
    fake = FakeExtractor(lambda req: result())
    outcome = await run_group_analysis(db, org.groups["t125"].id, extractor=fake, force=True)
    assert outcome.status == "locked" and fake.requests == []


async def test_run_group_analysis_releases_lease(db, org, monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    get_settings.cache_clear()
    await say(db, -100125, "something")
    set_extractor(FakeExtractor(lambda req: result()))
    first = await run_group_analysis(db, org.groups["t125"].id, force=True)
    assert first.status == "ok"
    await say(db, -100125, "more")
    second = await run_group_analysis(db, org.groups["t125"].id, force=True)
    assert second.status == "ok"


@pytest.mark.parametrize("bad", ["T-x", "", "12a"])
async def test_malformed_task_codes_ignored(db, org, bad):
    await say(db, -100125, "x")
    update = {"task_code": bad, "source_refs": ["m1"], "kind": "progress", "note": "x", "confidence": 0.9}
    outcome = await analyze(db, org.groups["t125"].id, FakeExtractor(lambda req: result(updates=[update])))
    assert outcome.updates_applied == 0


# --------------------------------------------------------------------------- photos / PDFs


async def _photo_message(db, org, tmp_path, monkeypatch, *, downloaded: bool):
    from app.domain.enums import AttachmentStatus
    from app.models import Attachment
    from app.services.storage import get_storage

    monkeypatch.setenv("STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    upd = tg_message(-100125, None, caption="POD", photo=[{"file_id": "P1", "file_unique_id": "UP1", "width": 800, "height": 600, "file_size": 1000}])
    async with db() as s:
        r = await ingest_update(s, upd)
        await s.commit()
    if downloaded:
        async with db() as s:
            att = await s.scalar(select(Attachment))
            att.storage_key = get_storage().save("x/p1.jpg", b"\xff\xd8\xff fake jpeg")
            att.status = AttachmentStatus.DOWNLOADED
            await s.commit()
    return r


async def test_downloaded_photo_is_sent_to_model(db, org, tmp_path, monkeypatch):
    await _photo_message(db, org, tmp_path, monkeypatch, downloaded=True)
    fake = FakeExtractor(lambda req: result())
    await analyze(db, org.groups["t125"].id, fake)
    [att] = fake.requests[0].attachments
    assert att.ref == "m1" and att.media_type == "image/jpeg" and att.data_b64


async def test_analysis_waits_for_photo_download(db, org, tmp_path, monkeypatch):
    await _photo_message(db, org, tmp_path, monkeypatch, downloaded=False)
    fake = FakeExtractor(lambda req: result())
    outcome = await analyze(db, org.groups["t125"].id, fake, after_seconds=100)
    assert outcome.status == "waiting" and fake.requests == []
