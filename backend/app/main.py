from __future__ import annotations

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.admin import router as admin_router
from app.api.admin_public import router as admin_public_router
from app.api.admin_roles import router as admin_roles_router
from app.api.admin_settings import router as admin_settings_router
from app.api.admin_users import router as admin_users_router
from app.api.auth import router as auth_router
from app.api.public import router as public_router
from app.api.public_interview import router as public_interview_router
from app.api.resumes import router as resumes_router
from app.api.settings import router as settings_router
from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.core.rate_limit import limiter
from app.core.security import hash_password
from app.repositories import user_repo

settings = get_settings()
logger = structlog.get_logger(__name__)


async def _seed_admin() -> None:
    if not (settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD):
        return
    async with AsyncSessionLocal() as db:
        user = await user_repo.get_user_by_email(db, settings.ADMIN_EMAIL)
        if user is None:
            user = await user_repo.create_user(
                db,
                email=settings.ADMIN_EMAIL,
                hashed_password=hash_password(settings.ADMIN_PASSWORD),
                full_name=settings.ADMIN_NAME,
            )
        if not user.is_admin:
            user.is_admin = True
            await db.commit()
        logger.info("admin_ready", email=settings.ADMIN_EMAIL)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await _seed_admin()
    except Exception as exc:  # noqa: BLE001 - never block startup on seeding
        logger.error("admin_seed_failed", error=str(exc))
    yield


app = FastAPI(title=settings.APP_NAME, debug=settings.DEBUG, lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("unhandled_exception", path=request.url.path, method=request.method, error=str(exc))
    return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "Internal server error"})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(resumes_router, prefix="/api/resumes", tags=["resumes"])
app.include_router(admin_users_router, prefix="/api/admin/users", tags=["admin"])
app.include_router(admin_roles_router, prefix="/api/admin/roles", tags=["admin"])
app.include_router(admin_settings_router, prefix="/api/admin/settings", tags=["admin"])
app.include_router(admin_public_router, prefix="/api/admin/public-requests", tags=["admin"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
# Public, no-login tools.
app.include_router(public_interview_router, prefix="/api/public/interviews", tags=["public"])
app.include_router(public_router, prefix="/api/public", tags=["public"])
app.include_router(settings_router, prefix="/api/settings", tags=["public"])
