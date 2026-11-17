"""Long polling for local development (TELEGRAM_MODE=polling). Production uses the webhook."""

import asyncio
import logging

from app.i18n import BOT_COMMANDS, BOT_PRIVATE_COMMANDS
from app.telegram.client import TelegramClient, TelegramError
from app.telegram.handler import handle_update

log = logging.getLogger(__name__)


async def check_bot(client: TelegramClient) -> dict:
    """Privacy mode must be off or the bot only sees commands and mentions [A1]."""
    me = await client.get_me()
    if not me.get("can_read_all_group_messages"):
        log.warning(
            "Bot @%s has privacy mode ON — it only sees normal messages in groups where it is an ADMIN. "
            "To cover all groups: BotFather → /setprivacy → Disable, then remove and re-add the bot.",
            me.get("username"),
        )
    return me


async def register_commands(client: TelegramClient) -> None:
    """Command menu in Uzbek, Russian and English (Telegram picks by the user's app language)."""
    for scope, table in (("all_group_chats", BOT_COMMANDS), ("all_private_chats", BOT_PRIVATE_COMMANDS)):
        for lang, commands in table.items():
            try:
                await client.set_my_commands(commands, language_code=None if lang == "en" else lang, scope=scope)
            except TelegramError as exc:
                log.warning("setMyCommands(%s, %s) failed: %s", scope, lang, exc)


async def run_polling(stop: asyncio.Event) -> None:
    client = TelegramClient()
    try:
        me = await check_bot(client)
        log.info("Polling as @%s", me.get("username"))
        await register_commands(client)
        await client.delete_webhook()
        offset: int | None = None
        while not stop.is_set():
            try:
                updates = await client.get_updates(offset, timeout=30)
            except TelegramError as exc:
                log.warning("getUpdates failed: %s", exc)
                await asyncio.sleep(5)
                continue
            except Exception as exc:  # noqa: BLE001 - network hiccups
                log.warning("getUpdates error: %s", exc)
                await asyncio.sleep(5)
                continue
            for update in updates:
                try:
                    await handle_update(update)
                except Exception:  # noqa: BLE001
                    log.exception("failed to handle update %s", update.get("update_id"))
                offset = update["update_id"] + 1
    finally:
        await client.close()
