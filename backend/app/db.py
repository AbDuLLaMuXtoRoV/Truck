from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool, StaticPool

from app.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _make_engine(url: str, *, null_pool: bool = False) -> AsyncEngine:
    kwargs: dict = {"future": True}
    if null_pool:
        kwargs["poolclass"] = NullPool
    elif url in ("sqlite+aiosqlite://", "sqlite+aiosqlite:///:memory:"):
        # One shared connection so every session sees the same in-memory database (tests).
        kwargs["poolclass"] = StaticPool
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_async_engine(url, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine.sync_engine, "connect")
        def _fk_on(dbapi_conn, _):  # pragma: no cover - sqlite only
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return engine


def init_engine(url: str | None = None, *, null_pool: bool = False) -> AsyncEngine:
    """(Re)initialise the global engine. Celery workers use null_pool because each job
    runs in its own event loop."""
    global _engine, _sessionmaker
    _engine = _make_engine(url or get_settings().database_url, null_pool=null_pool)
    _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_engine() -> AsyncEngine:
    if _engine is None:
        init_engine()
    assert _engine is not None
    return _engine


def session_factory() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        init_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    async with session_factory()() as session:
        yield session
