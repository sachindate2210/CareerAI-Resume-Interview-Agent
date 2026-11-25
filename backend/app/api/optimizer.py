import json
import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.resume_optimizer import VALID_SECTIONS, SectionOptimizationResult, optimize_section
from app.api.deps import get_current_user, get_db
from app.api.match import _get_owned_job_with_analysis, _get_owned_resume_version
from app.core.config import get_settings
from app.core.llm import AIGenerationError
from app.core.rate_limit import limiter
from app.models.resume import ResumeVersion, ResumeVersionSource
from app.models.user import User
from app.schemas.job import JobAnalysisResult
from app.schemas.optimizer import OptimizeRequest, OptimizeResult, SectionRewrite
from app.schemas.resume import ParsedResume
from app.services.resume_export import export_resume_docx, export_resume_pdf

logger = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()


class OptimizeSectionRequest(BaseModel):
    resume_version_id: uuid.UUID
    job_id: uuid.UUID
    section: str


class OptimizeCommitRequest(BaseModel):
    resume_version_id: uuid.UUID
    job_id: uuid.UUID
    accepted_sections: list[SectionRewrite] = Field(default_factory=list)


def _apply_section(resume: ParsedResume, rewrite: SectionRewrite) -> ParsedResume:
    updated = resume.model_copy(deep=True)
    if rewrite.section == "summary":
        updated.summary = rewrite.after
    elif rewrite.section == "skills":
        updated.skills = [s.strip() for s in rewrite.after.split(",") if s.strip()]
    elif rewrite.section == "experience":
        data = json.loads(rewrite.after)
        updated.experience = data.get("experience", updated.experience)
    elif rewrite.section == "projects":
        data = json.loads(rewrite.after)
        updated.projects = data.get("projects", updated.projects)
    return updated


@router.post("/resume/optimize", response_model=OptimizeResult)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def optimize_resume(
    request: Request,
    payload: OptimizeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> OptimizeResult:
    version = await _get_owned_resume_version(db, payload.resume_version_id, user.id)
    job, analysis = await _get_owned_job_with_analysis(db, payload.job_id, user.id)

    parsed = ParsedResume.model_validate(version.parsed_json)
    job_analysis = JobAnalysisResult.model_validate(analysis.extracted_json)
    sections = payload.sections or ["summary", "skills", "experience", "projects"]

    rewrites: list[SectionRewrite] = []
    for section in sections:
        if section not in VALID_SECTIONS:
            continue
        try:
            result = await optimize_section(parsed, job_analysis, section, user_id=str(user.id), db=db)
        except AIGenerationError as exc:
            logger.error("optimize_section_failed", section=section, error=str(exc))
            continue
        rewrites.append(
            SectionRewrite(section=result.section, before=result.before, after=result.after, rationale=result.rationale)
        )

    return OptimizeResult(resume_version_id=version.id, job_id=job.id, sections=rewrites)


@router.post("/resume/optimize/section", response_model=SectionOptimizationResult)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def optimize_single_section(
    request: Request,
    payload: OptimizeSectionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SectionOptimizationResult:
    if payload.section not in VALID_SECTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid section {payload.section!r}")

    version = await _get_owned_resume_version(db, payload.resume_version_id, user.id)
    _, analysis = await _get_owned_job_with_analysis(db, payload.job_id, user.id)

    parsed = ParsedResume.model_validate(version.parsed_json)
    job_analysis = JobAnalysisResult.model_validate(analysis.extracted_json)

    try:
        return await optimize_section(parsed, job_analysis, payload.section, user_id=str(user.id), db=db)
    except AIGenerationError as exc:
        logger.error("optimize_single_section_failed", error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Resume optimization is temporarily unavailable")


@router.post("/resume/optimize/commit", response_model=dict)
async def commit_optimized_resume(
    payload: OptimizeCommitRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    version = await _get_owned_resume_version(db, payload.resume_version_id, user.id)
    job, _ = await _get_owned_job_with_analysis(db, payload.job_id, user.id)

    parsed = ParsedResume.model_validate(version.parsed_json)
    for rewrite in payload.accepted_sections:
        parsed = _apply_section(parsed, rewrite)

    max_version = (
        await db.execute(
            select(func.max(ResumeVersion.version_number)).where(ResumeVersion.resume_id == version.resume_id)
        )
    ).scalar_one()

    new_version = ResumeVersion(
        resume_id=version.resume_id,
        version_number=(max_version or 0) + 1,
        parsed_json=parsed.model_dump(mode="json"),
        is_original=False,
        tailored_for_job_id=job.id,
        source=ResumeVersionSource.ai_optimized,
    )
    db.add(new_version)
    await db.commit()
    await db.refresh(new_version)
    return {"resume_version_id": str(new_version.id), "version_number": new_version.version_number}


@router.get("/resumes/versions/{version_id}/export")
async def export_resume_version(
    version_id: uuid.UUID,
    format: str = Query("pdf", pattern="^(pdf|docx)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    version = await _get_owned_resume_version(db, version_id, user.id)
    parsed = ParsedResume.model_validate(version.parsed_json)

    try:
        if format == "pdf":
            content = export_resume_pdf(parsed)
            media_type = "application/pdf"
            filename = f"resume_{version_id}.pdf"
        else:
            content = export_resume_docx(parsed)
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            filename = f"resume_{version_id}.docx"
    except Exception as exc:  # noqa: BLE001
        logger.error("resume_export_failed", version_id=str(version_id), error=str(exc))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to export resume")

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
