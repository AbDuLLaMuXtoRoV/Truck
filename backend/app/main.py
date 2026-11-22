import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import (
    auth,
    companies,
    crm,
    dashboard,
    fleet,
    groups,
    integrations,
    messages,
    shifts,
    tasks,
    telegram,
    users,
)
from app.api.schemas import MetaOut
from app.config import get_settings
from app.core.security import PasswordTooLong
from app.db import get_engine
from app.domain.enums import OPEN_STATUSES, GroupKind, Priority, Role, TaskCategory, TaskStatus
from app.domain.task_state import TRANSITIONS, TransitionError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.env == "prod":
        if settings.jwt_secret.startswith("change-me") or len(settings.jwt_secret) < 32:
            raise RuntimeError("Set a strong JWT_SECRET (32+ chars) before running with ENV=prod")
        if settings.telegram_mode == "webhook" and len(settings.telegram_webhook_secret) < 16:
            raise RuntimeError("Set TELEGRAM_WEBHOOK_SECRET (16+ chars) for webhook mode")
    stop = asyncio.Event()
    background: list[asyncio.Task] = []
    if settings.env != "test":
        if settings.task_queue == "inline":
            from app.workers.queue import periodic_loop

            background.append(asyncio.create_task(periodic_loop(stop)))
        if settings.telegram_mode == "polling" and settings.telegram_bot_token:
            from app.telegram.poller import run_polling

            background.append(asyncio.create_task(run_polling(stop)))
        if settings.ai_enabled:
            log.info("AI analysis enabled (model=%s, effort=%s)", settings.ai_model, settings.ai_effort)
        else:
            log.warning("AI analysis disabled (AI_ENABLED=false): messages are stored and stay pending")
    yield
    stop.set()
    for task in background:
        task.cancel()
    await asyncio.gather(*background, return_exceptions=True)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Smart Truck AI Management Platform", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(TransitionError)
    async def _transition_error(_: Request, exc: TransitionError):
        return JSONResponse(status_code=exc.http_status, content={"detail": {"code": exc.code, "message": exc.message}})

    @app.exception_handler(PasswordTooLong)
    async def _pw_error(_: Request, exc: PasswordTooLong):
        return JSONResponse(status_code=422, content={"detail": {"code": "password_too_long", "message": str(exc)}})

    for module in (auth, users, tasks, dashboard, groups, fleet, messages, telegram, crm, companies, shifts, integrations):
        app.include_router(module.router)

    @app.get("/api/health", tags=["meta"])
    async def health():
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "ok", "ai_enabled": settings.ai_enabled, "telegram_mode": settings.telegram_mode}

    @app.get("/api/meta", response_model=MetaOut, tags=["meta"])
    async def meta():
        return MetaOut(
            statuses=[s.value for s in TaskStatus],
            open_statuses=sorted(s.value for s in OPEN_STATUSES),
            categories=[c.value for c in TaskCategory],
            priorities=[p.value for p in Priority],
            roles=[r.value for r in Role],
            group_kinds=[k.value for k in GroupKind],
            transitions={k.value: sorted(v.value for v in vs) for k, vs in TRANSITIONS.items()},
        )

    return app


app = create_app()
