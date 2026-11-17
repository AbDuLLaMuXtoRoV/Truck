"""LLM task extractor. `Extractor` is the seam: the pipeline and tests depend on the protocol,
production uses ClaudeExtractor."""

import logging
import time
from dataclasses import dataclass
from typing import Literal, Protocol

import anthropic
from pydantic import ValidationError

from app.ai.prompts import PROMPT_VERSION, SYSTEM_PROMPT, ExtractionRequest, build_content_blocks
from app.ai.schemas import ExtractionResult
from app.config import get_settings

log = logging.getLogger(__name__)


@dataclass
class ExtractionResponse:
    status: Literal["ok", "refusal", "error"]
    model: str
    prompt_version: str = PROMPT_VERSION
    result: ExtractionResult | None = None
    retryable: bool = False
    error: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    latency_ms: int | None = None
    request_id: str | None = None


class Extractor(Protocol):
    model: str

    async def extract(self, request: ExtractionRequest) -> ExtractionResponse: ...


class ClaudeExtractor:
    """Claude with strict structured outputs. Server-side refusal fallback is enabled so a
    false-positive safety decline is retried on a fallback model inside the same call."""

    def __init__(self, client: anthropic.AsyncAnthropic | None = None, model: str | None = None):
        settings = get_settings()
        self.client = client or anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)
        self.model = model or settings.ai_model
        self.effort = settings.ai_effort
        self.max_tokens = settings.ai_max_tokens

    async def extract(self, request: ExtractionRequest) -> ExtractionResponse:
        started = time.monotonic()
        try:
            # Raw response: the SDK's parse() raises on refusal / truncated output before we
            # could look at stop_reason, so read the body first and validate ourselves.
            raw = await self.client.beta.messages.with_raw_response.parse(
                model=self.model,
                max_tokens=self.max_tokens,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": self.effort},
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": build_content_blocks(request)}],
                output_format=ExtractionResult,
            )
        except anthropic.BadRequestError as exc:
            return self._error(started, f"bad_request: {exc.message}", retryable=False)
        except anthropic.AuthenticationError as exc:
            return self._error(started, f"auth: {exc.message}", retryable=False)
        except anthropic.PermissionDeniedError as exc:
            return self._error(started, f"permission: {exc.message}", retryable=False)
        except anthropic.NotFoundError as exc:
            return self._error(started, f"not_found: {exc.message}", retryable=False)
        except anthropic.RateLimitError as exc:
            return self._error(started, f"rate_limited: {exc.message}", retryable=True)
        except anthropic.APIStatusError as exc:
            return self._error(started, f"api_{exc.status_code}: {exc.message}", retryable=exc.status_code >= 500)
        except anthropic.APIConnectionError as exc:
            return self._error(started, f"connection: {exc}", retryable=True)

        latency = int((time.monotonic() - started) * 1000)
        body = raw.http_response.json()
        usage = body.get("usage") or {}
        stop_reason = body.get("stop_reason")
        common = dict(
            model=body.get("model", self.model),
            latency_ms=latency,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            cache_read_tokens=usage.get("cache_read_input_tokens"),
            request_id=raw.request_id,
        )
        if stop_reason == "refusal":
            category = (body.get("stop_details") or {}).get("category")
            return ExtractionResponse(status="refusal", error=f"refusal: {category}", **common)
        if stop_reason == "max_tokens":
            return ExtractionResponse(status="error", error="output truncated (max_tokens)", **common)
        try:
            response = await raw.parse()
        except ValidationError as exc:
            return ExtractionResponse(status="error", error=f"invalid structured output: {exc.error_count()} errors", **common)
        if response.parsed_output is None:
            return ExtractionResponse(status="error", error=f"no parsed output (stop_reason={stop_reason})", **common)
        return ExtractionResponse(status="ok", result=response.parsed_output, **common)

    def _error(self, started: float, message: str, *, retryable: bool) -> ExtractionResponse:
        log.warning("AI extraction failed: %s", message)
        return ExtractionResponse(
            status="error",
            model=self.model,
            error=message,
            retryable=retryable,
            latency_ms=int((time.monotonic() - started) * 1000),
        )


_extractor: Extractor | None = None


def get_extractor() -> Extractor | None:
    """Returns None when AI is disabled (messages stay pending; nothing is lost)."""
    global _extractor
    if not get_settings().ai_enabled:
        return None
    if _extractor is None:
        _extractor = ClaudeExtractor()
    return _extractor


def set_extractor(extractor: Extractor | None) -> None:
    """Test / dependency-injection hook."""
    global _extractor
    _extractor = extractor
