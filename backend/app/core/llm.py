from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import TypeVar

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_log import AIGenerationStatus
from app.repositories.ai_log_repo import create_ai_generation_log
from app.services.app_settings import AIConfig, get_ai_config

SchemaT = TypeVar("SchemaT", bound=BaseModel)


MAX_RATE_LIMIT_WAITS = 3


class AIGenerationError(Exception):
    """Raised when an LLM call fails to produce a valid structured output after retries.
    The message is user-safe (no raw prompt/response content, no internal stack traces).
    """


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def get_llm(config: "AIConfig", fast: bool = False):
    """Chat model client for the provider in `config` (resolved from admin settings, falling back
    to `.env`). `fast=True` uses the cheaper/quicker model."""
    kwargs: dict = {"model": config.model_for(fast), "api_key": config.api_key, "timeout": config.timeout_seconds, "max_retries": 0}
    if config.temperature is not None:
        kwargs["temperature"] = config.temperature

    if config.provider == "groq":
        from langchain_groq import ChatGroq

        if config.max_output_tokens:
            kwargs["max_tokens"] = config.max_output_tokens
        return ChatGroq(**kwargs)

    if config.provider in ("openai", "openrouter"):
        from langchain_openai import ChatOpenAI

        if config.max_output_tokens:
            kwargs["max_tokens"] = config.max_output_tokens
        if config.provider == "openrouter":
            # OpenRouter speaks the OpenAI API; the headers identify the app on openrouter.ai.
            kwargs["base_url"] = OPENROUTER_BASE_URL
            kwargs["default_headers"] = {"X-Title": "CareerAI"}
        return ChatOpenAI(**kwargs)

    if config.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        gemini_kwargs: dict = {
            "model": kwargs["model"],
            "google_api_key": config.api_key,
            "timeout": config.timeout_seconds,
            "max_retries": 0,
        }
        if config.temperature is not None:
            gemini_kwargs["temperature"] = config.temperature
        if config.max_output_tokens:
            gemini_kwargs["max_output_tokens"] = config.max_output_tokens
        return ChatGoogleGenerativeAI(**gemini_kwargs)

    from langchain_anthropic import ChatAnthropic

    if config.max_output_tokens:
        kwargs["max_tokens"] = config.max_output_tokens
    return ChatAnthropic(**kwargs)


def _salvage_failed_generation(exc: Exception, schema: type[SchemaT]) -> SchemaT | None:
    body = getattr(exc, "body", None)
    raw = None
    if isinstance(body, dict):
        raw = (body.get("error") or {}).get("failed_generation") if isinstance(body.get("error"), dict) else body.get("failed_generation")
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and "arguments" in data and isinstance(data["arguments"], (dict, str)):
            data = data["arguments"] if isinstance(data["arguments"], dict) else json.loads(data["arguments"])
        return schema.model_validate(data)
    except Exception:  # noqa: BLE001 - not salvageable; fall back to the normal retry
        return None


_RETRY_AFTER = re.compile(r"try again in (\d+(?:\.\d+)?)\s*(ms|s)", re.IGNORECASE)


def _rate_limit_wait_seconds(exc: Exception, cap: float = 20.0) -> float:
    text = str(exc)
    if "429" not in text and "rate limit" not in text.lower():
        return 0.0
    m = _RETRY_AFTER.search(text)
    if not m:
        return 5.0
    value = float(m.group(1)) / (1000 if m.group(2).lower() == "ms" else 1)
    return min(value + 0.5, cap)


def redact(text: str, config: "AIConfig | None") -> str:
    """Strip the API key (and obvious key-shaped tokens) from provider error messages before
    they are logged or shown."""
    if config and config.api_key:
        text = text.replace(config.api_key, "[redacted]")
    return re.sub(r"\b(sk-ant-|sk-or-|sk-proj-|gsk_|sk-|AIza)[A-Za-z0-9_\-]{8,}", "[redacted]", text)


async def test_connection(config: "AIConfig") -> tuple[bool, str, int]:
    """Minimal live call to verify provider, key and model. Returns (ok, message, latency_ms)."""
    if not config.api_key:
        return False, "No API key is configured for this provider.", 0
    start = time.perf_counter()
    try:
        llm = get_llm(config)
        response = await llm.ainvoke("Reply with the single word: OK")
        latency = int((time.perf_counter() - start) * 1000)
        text = str(getattr(response, "content", "") or "").strip()[:40]
        return True, f"Connected to {config.model} — model replied “{text or 'OK'}”.", latency
    except Exception as exc:  # noqa: BLE001
        latency = int((time.perf_counter() - start) * 1000)
        message = redact(str(exc), config)
        lowered = message.lower()
        if (
            "401" in message
            or "authentication" in lowered
            or "invalid api key" in lowered
            or "invalid x-api-key" in lowered
            or "api key not valid" in lowered
            or "incorrect api key" in lowered
            or "api_key_invalid" in lowered
        ):
            message = "The API key was rejected by the provider. Check that it is correct and active."
        elif "404" in message or "not_found" in lowered or "does not exist" in lowered or "model_not_found" in lowered:
            message = f"The provider doesn't recognise the model “{config.model}”."
        elif "timeout" in lowered or "timed out" in lowered:
            message = "The provider didn't respond in time. Try again or increase the timeout."
        else:
            message = f"Connection failed: {message[:300]}"
        return False, message, latency


def _extract_token_usage(response: object) -> tuple[int | None, int | None]:
    """Best-effort extraction of input/output token counts from a LangChain response's
    `usage_metadata`, if present. Returns (None, None) when unavailable.
    """
    usage = getattr(response, "usage_metadata", None)
    if not usage:
        return None, None
    input_tokens = usage.get("input_tokens")
    output_tokens = usage.get("output_tokens")
    return input_tokens, output_tokens


async def run_structured(
    prompt: str,
    schema: type[SchemaT],
    *,
    operation: str,
    user_id: str | None,
    db: AsyncSession,
    prompt_version: str = "v1",
    fast: bool = False,
) -> SchemaT:
    """Run a single structured-output LLM call, validated against `schema`.

    On a validation/generation failure, retries exactly once with the error message
    appended to the prompt, asking the model to correct its output. Every attempt is
    recorded as an `AIGenerationLog` row (status success/validation_retry/failed) with
    latency and best-effort token usage — never the raw prompt/response content.

    Raises `AIGenerationError` with a user-safe message if both attempts fail.
    """
    config = await get_ai_config(db)
    if not config.api_key:
        raise AIGenerationError("AI is not configured: no API key is set for the selected provider.")
    model_name = config.model_for(fast)
    llm = get_llm(config, fast=fast)
    structured_llm = llm.with_structured_output(schema, include_raw=True)

    user_uuid: uuid.UUID | str | None = user_id

    current_prompt = prompt
    last_error: Exception | None = None

    attempt = 0  # validation attempts (max 2)
    rate_waits = 0  # rate-limit waits don't use up an attempt (max MAX_RATE_LIMIT_WAITS)
    while attempt < 2:
        start = time.perf_counter()
        try:
            raw_result = await structured_llm.ainvoke(current_prompt)
            latency_ms = int((time.perf_counter() - start) * 1000)

            parsed = raw_result.get("parsed") if isinstance(raw_result, dict) else None
            parsing_error = raw_result.get("parsing_error") if isinstance(raw_result, dict) else None
            raw_message = raw_result.get("raw") if isinstance(raw_result, dict) else None

            if parsing_error is not None or parsed is None:
                raise ValueError(str(parsing_error) if parsing_error else "Model did not return a parseable output")

            if not isinstance(parsed, schema):
                parsed = schema.model_validate(parsed)

            input_tokens, output_tokens = _extract_token_usage(raw_message)
            status = AIGenerationStatus.success if attempt == 0 else AIGenerationStatus.validation_retry
            await create_ai_generation_log(
                db,
                user_id=user_uuid,
                operation=operation,
                model=model_name,
                prompt_version=prompt_version,
                latency_ms=latency_ms,
                status=status,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            return parsed

        except Exception as exc:  # noqa: BLE001 - logged then re-raised as AIGenerationError
            latency_ms = int((time.perf_counter() - start) * 1000)
            last_error = exc
            is_final_attempt = attempt == 1

            # Some providers (e.g. Groq) reject a valid JSON answer that wasn't sent as a tool call,
            # and include it in the error. Use it if it fits the schema.
            salvaged = _salvage_failed_generation(exc, schema)
            if salvaged is not None:
                await create_ai_generation_log(
                    db,
                    user_id=user_uuid,
                    operation=operation,
                    model=model_name,
                    prompt_version=prompt_version,
                    latency_ms=latency_ms,
                    status=AIGenerationStatus.success if attempt == 0 else AIGenerationStatus.validation_retry,
                )
                return salvaged
            # Rate limited (e.g. free-tier tokens-per-minute): wait as asked and retry the same prompt.
            wait = _rate_limit_wait_seconds(exc)
            if wait and rate_waits < MAX_RATE_LIMIT_WAITS:
                rate_waits += 1
                await create_ai_generation_log(
                    db,
                    user_id=user_uuid,
                    operation=operation,
                    model=model_name,
                    prompt_version=prompt_version,
                    latency_ms=latency_ms,
                    status=AIGenerationStatus.validation_retry,
                    error_message=redact(str(exc), config)[:2000],
                )
                await asyncio.sleep(wait)
                continue

            await create_ai_generation_log(
                db,
                user_id=user_uuid,
                operation=operation,
                model=model_name,
                prompt_version=prompt_version,
                latency_ms=latency_ms,
                status=AIGenerationStatus.failed if (is_final_attempt or wait) else AIGenerationStatus.validation_retry,
                error_message=redact(str(exc), config)[:2000],
            )
            if wait:
                raise AIBusyError("The AI provider is busy (rate limit). Please try again in a minute.") from exc
            if is_final_attempt:
                break
            attempt += 1
            current_prompt = (
                f"{prompt}\n\n"
                "Your previous response could not be parsed into the required schema. "
                f"Error: {redact(str(exc), config)}\n"
                "Please correct your response and return output that strictly matches the schema."
            )

    raise AIGenerationError(
        f"Failed to generate a valid {schema.__name__} response for operation '{operation}' after retrying."
    ) from last_error


class AIBusyError(AIGenerationError):
    """The provider rate-limited us even after waiting; the user should simply retry shortly."""
