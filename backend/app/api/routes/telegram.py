import hmac
import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.config import get_settings
from app.telegram.handler import handle_update

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.post("/webhook", include_in_schema=False)
async def webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    """Telegram calls this for every update. The secret header proves the call is from Telegram [A10].
    Always answer 200 quickly — Telegram retries non-2xx responses, and ingestion is idempotent."""
    settings = get_settings()
    secret = settings.telegram_webhook_secret
    if not secret or not hmac.compare_digest(x_telegram_bot_api_secret_token or "", secret):
        raise HTTPException(status_code=401, detail="bad secret")
    update = await request.json()
    try:
        result = await handle_update(update)
        return {"ok": True, "action": result.action}
    except Exception:  # noqa: BLE001 - never make Telegram retry-storm us
        log.exception("webhook update %s failed", update.get("update_id"))
        return {"ok": False}
