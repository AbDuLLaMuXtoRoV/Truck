"""Celery worker + beat. Run with:
    celery -A app.workers.celery_app worker -Q default,telegram_out --concurrency 4
    celery -A app.workers.celery_app beat
Keep the `telegram_out` queue on a single worker process so the Telegram rate limiter holds [A5].
"""

import asyncio
import uuid

from celery import Celery

from app.config import get_settings
from app.db import init_engine

settings = get_settings()
celery_app = Celery("smart_truck", broker=settings.redis_url)
celery_app.conf.update(
    task_default_queue="default",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "jobs.send_reply": {"queue": "telegram_out"},
        "jobs.send_dms": {"queue": "telegram_out"},
        "jobs.telegram_call": {"queue": "telegram_out"},
    },
    beat_schedule={
        "send-dms": {"task": "jobs.send_dms", "schedule": 15.0},
        "sla-checks": {"task": "jobs.sla_checks", "schedule": 60.0},
        "sweep-pending": {"task": "jobs.sweep_pending", "schedule": 60.0},
        "response-checks": {"task": "jobs.response_checks", "schedule": 15.0},
        "gmail-sync": {"task": "jobs.gmail_sync", "schedule": 60.0},
        "coverage-checks": {"task": "jobs.coverage_checks", "schedule": 60.0},
    },
)

_engine_ready = False


def _run(coro):
    """Each Celery task runs its own event loop; a NullPool engine avoids cross-loop connections."""
    global _engine_ready
    if not _engine_ready:
        init_engine(null_pool=True)
        _engine_ready = True
    return asyncio.run(coro)


@celery_app.task(name="jobs.analyze_group")
def analyze_group(group_id: str):
    from app.workers.jobs import job_analyze_group

    return _run(job_analyze_group(uuid.UUID(group_id)))


@celery_app.task(name="jobs.download_attachment")
def download_attachment(attachment_id: str):
    from app.workers.jobs import job_download_attachment

    return _run(job_download_attachment(uuid.UUID(attachment_id)))


@celery_app.task(name="jobs.send_reply")
def send_reply(chat_id: int, text: str, reply_to: int | None = None, thread_id: int | None = None):
    from app.workers.jobs import job_send_reply

    return _run(job_send_reply(chat_id, text, reply_to, thread_id))


@celery_app.task(name="jobs.send_dms")
def send_dms():
    from app.workers.jobs import job_send_dms

    return _run(job_send_dms())


@celery_app.task(name="jobs.sla_checks")
def sla_checks():
    from app.workers.jobs import job_sla_checks

    return _run(job_sla_checks())


@celery_app.task(name="jobs.sweep_pending")
def sweep_pending():
    from app.workers.jobs import job_sweep_pending

    return _run(job_sweep_pending())


@celery_app.task(name="jobs.telegram_call")
def telegram_call(method: str, params: dict):
    from app.workers.jobs import job_telegram_call

    return _run(job_telegram_call(method, params))


@celery_app.task(name="jobs.analyze_channel")
def analyze_channel(kind: str, channel_id: str):
    from app.workers.jobs import job_analyze_channel

    return _run(job_analyze_channel(kind, uuid.UUID(channel_id)))


@celery_app.task(name="jobs.response_checks")
def response_checks():
    from app.workers.jobs import job_response_checks

    return _run(job_response_checks())


@celery_app.task(name="jobs.gmail_sync")
def gmail_sync():
    from app.workers.jobs import job_gmail_sync

    return _run(job_gmail_sync())


@celery_app.task(name="jobs.coverage_checks")
def coverage_checks():
    from app.workers.jobs import job_coverage_checks

    return _run(job_coverage_checks())
