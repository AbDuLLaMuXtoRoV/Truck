"""Job dispatch. TASK_QUEUE=inline runs jobs as asyncio tasks in the current process (local dev,
no Redis). TASK_QUEUE=celery sends them to the Celery worker."""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable

from app.config import get_settings

log = logging.getLogger(__name__)

_background: set[asyncio.Task] = set()
_timers: dict[str, asyncio.TimerHandle] = {}


def _spawn(factory: Callable[[], Awaitable]) -> None:
    async def runner():
        try:
            await factory()
        except Exception:  # noqa: BLE001
            log.exception("inline job failed")

    task = asyncio.get_running_loop().create_task(runner())
    _background.add(task)
    task.add_done_callback(_background.discard)


def _schedule_inline(key: str | None, delay: float, factory: Callable[[], Awaitable]) -> None:
    loop = asyncio.get_running_loop()
    if key and key in _timers:
        _timers.pop(key).cancel()  # debounce: only the latest schedule per key fires
    if delay <= 0:
        _spawn(factory)
        return

    def fire():
        if key:
            _timers.pop(key, None)
        _spawn(factory)

    handle = loop.call_later(delay, fire)
    if key:
        _timers[key] = handle


def _celery():
    from app.workers.celery_app import celery_app

    return celery_app


async def enqueue_analysis(group_id: uuid.UUID, *, delay_seconds: float | None = None) -> None:
    settings = get_settings()
    delay = settings.analysis_debounce_seconds if delay_seconds is None else delay_seconds
    if settings.task_queue == "celery":
        _celery().send_task("jobs.analyze_group", args=[str(group_id)], countdown=delay)
        return
    from app.workers.jobs import job_analyze_group

    _schedule_inline(f"analyze:{group_id}", delay, lambda: job_analyze_group(group_id))


async def enqueue_download(attachment_id: uuid.UUID) -> None:
    if get_settings().task_queue == "celery":
        _celery().send_task("jobs.download_attachment", args=[str(attachment_id)])
        return
    from app.workers.jobs import job_download_attachment

    _schedule_inline(None, 0, lambda: job_download_attachment(attachment_id))


async def enqueue_reply(chat_id: int, text: str, reply_to: int | None = None, thread_id: int | None = None) -> None:
    if get_settings().task_queue == "celery":
        _celery().send_task("jobs.send_reply", args=[chat_id, text, reply_to, thread_id], queue="telegram_out")
        return
    from app.workers.jobs import job_send_reply

    _schedule_inline(None, 0, lambda: job_send_reply(chat_id, text, reply_to, thread_id))


async def enqueue_telegram(method: str, params: dict) -> None:
    """Any other Bot API call (answer a button tap, edit a message, send with buttons)."""
    if get_settings().task_queue == "celery":
        _celery().send_task("jobs.telegram_call", args=[method, params], queue="telegram_out")
        return
    from app.workers.jobs import job_telegram_call

    _schedule_inline(None, 0, lambda: job_telegram_call(method, params))


async def periodic_loop(stop: asyncio.Event) -> None:
    """Inline-mode replacement for Celery beat."""
    from app.workers.jobs import job_send_dms, job_sla_checks, job_sweep_pending

    tick = 0
    while not stop.is_set():
        try:
            await job_send_dms()
            if tick % 4 == 0:
                await job_sla_checks()
                await job_sweep_pending()
        except Exception:  # noqa: BLE001
            log.exception("periodic job failed")
        tick += 1
        try:
            await asyncio.wait_for(stop.wait(), timeout=15)
        except TimeoutError:
            pass
