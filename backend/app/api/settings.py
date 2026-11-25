"""Non-secret settings the frontend needs before login (app name, formats, branding), and the
public branding image files."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.admin_settings import BrandingView, branding_view
from app.core.database import get_db
from app.services import branding_assets
from app.services.app_settings import GeneralSettings, get_branding, get_general

router = APIRouter()


class PublicSettings(GeneralSettings):
    branding: BrandingView


@router.get("/public", response_model=PublicSettings)
async def public_settings(db: AsyncSession = Depends(get_db)) -> PublicSettings:
    # General + branding contain no secrets by design; keep it that way.
    general = await get_general(db)
    return PublicSettings(**general.model_dump(), branding=branding_view(await get_branding(db)))


@router.get("/assets/{name}")
async def branding_asset(name: str) -> Response:
    try:
        content, media_type = branding_assets.read(name)
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found") from exc
    return Response(
        content=content,
        media_type=media_type,
        headers={
            # File names are content-unique, so they can be cached hard.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            # Neutralise scripts inside SVGs if someone opens the file directly.
            "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        },
    )
