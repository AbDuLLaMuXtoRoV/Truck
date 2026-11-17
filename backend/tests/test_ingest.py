from datetime import timedelta

from sqlalchemy import func, select

from app.domain.enums import AnalysisStatus, AttachmentStatus, MessageKind, TaskSource, TaskStatus, TranscriptStatus
from app.models import Attachment, Message, MessageRevision, Task, TaskMessage, TelegramGroup, TelegramUser, User, utcnow
from app.services.ingest import ingest_update
from tests.conftest import tg_message


async def ingest(db, update):
    async with db() as s:
        result = await ingest_update(s, update)
        await s.commit()
        return result


async def count(db, model, *where):
    async with db() as s:
        return await s.scalar(select(func.count()).select_from(model).where(*where))


async def test_bot_added_to_new_group_creates_disabled_group(db, org):
    update = {
        "update_id": 1,
        "my_chat_member": {
            "chat": {"id": -100777, "type": "supergroup", "title": "Truck 140"},
            "from": {"id": 1, "first_name": "Admin"},
            "date": 0,
            "old_chat_member": {"status": "left", "user": {"id": 42}},
            "new_chat_member": {"status": "member", "user": {"id": 42}},
        },
    }
    result = await ingest(db, update)
    assert result.action == "membership"
    async with db() as s:
        group = await s.scalar(select(TelegramGroup).where(TelegramGroup.tg_chat_id == -100777))
    assert group is not None and group.is_enabled is False and group.title == "Truck 140"


async def test_messages_from_unknown_or_disabled_groups_are_not_stored(db, org):
    r1 = await ingest(db, tg_message(-100555, "hello from a brand new group"))
    r2 = await ingest(db, tg_message(-100999, "Aka ELD ishlamayapti"))
    assert r1.action == "group_pending"
    assert r2.action == "group_disabled"
    assert await count(db, Message) == 0  # allow-list [A9]


async def test_text_message_stored_and_queued_for_analysis(db, org):
    result = await ingest(db, tg_message(-100125, "Aka ELD ishlamayapti", message_id=10))
    assert result.action == "stored"
    assert result.analyze_group_id == org.groups["t125"].id
    async with db() as s:
        msg = await s.get(Message, result.message_id)
        sender = await s.get(TelegramUser, msg.sender_id)
    assert msg.text == "Aka ELD ishlamayapti"
    assert msg.analysis_status == AnalysisStatus.PENDING
    assert sender.first_name == "Aziz"


async def test_redelivered_update_is_idempotent(db, org):
    update = tg_message(-100125, "same message", message_id=11)
    await ingest(db, update)
    again = await ingest(db, update)
    assert again.action == "duplicate"
    assert await count(db, Message) == 1


async def test_edit_creates_revision_and_requeues(db, org):
    first = await ingest(db, tg_message(-100125, "ELD ishlayapti", message_id=12))
    async with db() as s:
        msg = await s.get(Message, first.message_id)
        msg.analysis_status = AnalysisStatus.DONE
        await s.commit()
    edit = tg_message(-100125, "ELD ishlamayapti!", message_id=12)
    edit["edited_message"] = edit.pop("message")
    edit["edited_message"]["edit_date"] = int(utcnow().timestamp())
    result = await ingest(db, edit)
    assert result.action == "edited" and result.analyze_group_id is not None
    async with db() as s:
        msg = await s.get(Message, first.message_id)
        revisions = (await s.scalars(select(MessageRevision))).all()
    assert msg.text == "ELD ishlamayapti!" and msg.edited_at is not None
    assert msg.analysis_status == AnalysisStatus.PENDING
    assert len(revisions) == 1 and revisions[0].previous_text == "ELD ishlayapti"


async def test_voice_message_creates_attachment_and_waits_for_transcript(db, org):
    update = tg_message(
        -100125, None, message_id=13,
        voice={"file_id": "F1", "file_unique_id": "U1", "duration": 7, "mime_type": "audio/ogg", "file_size": 20000},
    )
    result = await ingest(db, update)
    assert len(result.download_attachment_ids) == 1
    async with db() as s:
        msg = await s.get(Message, result.message_id)
        att = (await s.scalars(select(Attachment))).one()
    assert msg.kind == MessageKind.VOICE
    assert msg.transcript_status == TranscriptStatus.PENDING
    assert att.status == AttachmentStatus.PENDING and att.duration_seconds == 7
    assert "[voice message, 7s, not transcribed]" in msg.content_for_ai


async def test_file_over_20mb_marked_too_large(db, org):
    update = tg_message(
        -100125, None, message_id=14, caption="BOL scan",
        document={"file_id": "F2", "file_unique_id": "U2", "file_name": "bol.pdf", "mime_type": "application/pdf",
                  "file_size": 25 * 1024 * 1024},
    )
    result = await ingest(db, update)
    assert result.download_attachment_ids == []
    async with db() as s:
        att = (await s.scalars(select(Attachment))).one()
    assert att.status == AttachmentStatus.TOO_LARGE  # Bot API limit [A4]


async def test_task_command_creates_task_for_review_and_acks(db, org):
    await ingest(db, tg_message(-100125, "Tormoz ovoz chiqaryapti", message_id=20))
    result = await ingest(db, tg_message(-100125, "/task", message_id=21, reply_to=20))
    assert result.action == "command_task"
    assert result.replies and "created" in result.replies[0].text
    async with db() as s:
        task = (await s.scalars(select(Task))).one()
        links = (await s.scalars(select(TaskMessage).where(TaskMessage.task_id == task.id))).all()
        replied = await s.scalar(select(Message).where(Message.tg_message_id == 20))
    assert task.status == TaskStatus.NEEDS_REVIEW
    assert task.source == TaskSource.TELEGRAM_COMMAND
    assert task.title == "Tormoz ovoz chiqaryapti"
    assert task.truck_id == org.trucks["125"].id  # inherited from truck group
    assert len(links) == 2
    assert replied.analysis_status == AnalysisStatus.SKIPPED  # no duplicate AI task


async def test_command_for_other_bot_is_ignored_as_command(db, org):
    result = await ingest(db, tg_message(-100125, "/task@some_other_bot fix it", message_id=22))
    assert result.action == "stored"
    assert await count(db, Task) == 0


async def test_supergroup_migration_keeps_group(db, org):
    update = tg_message(-100900, None, message_id=30, migrate_to_chat_id=-1009000001)
    result = await ingest(db, update)
    assert result.action == "migrated"
    async with db() as s:
        group = await s.get(TelegramGroup, org.groups["dispatch"].id)
    assert group.tg_chat_id == -1009000001 and group.is_enabled  # [A7]


async def test_private_start_links_account(db, org):
    async with db() as s:
        user = await s.get(User, org.users["eld_agent"].id)
        user.tg_link_token = "tok123"
        user.tg_link_token_expires_at = utcnow() + timedelta(minutes=10)
        await s.commit()
    update = {
        "update_id": 99,
        "message": {
            "message_id": 1, "date": int(utcnow().timestamp()),
            "chat": {"id": 8888, "type": "private"},
            "from": {"id": 8888, "first_name": "Javlon"},
            "text": "/start tok123",
        },
    }
    result = await ingest(db, update)
    assert result.action == "linked"
    async with db() as s:
        user = await s.get(User, org.users["eld_agent"].id)
        tg_user = await s.get(TelegramUser, user.telegram_user_id)
    assert tg_user.tg_user_id == 8888 and tg_user.can_dm
    assert user.tg_link_token is None
    assert await count(db, Message) == 0  # private chats are never stored


async def test_expired_link_token_rejected(db, org):
    async with db() as s:
        user = await s.get(User, org.users["eld_agent"].id)
        user.tg_link_token = "old"
        user.tg_link_token_expires_at = utcnow() - timedelta(minutes=1)
        await s.commit()
    update = {
        "update_id": 100,
        "message": {"message_id": 2, "date": 0, "chat": {"id": 1, "type": "private"},
                    "from": {"id": 1, "first_name": "X"}, "text": "/start old"},
    }
    result = await ingest(db, update)
    assert result.action == "start"
    async with db() as s:
        assert (await s.get(User, org.users["eld_agent"].id)).telegram_user_id is None
