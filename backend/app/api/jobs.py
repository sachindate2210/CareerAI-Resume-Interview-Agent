import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.job_analyzer import analyze_job_description
from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.llm import AIGenerationError
from app.core.rate_limit import limiter
from app.models.job import Job, JobAnalysis
from app.models.user import User
from app.schemas.common import Page
from app.schemas.job import JobAnalysisResult, JobCreate, JobRead

logger = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()


class JobReadWithAnalysis(JobRead):
    analysis: JobAnalysisResult | None = None


async def _get_owned_job(db: AsyncSession, job_id: uuid.UUID, owner_id: uuid.UUID) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id, Job.owner_id == owner_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return job


async def _job_with_analysis(db: AsyncSession, job: Job) -> JobReadWithAnalysis:
    result = await db.execute(select(JobAnalysis).where(JobAnalysis.job_id == job.id))
    analysis_row = result.scalar_one_or_none()
    analysis = JobAnalysisResult.model_validate(analysis_row.extracted_json) if analysis_row else None
    return JobReadWithAnalysis(**JobRead.model_validate(job).model_dump(), analysis=analysis)


@router.post("/analyze", response_model=JobReadWithAnalysis, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def analyze_job(
    request: Request,
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobReadWithAnalysis:
    job = Job(
        owner_id=user.id,
        title=payload.title,
        company=payload.company,
        raw_description=payload.raw_description,
        source_url=payload.source_url,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    try:
        result = await analyze_job_description(
            payload.raw_description,
            title=payload.title,
            company=payload.company,
            user_id=str(user.id),
            db=db,
        )
    except AIGenerationError as exc:
        logger.error("job_analyze_failed", job_id=str(job.id), error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Job analysis is temporarily unavailable")

    must_have = [{"name": s} for s in result.required_skills]
    nice_to_have = [{"name": s} for s in result.preferred_skills]
    analysis_row = JobAnalysis(
        job_id=job.id,
        extracted_json=result.model_dump(mode="json"),
        must_have_skills=must_have,
        nice_to_have_skills=nice_to_have,
        keywords=result.keywords,
    )
    db.add(analysis_row)
    await db.commit()

    return await _job_with_analysis(db, job)


@router.get("", response_model=Page[JobReadWithAnalysis])
async def list_jobs(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Page[JobReadWithAnalysis]:
    page = max(1, page)
    page_size = max(1, min(100, page_size))
    total = (await db.execute(select(func.count()).select_from(Job).where(Job.owner_id == user.id))).scalar_one()
    result = await db.execute(
        select(Job).where(Job.owner_id == user.id).order_by(Job.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    items = [await _job_with_analysis(db, j) for j in result.scalars().all()]
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/{job_id}", response_model=JobReadWithAnalysis)
async def get_job(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobReadWithAnalysis:
    job = await _get_owned_job(db, job_id, user.id)
    return await _job_with_analysis(db, job)
