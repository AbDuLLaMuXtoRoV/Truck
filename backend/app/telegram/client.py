"""Thin Telegram Bot API client (httpx). Outbound calls are rate limited: ~20 msgs/min per group
and ~30 msgs/s overall [A5]. The limiter is per-process; with several workers keep DM sending in
one process (the Celery `notifications` queue) or move the limiter to Redis."""

import asyncio
import logging
import time
from collections import defaultdict
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

ALLOWED_UPDATES = ["message", "edited_message", "my_chat_member", "callback_query"]


class TelegramError(Exception):
    def __init__(self, method: str, description: str, error_code: int | None = None, retry_after: int | None = None):
        super().__init__(f"{method}: {description}")
        self.description = description
        self.error_code = error_code
        self.retry_after = retry_after


class RateLimiter:
    def __init__(self, per_chat_interval: float = 3.1, global_per_second: int = 25):
        self.per_chat_interval = per_chat_interval
        self.global_interval = 1.0 / global_per_second
        self._last_chat: dict[int, float] = defaultdict(float)
        self._last_global = 0.0
        self._lock = asyncio.Lock()

    async def wait(self, chat_id: int, *, is_group: bool) -> None:
        async with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._last_global + self.global_interval - now)
            if is_group:
                delay = max(delay, self._last_chat[chat_id] + self.per_chat_interval - now)
            if delay:
                await asyncio.sleep(delay)
            stamp = time.monotonic()
            self._last_global = stamp
            self._last_chat[chat_id] = stamp


class TelegramClient:
    def __init__(self, token: str | None = None, *, http: httpx.AsyncClient | None = None):
        settings = get_settings()
        self.token = token or settings.telegram_bot_token
        if not self.token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        self.base = f"{settings.telegram_api_base}/bot{self.token}"
        self.file_base = f"{settings.telegram_api_base}/file/bot{self.token}"
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(70.0, connect=10.0))
        self.limiter = RateLimiter()

    async def close(self) -> None:
        await self.http.aclose()

    async def call(self, method: str, **params: Any) -> Any:
        payload = {k: v for k, v in params.items() if v is not None}
        resp = await self.http.post(f"{self.base}/{method}", json=payload)
        data = resp.json()
        if not data.get("ok"):
            raise TelegramError(
                method,
                data.get("description", "unknown error"),
                data.get("error_code"),
                (data.get("parameters") or {}).get("retry_after"),
            )
        return data["result"]

    # -- bot setup / health ------------------------------------------------------------
    async def get_me(self) -> dict:
        return await self.call("getMe")

    async def set_webhook(self, url: str, secret_token: str) -> bool:
        return await self.call(
            "setWebhook", url=url, secret_token=secret_token, allowed_updates=ALLOWED_UPDATES, drop_pending_updates=False
        )

    async def delete_webhook(self) -> bool:
        return await self.call("deleteWebhook", drop_pending_updates=False)

    async def get_webhook_info(self) -> dict:
        return await self.call("getWebhookInfo")

    async def set_my_commands(
        self, commands: list[tuple[str, str]], language_code: str | None = None, scope: str | None = None
    ) -> bool:
        return await self.call(
            "setMyCommands",
            commands=[{"command": c, "description": d} for c, d in commands],
            language_code=language_code,
            scope={"type": scope} if scope else None,
        )

    async def get_updates(self, offset: int | None, timeout: int = 50) -> list[dict]:
        return await self.call("getUpdates", offset=offset, timeout=timeout, allowed_updates=ALLOWED_UPDATES)

    # -- messaging ---------------------------------------------------------------------
    async def send_message(
        self,
        chat_id: int,
        text: str,
        *,
        reply_to_message_id: int | None = None,
        thread_id: int | None = None,
        reply_markup: dict | None = None,
    ) -> dict:
        await self.limiter.wait(chat_id, is_group=chat_id < 0)
        params = {
            "chat_id": chat_id,
            "text": text,
            "message_thread_id": thread_id,
            "link_preview_options": {"is_disabled": True},
            "reply_markup": reply_markup,
            "reply_parameters": (
                {"message_id": reply_to_message_id, "allow_sending_without_reply": True}
                if reply_to_message_id
                else None
            ),
        }
        try:
            return await self.call("sendMessage", **params)
        except TelegramError as exc:
            if exc.retry_after and exc.retry_after <= 30:
                await asyncio.sleep(exc.retry_after)
                return await self.call("sendMessage", **params)
            raise

    # -- files ---------------------------------------------------------------------------
    async def get_file(self, file_id: str) -> dict:
        return await self.call("getFile", file_id=file_id)

    async def download_file(self, file_path: str) -> bytes:
        resp = await self.http.get(f"{self.file_base}/{file_path}")
        resp.raise_for_status()
        return resp.content


def message_link(chat_id: int, message_id: int, username: str | None = None) -> str | None:
    """Deep link to the original message (spec: every task links back to its source)."""
    if username:
        return f"https://t.me/{username}/{message_id}"
    s = str(chat_id)
    if s.startswith("-100"):
        return f"https://t.me/c/{s[4:]}/{message_id}"
    return None  # basic groups have no message links
