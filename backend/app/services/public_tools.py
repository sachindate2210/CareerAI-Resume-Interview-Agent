"""Guest (no-login) tool runs. Each run is one `PublicToolRequest` row whose status moves
pending → processing → completed | failed, so the admin panel sees every attempt, including
failures. Resume logic is shared with the logged-in flow (parser + analyzer)."""

from __future__ import annotations

import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.resume_analyzer import analyze_resume
from app.core.config import get_settings
from app.core.llm import AIBusyError, AIGenerationError
from app.models.public_tool import PublicRequestStatus, PublicTool, PublicToolRequest
from app.services.resume_parser import ResumeParsingError, extract_raw_text, parse_resume_text
from app.services.storage import get_storage

logger = structlog.get_logger(__name__)
settings = get_settings()

GENERIC_FAILURE = "Something went wrong while analyzing your resume. Please try again in a moment."


def hash_ip(ip: str | None) -> str | None:
    if not ip:
        return None
    salt = settings.IP_HASH_SALT or settings.JWT_SECRET_KEY
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()


def input_hash(*parts: bytes | str | None) -> str:
    h = hashlib.sha256()
    for part in parts:
        data = part if isinstance(part, bytes) else (part or "").strip().lower().encode()
        h.update(hashlib.sha256(data).digest())
    return h.hexdigest()


def new_access_token() -> str:
    return secrets.token_urlsafe(32)


def file_key(req: PublicToolRequest, ext: str) -> str:
    return f"public/{req.tool.value}/{req.id}/original.{ext}"


async def find_recent_duplicate(
    db: AsyncSession, *, tool: PublicTool, digest: str, visitor_id: str | None, ip_hash: str | None
) -> PublicToolRequest | None:
    """Same input from the same visitor (browser id or IP) within the dedupe window, that has
    not failed. Lets double-clicks and refresh-resubmits reuse the first run."""
    owners = [c for c in (
        PublicToolRequest.visitor_id == visitor_id if visitor_id else None,
        PublicToolRequest.ip_hash == ip_hash if ip_hash else None,
    ) if c is not None]
    if not owners:
        return None
    since = datetime.now(timezone.utc) - timedelta(minutes=settings.PUBLIC_DEDUPE_MINUTES)
    return (
        await db.execute(
            select(PublicToolRequest)
            .where(
                PublicToolRequest.tool == tool,
                PublicToolRequest.input_hash == digest,
                PublicToolRequest.created_at >= since,
                PublicToolRequest.status != PublicRequestStatus.failed,
                or_(*owners),
            )
            .order_by(PublicToolRequest.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def run_resume_optimizer(
    db: AsyncSession, req: PublicToolRequest, *, file_bytes: bytes | None = None
) -> PublicToolRequest:
    """Execute (or re-execute) a resume optimizer request in place. Never raises for
    user-caused or AI failures — those end as `status=failed` with a user-safe message."""
    started = time.monotonic()
    req.status = PublicRequestStatus.processing
    req.error_message = None
    await db.commit()

    meta = req.input_meta or {}
    try:
        if not req.input_text:
            if file_bytes is None:
                file_bytes = get_storage().read(file_key(req, meta["file_type"]))
            req.input_text = extract_raw_text(file_bytes, meta["file_type"])

        parsed = await parse_resume_text(req.input_text, user_id=None, db=db)
        req.parsed_json = parsed.model_dump(mode="json")

        analysis = await analyze_resume(
            parsed,
            user_id=None,
            db=db,
            job_title=meta.get("job_title"),
            job_description=meta.get("job_description"),
        )
        req.result = analysis.model_dump(mode="json")
        req.score = analysis.score
        req.status = PublicRequestStatus.completed
    except ResumeParsingError as exc:
        req.status = PublicRequestStatus.failed
        req.error_message = str(exc)
    except AIGenerationError as exc:
        logger.error("public_optimizer_ai_failed", request_id=str(req.id), error=str(exc))
        req.status = PublicRequestStatus.failed
        req.error_message = (
            "Our AI reviewer is very busy right now. Please try again in a minute."
            if isinstance(exc, AIBusyError)
            else "Our AI reviewer is temporarily unavailable. Please try again in a minute."
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("public_optimizer_unexpected_error", request_id=str(req.id), error=str(exc))
        req.status = PublicRequestStatus.failed
        req.error_message = GENERIC_FAILURE

    req.duration_ms = int((time.monotonic() - started) * 1000)
    req.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(req)
    return req
