"""Theme Configuration: general app settings + AI model config. Super admin only.

API keys are write-only: responses carry a masked hint and where the key comes from, never the
key itself.
"""

from __future__ import annotations

import structlog
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_super_admin
from app.core.llm import test_connection
from app.models.user import User
from app.services import branding_assets
from app.services.ai_models import ModelListError, list_models
from app.services.app_settings import (
    DATE_FORMATS,
    PROVIDERS,
    SECRET_FIELDS,
    AISettingsInput,
    BrandingSettings,
    GeneralSettings,
    build_ai_config,
    get_branding,
    get_general,
    provider_api_key,
    public_ai_view,
    save_ai,
    save_branding,
    save_general,
)

logger = structlog.get_logger(__name__)
router = APIRouter(dependencies=[Depends(require_super_admin)])


class AITestResult(BaseModel):
    ok: bool
    message: str
    latency_ms: int
    provider: str
    model: str


@router.get("/general", response_model=GeneralSettings)
async def read_general(db: AsyncSession = Depends(get_db)) -> GeneralSettings:
    return await get_general(db)


@router.put("/general", response_model=GeneralSettings)
async def update_general(
    payload: GeneralSettings, db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin)
) -> GeneralSettings:
    saved = await save_general(db, payload, actor.id)
    logger.info("settings_general_updated", actor=str(actor.id))
    return saved


@router.get("/options")
async def options() -> dict:
    """Static choices for the settings forms."""
    import zoneinfo

    return {
        "providers": [{"key": k, **v} for k, v in PROVIDERS.items()],
        "date_formats": list(DATE_FORMATS),
        "timezones": sorted(tz for tz in zoneinfo.available_timezones() if "/" in tz or tz == "UTC"),
    }


@router.get("/ai")
async def read_ai(db: AsyncSession = Depends(get_db)) -> dict:
    return await public_ai_view(db)


@router.put("/ai")
async def update_ai(
    payload: AISettingsInput, db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin)
) -> dict:
    await save_ai(db, payload, actor.id)
    changed_keys = [k for k in SECRET_FIELDS.values() if getattr(payload, k) is not None]
    logger.info("settings_ai_updated", actor=str(actor.id), provider=payload.provider, keys_changed=changed_keys)
    return await public_ai_view(db)


@router.post("/ai/test", response_model=AITestResult)
async def test_ai(payload: AISettingsInput, db: AsyncSession = Depends(get_db)) -> AITestResult:
    """Test the submitted (possibly unsaved) settings; blank key fields use the current key."""
    config = await build_ai_config(db, payload)
    ok, message, latency = await test_connection(config)
    logger.info("settings_ai_tested", provider=config.provider, model=config.model, ok=ok)
    return AITestResult(ok=ok, message=message, latency_ms=latency, provider=config.provider, model=config.model)


class ModelListRequest(BaseModel):
    provider: str
    # Optional unsaved key typed in the form; otherwise the saved/.env key is used.
    api_key: str | None = None


class ModelListResponse(BaseModel):
    provider: str
    models: list[str]
    live: bool
    message: str | None = None


@router.post("/ai/models", response_model=ModelListResponse)
async def list_provider_models(payload: ModelListRequest, db: AsyncSession = Depends(get_db)) -> ModelListResponse:
    """All chat models the provider offers, fetched live. Falls back to our suggestions when the
    provider can't be reached or no key is set."""
    if payload.provider not in PROVIDERS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown provider")
    key = (payload.api_key or "").strip() or await provider_api_key(db, payload.provider)
    try:
        models = await list_models(payload.provider, key)
        if models:
            return ModelListResponse(provider=payload.provider, models=models, live=True)
        message = "The provider returned no chat models; showing suggestions."
    except ModelListError as exc:
        message = f"{exc} Showing suggested models instead."
    return ModelListResponse(provider=payload.provider, models=PROVIDERS[payload.provider]["models"], live=False, message=message)


# ---------- Branding ----------


class BrandingView(BaseModel):
    primary_color: str
    default_theme: str
    logo_url: str | None = None
    logo_dark_url: str | None = None
    favicon_url: str | None = None
    loader_url: str | None = None


class BrandingUpdate(BaseModel):
    primary_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    default_theme: Literal["light", "dark", "system"]


def branding_view(b: BrandingSettings) -> BrandingView:
    return BrandingView(
        primary_color=b.primary_color,
        default_theme=b.default_theme,
        logo_url=branding_assets.public_url(b.logo),
        logo_dark_url=branding_assets.public_url(b.logo_dark),
        favicon_url=branding_assets.public_url(b.favicon),
        loader_url=branding_assets.public_url(b.loader),
    )


@router.get("/branding", response_model=BrandingView)
async def read_branding(db: AsyncSession = Depends(get_db)) -> BrandingView:
    return branding_view(await get_branding(db))


@router.put("/branding", response_model=BrandingView)
async def update_branding(
    payload: BrandingUpdate, db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin)
) -> BrandingView:
    current = await get_branding(db)
    saved = await save_branding(db, current.model_copy(update=payload.model_dump()), actor.id)
    logger.info("settings_branding_updated", actor=str(actor.id))
    return branding_view(saved)


@router.post("/branding/{asset}", response_model=BrandingView)
async def upload_branding_asset(
    asset: Literal["logo", "logo_dark", "favicon", "loader"],
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
) -> BrandingView:
    data = await file.read(branding_assets.MAX_ASSET_BYTES + 1)
    try:
        ext = branding_assets.validate(asset, file.filename or "", data)
    except branding_assets.AssetError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    current = await get_branding(db)
    key = branding_assets.save(asset, ext, data)
    saved = await save_branding(db, current.model_copy(update={asset: key}), actor.id)
    branding_assets.delete(getattr(current, asset))  # drop the replaced file
    logger.info("settings_branding_asset_uploaded", actor=str(actor.id), asset=asset)
    return branding_view(saved)


@router.delete("/branding/{asset}", response_model=BrandingView)
async def remove_branding_asset(
    asset: Literal["logo", "logo_dark", "favicon", "loader"],
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
) -> BrandingView:
    current = await get_branding(db)
    saved = await save_branding(db, current.model_copy(update={asset: None}), actor.id)
    branding_assets.delete(getattr(current, asset))
    logger.info("settings_branding_asset_removed", actor=str(actor.id), asset=asset)
    return branding_view(saved)
