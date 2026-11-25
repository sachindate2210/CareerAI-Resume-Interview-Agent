"""No-auth endpoints for free public tools. Nothing here touches user accounts.

No `from __future__ import annotations`: slowapi's wrapper hides the module globals FastAPI
needs to resolve string annotations like `UploadFile | None`.
"""


import secrets
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.public_tool import PublicRequestStatus, PublicTool, PublicToolRequest
from app.schemas.public_tool import PublicResumeResult, ResumeOptimizerInput
from app.agents.bullet_rewriter import improve_summary, rewrite_bullets
from app.core.llm import AIBusyError, AIGenerationError
from app.schemas.resume import BulletRewrite, ParsedResume, ResumeAnalysis
from app.services.report_pdf import build_report_pdf
from app.services.resume_export import export_resume_docx, export_resume_pdf
from app.services.resume_improver import ImprovedResume, build_improved_resume, validate_export_payload
from app.services.app_settings import get_general
from app.services.public_tools import (
    file_key,
    find_recent_duplicate,
    hash_ip,
    input_hash,
    new_access_token,
    run_resume_optimizer,
)
from app.services.storage import get_storage

router = APIRouter()
settings = get_settings()

MIN_TEXT_CHARS = 200
MAX_TEXT_CHARS = 30_000
MAX_JOB_TITLE = 200
MAX_JOB_DESCRIPTION = 10_000


def to_public(req: PublicToolRequest, *, deduplicated: bool = False) -> PublicResumeResult:
    return PublicResumeResult(
        id=req.id,
        access_token=req.access_token,
        status=req.status,
        created_at=req.created_at,
        completed_at=req.completed_at,
        input=ResumeOptimizerInput(**(req.input_meta or {"source": "text"})),
        parsed=ParsedResume.model_validate(req.parsed_json) if req.parsed_json else None,
        analysis=ResumeAnalysis.model_validate(req.result) if req.result else None,
        error_message=req.error_message,
        deduplicated=deduplicated,
    )


def _clean(value: str | None, limit: int, field: str) -> str | None:
    value = (value or "").strip()
    if len(value) > limit:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} must be at most {limit} characters.")
    return value or None


@router.post("/resume-optimizer", response_model=PublicResumeResult)
@limiter.limit(settings.PUBLIC_RATE_LIMIT)
async def submit_resume_optimizer(
    request: Request,
    file: UploadFile | None = File(None),
    resume_text: str | None = Form(None),
    job_title: str | None = Form(None),
    job_description: str | None = Form(None),
    visitor_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> PublicResumeResult:
    general = await get_general(db)
    if not general.public_optimizer_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The free Resume Optimizer is temporarily unavailable.")

    resume_text = (resume_text or "").strip() or None
    if bool(file and file.filename) == bool(resume_text):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload a resume file or paste your resume text.")

    job_title = _clean(job_title, MAX_JOB_TITLE, "Job title")
    job_description = _clean(job_description, MAX_JOB_DESCRIPTION, "Job description")
    visitor_id = (visitor_id or "").strip()[:64] or None

    meta: dict = {"job_title": job_title, "job_description": job_description}
    file_bytes: bytes | None = None
    if resume_text:
        if len(resume_text) < MIN_TEXT_CHARS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Resume text is too short — paste your full resume (at least {MIN_TEXT_CHARS} characters).",
            )
        if len(resume_text) > MAX_TEXT_CHARS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Resume text must be under {MAX_TEXT_CHARS} characters.")
        meta["source"] = "text"
        digest = input_hash(resume_text, job_title, job_description)
    else:
        filename = file.filename or "resume"
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if f".{ext}" not in settings.ALLOWED_RESUME_EXTENSIONS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only PDF and DOCX files are supported.")
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The uploaded file is empty.")
        if len(file_bytes) > general.max_upload_mb * 1024 * 1024:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"File exceeds the {general.max_upload_mb}MB limit.")
        meta.update(source="file", filename=filename[:255], file_type=ext)
        digest = input_hash(file_bytes, job_title, job_description)

    ip_hash = hash_ip(get_remote_address(request))
    duplicate = await find_recent_duplicate(
        db, tool=PublicTool.resume_optimizer, digest=digest, visitor_id=visitor_id, ip_hash=ip_hash
    )
    if duplicate is not None:
        return to_public(duplicate, deduplicated=True)

    req = PublicToolRequest(
        tool=PublicTool.resume_optimizer,
        status=PublicRequestStatus.pending,
        access_token=new_access_token(),
        visitor_id=visitor_id,
        ip_hash=ip_hash,
        user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        input_hash=digest,
        input_meta=meta,
        input_text=resume_text,
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    if file_bytes is not None:
        try:
            req.file_path = get_storage().save(file_bytes, file_key(req, meta["file_type"]))
            await db.commit()
        except Exception:  # noqa: BLE001 - the file is a convenience copy for admins; analysis can proceed
            pass

    req = await run_resume_optimizer(db, req, file_bytes=file_bytes)
    return to_public(req)


@router.get("/requests/{request_id}", response_model=PublicResumeResult)
async def get_public_request(request_id: uuid.UUID, token: str, db: AsyncSession = Depends(get_db)) -> PublicResumeResult:
    req = await db.get(PublicToolRequest, request_id)
    # Same 404 for "missing" and "wrong token" so ids can't be probed.
    if req is None or req.tool != PublicTool.resume_optimizer or not secrets.compare_digest(req.access_token, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Result not found or link expired.")
    return to_public(req)


async def _owned_request(db: AsyncSession, request_id: uuid.UUID, token: str) -> PublicToolRequest:
    req = await db.get(PublicToolRequest, request_id)
    if req is None or req.tool != PublicTool.resume_optimizer or not secrets.compare_digest(req.access_token, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Result not found or link expired.")
    return req


@router.post("/requests/{request_id}/rewrites", response_model=list[BulletRewrite])
@limiter.limit(settings.PUBLIC_RATE_LIMIT)
async def public_bullet_rewrites(
    request: Request, request_id: uuid.UUID, token: str, db: AsyncSession = Depends(get_db)
) -> list[BulletRewrite]:
    """AI rewrites of the weakest bullets. Generated once per report, then served from cache."""
    req = await _owned_request(db, request_id, token)
    if req.status != PublicRequestStatus.completed or not req.parsed_json or not req.result:
        raise HTTPException(status.HTTP_409_CONFLICT, "The report isn't ready yet.")
    cached = (req.result or {}).get("bullet_rewrites")
    if cached is not None:
        return [BulletRewrite.model_validate(r) for r in cached]
    try:
        rewrites = await rewrite_bullets(ParsedResume.model_validate(req.parsed_json), user_id=None, db=db)
    except AIBusyError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Our AI writer is very busy right now. Please try again in a minute.") from exc
    except AIGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Our AI writer is temporarily unavailable. Please try again.") from exc
    req.result = {**req.result, "bullet_rewrites": [r.model_dump() for r in rewrites]}
    await db.commit()
    return rewrites


@router.get("/requests/{request_id}/report.pdf")
async def public_report_pdf(request_id: uuid.UUID, token: str, db: AsyncSession = Depends(get_db)) -> Response:
    req = await _owned_request(db, request_id, token)
    if req.status != PublicRequestStatus.completed or not req.result:
        raise HTTPException(status.HTTP_409_CONFLICT, "The report isn't ready yet.")
    parsed = ParsedResume.model_validate(req.parsed_json) if req.parsed_json else None
    general = await get_general(db)
    name = (parsed.name if parsed and parsed.name else None) or (req.input_meta or {}).get("filename") or "Your resume"
    pdf = build_report_pdf(
        ResumeAnalysis.model_validate(req.result),
        parsed,
        app_name=general.app_name,
        title=f"{name}'s resume" if parsed and parsed.name else name,
        job_title=(req.input_meta or {}).get("job_title"),
    )
    safe = "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-")[:40] or "resume"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="resume-report-{safe}.pdf"'},
    )


def _resume_file(resume: ParsedResume, fmt: str, base_name: str) -> Response:
    try:
        validate_export_payload(resume)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    if fmt == "docx":
        content = export_resume_docx(resume)
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        content = export_resume_pdf(resume)
        media = "application/pdf"
    safe = "".join(ch if ch.isalnum() else "-" for ch in (resume.name or base_name).lower()).strip("-")[:40] or "resume"
    return Response(content=content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{safe}-resume.{fmt}"'})


@router.post("/requests/{request_id}/improved-resume", response_model=ImprovedResume)
@limiter.limit(settings.PUBLIC_RATE_LIMIT)
async def public_improved_resume(
    request: Request, request_id: uuid.UUID, token: str, db: AsyncSession = Depends(get_db)
) -> ImprovedResume:
    """The resume with AI improvements applied (rewritten bullets + summary), for review."""
    req = await _owned_request(db, request_id, token)
    if req.status != PublicRequestStatus.completed or not req.parsed_json or not req.result:
        raise HTTPException(status.HTTP_409_CONFLICT, "The report isn't ready yet.")
    parsed = ParsedResume.model_validate(req.parsed_json)
    result = dict(req.result)
    try:
        if result.get("bullet_rewrites") is None:
            result["bullet_rewrites"] = [r.model_dump() for r in await rewrite_bullets(parsed, user_id=None, db=db)]
        if "improved_summary" not in result:
            result["improved_summary"] = await improve_summary(
                parsed, user_id=None, db=db, job_title=(req.input_meta or {}).get("job_title")
            )
    except AIBusyError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Our AI writer is very busy right now. Please try again in a minute.") from exc
    except AIGenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Our AI writer is temporarily unavailable. Please try again.") from exc
    if result != req.result:
        req.result = result
        await db.commit()
    rewrites = [BulletRewrite.model_validate(r) for r in result["bullet_rewrites"]]
    return build_improved_resume(parsed, rewrites, result.get("improved_summary"))


@router.post("/requests/{request_id}/export")
@limiter.limit(settings.PUBLIC_RATE_LIMIT)
async def public_export_resume(
    request: Request,
    request_id: uuid.UUID,
    token: str,
    payload: ParsedResume,
    format: Literal["pdf", "docx"] = "pdf",
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Render the (possibly edited) updated resume. Requires the report's access token."""
    await _owned_request(db, request_id, token)
    return _resume_file(payload, format, "resume")
