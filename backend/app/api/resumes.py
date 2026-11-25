import uuid
from datetime import datetime, timezone
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.bullet_rewriter import improve_summary, rewrite_bullets
from app.agents.resume_analyzer import analyze_resume
from app.services.report_pdf import build_report_pdf
from app.services.resume_export import export_resume_docx, export_resume_pdf
from app.services.resume_improver import ImprovedResume, build_improved_resume, validate_export_payload
from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.llm import AIGenerationError
from app.core.rate_limit import limiter
from app.models.resume import Resume, ResumeStatus, ResumeVersion, ResumeVersionSource
from app.models.user import User
from app.schemas.common import Page
from app.schemas.resume import (
    BulletRewrite,
    ParsedResume,
    ResumeAnalysis,
    ResumeDetailRead,
    ResumeRead,
    ResumeUploadResponse,
    ResumeVersionRead,
)
from app.services.app_settings import get_general
from app.services.resume_parser import ResumeParsingError, parse_resume_file
from app.services.storage import get_storage

logger = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()


async def _get_owned_resume(db: AsyncSession, resume_id: uuid.UUID, owner_id: uuid.UUID) -> Resume:
    result = await db.execute(select(Resume).where(Resume.id == resume_id, Resume.owner_id == owner_id))
    resume = result.scalar_one_or_none()
    if resume is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found")
    return resume


async def _latest_version(db: AsyncSession, resume_id: uuid.UUID) -> ResumeVersion | None:
    result = await db.execute(
        select(ResumeVersion)
        .where(ResumeVersion.resume_id == resume_id)
        .order_by(ResumeVersion.version_number.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


@router.post("/upload", response_model=ResumeUploadResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def upload_resume(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeUploadResponse:
    """Uploads a resume file and parses it synchronously (inline `await`), per the brief's
    documented simplification for this portfolio app — no Celery/background-task polling.
    """
    filename = file.filename or "resume"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in settings.ALLOWED_RESUME_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type {ext!r}. Allowed: {settings.ALLOWED_RESUME_EXTENSIONS}",
        )

    file_bytes = await file.read()
    max_mb = (await get_general(db)).max_upload_mb
    if len(file_bytes) > max_mb * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"File exceeds the {max_mb}MB limit")

    resume = Resume(
        owner_id=user.id,
        title=filename,
        original_filename=filename,
        file_path="",
        file_type=ext.lstrip("."),
        status=ResumeStatus.pending,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)

    storage_key = f"resumes/{resume.id}/original{ext}"
    try:
        storage_path = get_storage().save(file_bytes, storage_key)
        resume.file_path = storage_path
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.error("resume_storage_save_failed", resume_id=str(resume.id), error=str(exc))
        resume.status = ResumeStatus.failed
        await db.commit()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store uploaded file")

    version: ResumeVersion | None = None
    try:
        raw_text, parsed = await parse_resume_file(file_bytes, resume.file_type, user_id=str(user.id), db=db)
        resume.raw_text = raw_text
        resume.status = ResumeStatus.parsed
        version = ResumeVersion(
            resume_id=resume.id,
            version_number=1,
            parsed_json=parsed.model_dump(mode="json"),
            is_original=True,
            source=ResumeVersionSource.original,
        )
        db.add(version)
        await db.commit()
        await db.refresh(resume)
        await db.refresh(version)
    except ResumeParsingError as exc:
        logger.warning("resume_parse_failed", resume_id=str(resume.id), reason=str(exc))
        resume.status = ResumeStatus.failed
        await db.commit()
        await db.refresh(resume)
    except Exception as exc:  # noqa: BLE001
        logger.error("resume_parse_unexpected_error", resume_id=str(resume.id), error=str(exc))
        resume.status = ResumeStatus.failed
        await db.commit()
        await db.refresh(resume)

    return ResumeUploadResponse(
        resume=ResumeRead.model_validate(resume),
        version=ResumeVersionRead.model_validate(version) if version else None,
    )


@router.get("", response_model=Page[ResumeDetailRead])
async def list_resumes(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[ResumeDetailRead]:
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    total = (await db.execute(select(func.count()).select_from(Resume).where(Resume.owner_id == user.id))).scalar_one()
    result = await db.execute(
        select(Resume)
        .where(Resume.owner_id == user.id)
        .order_by(Resume.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = []
    for r in result.scalars().all():
        version = await _latest_version(db, r.id)
        items.append(
            ResumeDetailRead(
                **ResumeRead.model_validate(r).model_dump(),
                latest_version=ResumeVersionRead.model_validate(version) if version else None,
            )
        )
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/{resume_id}", response_model=ResumeDetailRead)
async def get_resume(
    resume_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeDetailRead:
    resume = await _get_owned_resume(db, resume_id, user.id)
    version = await _latest_version(db, resume.id)
    return ResumeDetailRead(
        **ResumeRead.model_validate(resume).model_dump(),
        latest_version=ResumeVersionRead.model_validate(version) if version else None,
    )


@router.post("/{resume_id}/analyze", response_model=ResumeAnalysis)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def analyze_resume_endpoint(
    request: Request,
    resume_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeAnalysis:
    resume = await _get_owned_resume(db, resume_id, user.id)
    version = await _latest_version(db, resume.id)
    if version is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resume has not been parsed yet")

    parsed = ParsedResume.model_validate(version.parsed_json)
    try:
        analysis = await analyze_resume(parsed, user_id=str(user.id), db=db)
        resume.analysis = analysis.model_dump(mode="json")
        resume.analyzed_at = datetime.now(timezone.utc)
        await db.commit()
        return analysis
    except AIGenerationError as exc:
        logger.error("resume_analyze_failed", resume_id=str(resume_id), error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Resume analysis is temporarily unavailable")



@router.post("/{resume_id}/rewrites", response_model=list[BulletRewrite])
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def resume_bullet_rewrites(
    request: Request,
    resume_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[BulletRewrite]:
    resume = await _get_owned_resume(db, resume_id, user.id)
    version = await _latest_version(db, resume.id)
    if version is None or not resume.analysis:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analyze the resume first")
    cached = resume.analysis.get("bullet_rewrites")
    if cached is not None:
        return [BulletRewrite.model_validate(r) for r in cached]
    try:
        rewrites = await rewrite_bullets(ParsedResume.model_validate(version.parsed_json), user_id=str(user.id), db=db)
    except AIGenerationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI rewriting is temporarily unavailable") from exc
    resume.analysis = {**resume.analysis, "bullet_rewrites": [r.model_dump() for r in rewrites]}
    await db.commit()
    return rewrites


@router.get("/{resume_id}/report.pdf")
async def resume_report_pdf(
    resume_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    resume = await _get_owned_resume(db, resume_id, user.id)
    if not resume.analysis:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analyze the resume first")
    version = await _latest_version(db, resume.id)
    parsed = ParsedResume.model_validate(version.parsed_json) if version else None
    general = await get_general(db)
    pdf = build_report_pdf(
        ResumeAnalysis.model_validate(resume.analysis),
        parsed,
        app_name=general.app_name,
        title=f"{parsed.name}'s resume" if parsed and parsed.name else resume.original_filename,
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="resume-report.pdf"'},
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


@router.post("/{resume_id}/improved-resume", response_model=ImprovedResume)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def improved_resume(
    request: Request,
    resume_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ImprovedResume:
    resume = await _get_owned_resume(db, resume_id, user.id)
    version = await _latest_version(db, resume.id)
    if version is None or not resume.analysis:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Analyze the resume first")
    parsed = ParsedResume.model_validate(version.parsed_json)
    analysis = dict(resume.analysis)
    try:
        if analysis.get("bullet_rewrites") is None:
            analysis["bullet_rewrites"] = [r.model_dump() for r in await rewrite_bullets(parsed, user_id=str(user.id), db=db)]
        if "improved_summary" not in analysis:
            analysis["improved_summary"] = await improve_summary(parsed, user_id=str(user.id), db=db)
    except AIGenerationError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI rewriting is temporarily unavailable") from exc
    if analysis != resume.analysis:
        resume.analysis = analysis
        await db.commit()
    rewrites = [BulletRewrite.model_validate(r) for r in analysis["bullet_rewrites"]]
    return build_improved_resume(parsed, rewrites, analysis.get("improved_summary"))


@router.post("/{resume_id}/apply", response_model=ResumeVersionRead)
async def apply_improved_resume(
    resume_id: uuid.UUID,
    payload: ParsedResume,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ResumeVersionRead:
    """Save the reviewed, updated resume as a new version (the original stays as version 1)."""
    resume = await _get_owned_resume(db, resume_id, user.id)
    try:
        validate_export_payload(payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    latest = await _latest_version(db, resume.id)
    version = ResumeVersion(
        resume_id=resume.id,
        version_number=(latest.version_number if latest else 0) + 1,
        parsed_json=payload.model_dump(mode="json"),
        is_original=False,
        source=ResumeVersionSource.ai_optimized,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    return ResumeVersionRead.model_validate(version)


@router.post("/{resume_id}/export")
async def export_updated_resume(
    resume_id: uuid.UUID,
    payload: ParsedResume,
    format: Literal["pdf", "docx"] = "pdf",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    await _get_owned_resume(db, resume_id, user.id)
    return _resume_file(payload, format, "resume")
