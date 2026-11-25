"""Runtime application settings, editable by super admins.

Resolution order for every field: value saved in `app_settings` → `.env` (`Settings`) → built-in
default. Results are cached per process and invalidated on save, with a short TTL so other
worker processes pick up changes too.
"""

from __future__ import annotations

import time
import zoneinfo
from dataclasses import dataclass, field
from typing import Literal

import structlog
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.crypto import DecryptionError, decrypt, encrypt
from app.models.app_setting import AppSetting

logger = structlog.get_logger(__name__)

GENERAL_KEY = "general"
AI_KEY = "ai"
CACHE_TTL_SECONDS = 30

Provider = Literal["anthropic", "groq", "openai", "openrouter", "gemini"]
PROVIDERS: dict[str, dict] = {
    "anthropic": {
        "label": "Anthropic Claude",
        "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
        "default_model": "claude-sonnet-5",
        "default_model_fast": "claude-haiku-4-5-20251001",
    },
    "groq": {
        "label": "Groq",
        "models": ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
        "default_model": "openai/gpt-oss-120b",
        "default_model_fast": "openai/gpt-oss-20b",
    },
    "openai": {
        "label": "OpenAI",
        "models": ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini"],
        "default_model": "gpt-4.1",
        "default_model_fast": "gpt-4.1-mini",
    },
    "openrouter": {
        "label": "OpenRouter",
        "models": [
            "openai/gpt-4o",
            "openai/gpt-4o-mini",
            "anthropic/claude-3.5-sonnet",
            "google/gemini-2.0-flash-001",
            "meta-llama/llama-3.3-70b-instruct",
        ],
        "default_model": "openai/gpt-4o",
        "default_model_fast": "openai/gpt-4o-mini",
    },
    "gemini": {
        "label": "Google Gemini",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
        "default_model": "gemini-2.5-flash",
        "default_model_fast": "gemini-2.0-flash",
    },
}
SECRET_FIELDS = {
    "anthropic": "anthropic_api_key",
    "groq": "groq_api_key",
    "openai": "openai_api_key",
    "openrouter": "openrouter_api_key",
    "gemini": "gemini_api_key",
}

DATE_FORMATS = ("DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "MMM DD, YYYY")


# ---------- General ----------


class GeneralSettings(BaseModel):
    app_name: str = Field(min_length=1, max_length=60)
    support_email: EmailStr | None = None
    timezone: str = "UTC"
    date_format: Literal["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "MMM DD, YYYY"] = "DD MMM YYYY"
    time_format: Literal["12h", "24h"] = "12h"
    week_start: Literal["monday", "sunday"] = "monday"
    default_page_size: Literal[10, 20, 50, 100] = 20
    max_upload_mb: int = Field(10, ge=1, le=25)
    public_optimizer_enabled: bool = True

    @field_validator("app_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("App name is required")
        return v

    @field_validator("timezone")
    @classmethod
    def _valid_tz(cls, v: str) -> str:
        if v not in zoneinfo.available_timezones():
            raise ValueError(f"Unknown timezone: {v}")
        return v


def _general_defaults() -> dict:
    s = get_settings()
    return GeneralSettings(app_name=s.APP_NAME, max_upload_mb=min(max(s.MAX_UPLOAD_MB, 1), 25)).model_dump()


# ---------- AI ----------


@dataclass(frozen=True)
class AIConfig:
    """Fully resolved AI config used at call time. Holds the plaintext key — never serialize it."""

    provider: str
    model: str
    model_fast: str
    api_key: str = field(repr=False)
    temperature: float | None
    timeout_seconds: int
    max_output_tokens: int | None
    key_source: str  # "database" | "env" | "none"

    def model_for(self, fast: bool) -> str:
        return self.model_fast if fast else self.model


class AISettingsInput(BaseModel):
    """What the admin may submit. API keys: omitted/None = keep current, "" = clear."""

    model_config = ConfigDict(protected_namespaces=())

    provider: Provider
    model: str = Field(min_length=1, max_length=200)
    # Single-model setup: the "fast" model always mirrors `model` (kept for AIConfig.model_for).
    model_fast: str | None = Field(None, max_length=200)
    temperature: float | None = Field(None, ge=0, le=1)
    timeout_seconds: int = Field(60, ge=5, le=300)
    max_output_tokens: int | None = Field(None, ge=256, le=64000)
    anthropic_api_key: str | None = Field(None, max_length=500)
    groq_api_key: str | None = Field(None, max_length=500)
    openai_api_key: str | None = Field(None, max_length=500)
    openrouter_api_key: str | None = Field(None, max_length=500)
    gemini_api_key: str | None = Field(None, max_length=500)

    @field_validator("model")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Model name is required")
        return v

    @model_validator(mode="after")
    def _single_model(self) -> "AISettingsInput":
        self.model_fast = self.model
        return self

    @field_validator("anthropic_api_key", "groq_api_key", "openai_api_key", "openrouter_api_key", "gemini_api_key")
    @classmethod
    def _strip_key(cls, v: str | None) -> str | None:
        return v.strip() if v is not None else None


def _env_ai() -> dict:
    s = get_settings()
    provider = s.LLM_PROVIDER if s.LLM_PROVIDER in PROVIDERS else "anthropic"
    return {
        "provider": provider,
        "model": s.LLM_MODEL or PROVIDERS[provider]["default_model"],
        "model_fast": s.LLM_MODEL_FAST or PROVIDERS[provider]["default_model_fast"],
        "temperature": None,
        "timeout_seconds": 60,
        "max_output_tokens": None,
        "anthropic_api_key": s.ANTHROPIC_API_KEY or "",
        "groq_api_key": s.GROQ_API_KEY or "",
        "openai_api_key": s.OPENAI_API_KEY or "",
        "openrouter_api_key": s.OPENROUTER_API_KEY or "",
        "gemini_api_key": s.GEMINI_API_KEY or "",
    }


# ---------- Storage + cache ----------

_cache: dict[str, tuple[float, object]] = {}


def invalidate_cache() -> None:
    _cache.clear()


async def _load_row(db: AsyncSession, key: str) -> AppSetting | None:
    return await db.get(AppSetting, key)


async def get_general(db: AsyncSession) -> GeneralSettings:
    hit = _cache.get(GENERAL_KEY)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]  # type: ignore[return-value]
    row = await _load_row(db, GENERAL_KEY)
    merged = {**_general_defaults(), **((row.value if row else None) or {})}
    try:
        general = GeneralSettings.model_validate(merged)
    except Exception:  # noqa: BLE001 - corrupt/old row: fall back rather than break every request
        logger.warning("general_settings_invalid_using_defaults")
        general = GeneralSettings.model_validate(_general_defaults())
    _cache[GENERAL_KEY] = (time.monotonic(), general)
    return general


async def save_general(db: AsyncSession, data: GeneralSettings, actor_id) -> GeneralSettings:
    row = await _load_row(db, GENERAL_KEY) or AppSetting(key=GENERAL_KEY, value={})
    row.value = data.model_dump(mode="json")
    row.updated_by = actor_id
    db.add(row)
    await db.commit()
    invalidate_cache()
    return await get_general(db)


def _decrypt_or_none(value: str | None, field_name: str) -> str | None:
    if not value:
        return None
    try:
        return decrypt(value)
    except DecryptionError:
        logger.error("ai_secret_decrypt_failed", field=field_name)
        return None


async def _ai_state(db: AsyncSession) -> tuple[dict, dict[str, str]]:
    """(merged non-secret settings, {secret_field: source}) plus resolved plaintext secrets in
    the first dict. Internal only."""
    env = _env_ai()
    row = await _load_row(db, AI_KEY)
    stored = (row.value if row else None) or {}
    merged = {k: stored.get(k, env[k]) for k in ("provider", "model", "model_fast", "timeout_seconds")}
    for k in ("temperature", "max_output_tokens"):
        merged[k] = stored[k] if k in stored else env[k]
    sources: dict[str, str] = {}
    for secret in SECRET_FIELDS.values():
        db_value = _decrypt_or_none(stored.get(secret), secret)
        if db_value:
            merged[secret], sources[secret] = db_value, "database"
        elif env[secret]:
            merged[secret], sources[secret] = env[secret], "env"
        else:
            merged[secret], sources[secret] = "", "none"
    sources["_decrypt_failed"] = ",".join(
        s for s in SECRET_FIELDS.values() if stored.get(s) and sources[s] != "database"
    )
    return merged, sources


def _to_config(merged: dict, sources: dict[str, str]) -> AIConfig:
    provider = merged["provider"] if merged["provider"] in PROVIDERS else "anthropic"
    secret = SECRET_FIELDS[provider]
    return AIConfig(
        provider=provider,
        model=merged["model"],
        model_fast=merged["model"],  # single-model setup
        api_key=merged[secret],
        temperature=merged.get("temperature"),
        timeout_seconds=int(merged.get("timeout_seconds") or 60),
        max_output_tokens=merged.get("max_output_tokens"),
        key_source=sources[secret],
    )


async def get_ai_config(db: AsyncSession) -> AIConfig:
    hit = _cache.get(AI_KEY)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]  # type: ignore[return-value]
    merged, sources = await _ai_state(db)
    config = _to_config(merged, sources)
    _cache[AI_KEY] = (time.monotonic(), config)
    return config


async def build_ai_config(db: AsyncSession, data: AISettingsInput) -> AIConfig:
    """Config from a not-yet-saved form (for "Test connection"), filling omitted keys from the
    current effective values."""
    merged, sources = await _ai_state(db)
    merged.update(data.model_dump(exclude=set(SECRET_FIELDS.values())))
    for secret in SECRET_FIELDS.values():
        submitted = getattr(data, secret)
        if submitted:
            merged[secret], sources[secret] = submitted, "form"
    return _to_config(merged, sources)


async def public_ai_view(db: AsyncSession) -> dict:
    """Admin-facing view: everything except secrets, which become masked hints + their source."""
    from app.core.crypto import mask

    merged, sources = await _ai_state(db)
    failed = set(filter(None, sources.pop("_decrypt_failed", "").split(",")))
    return {
        "provider": merged["provider"],
        "model": merged["model"],
        "model_fast": merged["model_fast"],
        "temperature": merged.get("temperature"),
        "timeout_seconds": merged.get("timeout_seconds"),
        "max_output_tokens": merged.get("max_output_tokens"),
        "keys": {
            provider: {
                "configured": bool(merged[secret]),
                "hint": mask(merged[secret]),
                "source": sources[secret],
                "decrypt_failed": secret in failed,
            }
            for provider, secret in SECRET_FIELDS.items()
        },
    }


async def save_ai(db: AsyncSession, data: AISettingsInput, actor_id) -> None:
    row = await _load_row(db, AI_KEY) or AppSetting(key=AI_KEY, value={})
    value = dict(row.value or {})
    value.update(data.model_dump(exclude=set(SECRET_FIELDS.values())))
    for secret in SECRET_FIELDS.values():
        submitted = getattr(data, secret)
        if submitted is None:
            continue  # keep whatever is stored
        if submitted == "":
            value.pop(secret, None)  # clear → falls back to .env
        else:
            value[secret] = encrypt(submitted)
    row.value = value
    row.updated_by = actor_id
    db.add(row)
    await db.commit()
    invalidate_cache()


async def provider_api_key(db: AsyncSession, provider: str) -> str:
    """Current effective key (database, else .env) for `provider`. Internal use only."""
    merged, _ = await _ai_state(db)
    return merged.get(SECRET_FIELDS.get(provider, ""), "") or ""


# ---------- Branding ----------

BRANDING_KEY = "branding"
BRANDING_ASSETS = ("logo", "logo_dark", "favicon", "loader")


class BrandingSettings(BaseModel):
    """Look & feel. Asset fields hold storage keys (e.g. "branding/logo-ab12.png"); the API turns
    them into public URLs."""

    primary_color: str = Field("#2563eb", pattern=r"^#[0-9a-fA-F]{6}$")
    default_theme: Literal["light", "dark", "system"] = "light"
    logo: str | None = None
    logo_dark: str | None = None
    favicon: str | None = None
    loader: str | None = None


async def get_branding(db: AsyncSession) -> BrandingSettings:
    hit = _cache.get(BRANDING_KEY)
    if hit and time.monotonic() - hit[0] < CACHE_TTL_SECONDS:
        return hit[1]  # type: ignore[return-value]
    row = await _load_row(db, BRANDING_KEY)
    try:
        branding = BrandingSettings.model_validate((row.value if row else None) or {})
    except Exception:  # noqa: BLE001
        logger.warning("branding_settings_invalid_using_defaults")
        branding = BrandingSettings()
    _cache[BRANDING_KEY] = (time.monotonic(), branding)
    return branding


async def save_branding(db: AsyncSession, data: BrandingSettings, actor_id) -> BrandingSettings:
    row = await _load_row(db, BRANDING_KEY) or AppSetting(key=BRANDING_KEY, value={})
    row.value = data.model_dump(mode="json")
    row.updated_by = actor_id
    db.add(row)
    await db.commit()
    invalidate_cache()
    return await get_branding(db)
