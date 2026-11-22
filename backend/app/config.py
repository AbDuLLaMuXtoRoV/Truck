from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: Literal["dev", "test", "prod"] = "dev"
    database_url: str = "sqlite+aiosqlite:///./smart_truck.db"
    redis_url: str = "redis://localhost:6379/0"

    # "inline" runs background jobs inside the API process (local dev without Redis);
    # "celery" sends them to the Celery worker (docker-compose / production).
    task_queue: Literal["inline", "celery"] = "inline"

    jwt_secret: str = "change-me-in-production-please-32b"
    jwt_ttl_minutes: int = 60 * 12
    cors_origins: str = "http://localhost:3000"

    dashboard_url: str = "http://localhost:3000"

    # Telegram. "polling" runs getUpdates inside the API process (local dev);
    # "webhook" expects Telegram to POST to /api/telegram/webhook (production).
    telegram_mode: Literal["off", "polling", "webhook"] = "off"
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_webhook_secret: str = ""
    telegram_api_base: str = "https://api.telegram.org"
    telegram_max_download_bytes: int = 20 * 1024 * 1024  # Bot API getFile limit [A4]
    telegram_group_acks: bool = True  # reply "task created" in group for /task commands

    # AI
    ai_enabled: bool = False
    # Optional: when empty the SDK falls back to the ANTHROPIC_API_KEY env var / `ant auth login` profile.
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5-5"
    ai_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    ai_max_tokens: int = 16000
    ai_drop_below: float = 0.5
    ai_review_below: float = 0.85
    auto_assign_enabled: bool = False  # off during pilot [B5]

    # Conversation windowing [B4]
    analysis_debounce_seconds: int = 90
    analysis_max_wait_seconds: int = 300
    analysis_context_messages: int = 15
    analysis_open_tasks_limit: int = 25

    # Dedupe [B12]
    dedupe_window_hours: int = 72
    dedupe_similarity: float = 0.5

    # 24/7 human-response SLA (blueprint sec. 7): team reminder, supervisor, manager/owner
    response_reminder_seconds: int = 180
    response_overdue_seconds: int = 300
    response_escalate_seconds: int = 600
    # A staff message that is not a reply answers every waiting message in that chat.
    # Set false to require explicit replies (or manual association) instead.
    response_unthreaded_answers_all: bool = True
    # "Nobody on duty" alerts need the shift roster in use; off until then.
    coverage_alerts_enabled: bool = False

    # Gmail / Google Workspace (blueprint sec. 5). OAuth client from Google Cloud Console.
    google_client_id: str = ""
    google_client_secret: str = ""
    # Public address of the dashboard (it proxies /api) — used for the OAuth redirect URI.
    public_url: str = "http://localhost:3000"
    gmail_sync_seconds: int = 60
    # Fernet key for OAuth tokens at rest. Empty = derived from JWT_SECRET (set a real one in prod).
    encryption_key: str = ""

    # Storage
    storage_dir: str = "./storage"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
