"""Shared update handling for webhook and polling: ingest + commit, then side effects."""

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import session_factory
from app.services.ingest import IngestResult, ingest_update
from app.workers.queue import enqueue_analysis, enqueue_download, enqueue_reply, enqueue_telegram

log = logging.getLogger(__name__)


async def handle_update(
    update: dict, *, sessionmaker: async_sessionmaker[AsyncSession] | None = None, side_effects: bool = True
) -> IngestResult:
    sm = sessionmaker or session_factory()
    result: IngestResult | None = None
    for attempt in range(2):
        async with sm() as session:
            try:
                result = await ingest_update(session, update)
                await session.commit()
                break
            except IntegrityError:
                # Concurrent webhook calls racing to create the same group/user/message.
                await session.rollback()
                if attempt == 1:
                    log.warning("update %s dropped after integrity conflict", update.get("update_id"))
                    return IngestResult("conflict")
    assert result is not None

    if side_effects:
        if result.analyze_group_id:
            await enqueue_analysis(result.analyze_group_id)
        for attachment_id in result.download_attachment_ids:
            await enqueue_download(attachment_id)
        for reply in result.replies:
            await enqueue_reply(reply.chat_id, reply.text, reply.reply_to_message_id, reply.thread_id)
        for method, params in result.telegram_calls:
            await enqueue_telegram(method, params)
    return result
