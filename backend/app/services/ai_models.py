"""Live model catalogs from each AI provider's API, filtered to chat/text models.

Keys are only sent to the provider's own endpoint and never logged; errors are redacted.
"""

from __future__ import annotations

import httpx
import structlog

logger = structlog.get_logger(__name__)

TIMEOUT = httpx.Timeout(15.0)

# OpenAI-style catalogs include audio/image/embedding models we can't use for structured chat.
_NON_CHAT = ("audio", "realtime", "transcribe", "tts", "whisper", "orpheus", "playai", "dall-e", "image", "embedding", "moderation", "search", "guard", "computer-use")


class ModelListError(Exception):
    pass


def _chat_only(ids: list[str]) -> list[str]:
    return [m for m in ids if not any(bad in m.lower() for bad in _NON_CHAT)]


async def _get_json(client: httpx.AsyncClient, url: str, **kwargs) -> dict:
    response = await client.get(url, **kwargs)
    if response.status_code in (401, 403):
        raise ModelListError("The API key was rejected by the provider.")
    if response.status_code >= 400:
        raise ModelListError(f"The provider returned HTTP {response.status_code}.")
    return response.json()


async def list_models(provider: str, api_key: str) -> list[str]:
    """Return sorted model ids for `provider`. Raises ModelListError with a user-safe message."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            if provider == "openrouter":
                # Public catalog; no key required.
                data = await _get_json(client, "https://openrouter.ai/api/v1/models")
                ids = [m["id"] for m in data.get("data", [])]
                return sorted(set(ids))

            if not api_key:
                raise ModelListError("Add an API key to load this provider's models.")

            if provider == "openai":
                data = await _get_json(client, "https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {api_key}"})
                ids = [m["id"] for m in data.get("data", [])]
                ids = [m for m in ids if m.startswith(("gpt-", "o1", "o3", "o4", "chatgpt-"))]
                return sorted(set(_chat_only(ids)))

            if provider == "groq":
                data = await _get_json(
                    client, "https://api.groq.com/openai/v1/models", headers={"Authorization": f"Bearer {api_key}"}
                )
                ids = [m["id"] for m in data.get("data", []) if m.get("active", True)]
                return sorted(set(_chat_only(ids)))

            if provider == "anthropic":
                data = await _get_json(
                    client,
                    "https://api.anthropic.com/v1/models",
                    params={"limit": 1000},
                    headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                )
                return sorted({m["id"] for m in data.get("data", [])}, reverse=True)

            if provider == "gemini":
                data = await _get_json(
                    client,
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"pageSize": 1000},
                    headers={"x-goog-api-key": api_key},
                )
                ids = [
                    m["name"].removeprefix("models/")
                    for m in data.get("models", [])
                    if "generateContent" in m.get("supportedGenerationMethods", [])
                ]
                return sorted(set(_chat_only(ids)), reverse=True)
        except ModelListError:
            raise
        except httpx.TimeoutException as exc:
            raise ModelListError("The provider didn't respond in time.") from exc
        except Exception as exc:  # noqa: BLE001
            logger.warning("model_list_failed", provider=provider, error_type=type(exc).__name__)
            raise ModelListError("Couldn't load models from the provider.") from exc

    raise ModelListError(f"Unknown provider: {provider}")
