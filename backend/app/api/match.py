import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.llm import AIGenerationError
from app.core.rate_limit import limiter
from app.models.job import Job, JobAnalysis
from app.models.match import MatchAnalysis
from app.models.resume import Resume, ResumeVersion
from app.models.skill_gap import LearningPlan
from app.models.user import User
from app.schemas.job import JobAnalysisResult
from app.schemas.match import MatchResult, MatchResultOut
from app.schemas.resume import ParsedResume
from app.schemas.skill_gap import LearningPlanOut, LearningPlanWeekOut, SkillGapItemOut, SkillGapOut
from app.services.matching_engine import generate_match_result
from app.services.skill_gap import categorize_missing_skills, generate_learning_plan

logger = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()


class MatchRequest(BaseModel):
    resume_version_id: uuid.UUID
    job_id: uuid.UUID


async def _get_owned_resume_version(db: AsyncSession, resume_version_id: uuid.UUID, owner_id: uuid.UUID) -> ResumeVersion:
    result = await db.execute(
        select(ResumeVersion)
        .join(Resume, ResumeVersion.resume_id == Resume.id)
        .where(ResumeVersion.id == resume_version_id, Resume.owner_id == owner_id)
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume version not found")
    return version


async def _get_owned_job_with_analysis(db: AsyncSession, job_id: uuid.UUID, owner_id: uuid.UUID) -> tuple[Job, JobAnalysis]:
    result = await db.execute(select(Job).where(Job.id == job_id, Job.owner_id == owner_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    analysis_result = await db.execute(select(JobAnalysis).where(JobAnalysis.job_id == job.id))
    analysis = analysis_result.scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job has not been analyzed yet")
    return job, analysis


async def _get_owned_match(db: AsyncSession, match_id: uuid.UUID, owner_id: uuid.UUID) -> MatchAnalysis:
    result = await db.execute(
        select(MatchAnalysis)
        .join(ResumeVersion, MatchAnalysis.resume_version_id == ResumeVersion.id)
        .join(Resume, ResumeVersion.resume_id == Resume.id)
        .where(MatchAnalysis.id == match_id, Resume.owner_id == owner_id)
    )
    match = result.scalar_one_or_none()
    if match is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
    return match


@router.post("", response_model=MatchResultOut)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def create_match(
    request: Request,
    payload: MatchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MatchResultOut:
    version = await _get_owned_resume_version(db, payload.resume_version_id, user.id)
    job, analysis = await _get_owned_job_with_analysis(db, payload.job_id, user.id)

    parsed_resume = ParsedResume.model_validate(version.parsed_json)
    job_analysis = JobAnalysisResult.model_validate(analysis.extracted_json)

    try:
        match_result = await generate_match_result(
            parsed_resume,
            job_analysis,
            resume_version_id=version.id,
            job_id=job.id,
            user_id=str(user.id),
            db=db,
        )
    except AIGenerationError as exc:
        logger.error("match_generate_failed", error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Match analysis is temporarily unavailable")

    row = MatchAnalysis(
        resume_version_id=version.id,
        job_id=job.id,
        overall_score=match_result.overall_score,
        skills_match=match_result.skills_match,
        experience_match=match_result.experience_match,
        project_match=match_result.project_match,
        keyword_match=match_result.keyword_match,
        education_match=match_result.education_match,
        reasoning=match_result.reasoning,
        matched_skills=match_result.matched_skills.model_dump(),
        missing_skills=match_result.missing_skills.model_dump(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return MatchResultOut.from_row(row)


@router.get("/{match_id}", response_model=MatchResultOut)
async def get_match(
    match_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MatchResultOut:
    match = await _get_owned_match(db, match_id, user.id)
    return MatchResultOut.from_row(match)


@router.get("/{match_id}/skill-gap", response_model=SkillGapOut)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def get_skill_gap(
    request: Request,
    match_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SkillGapOut:
    match = await _get_owned_match(db, match_id, user.id)
    skill_gap = categorize_missing_skills(match)

    try:
        learning_plan_result = await generate_learning_plan(skill_gap, user_id=str(user.id), db=db)
    except AIGenerationError as exc:
        logger.error("learning_plan_generate_failed", error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Learning plan generation is temporarily unavailable")

    plan_row = LearningPlan(
        user_id=user.id,
        match_analysis_id=match.id,
        plan_json=[w.model_dump() for w in learning_plan_result.weeks],
    )
    db.add(plan_row)
    await db.commit()
    await db.refresh(plan_row)

    missing_items = [
        SkillGapItemOut(skill=skill, priority=priority)
        for priority, skills in skill_gap.missing_skills.items()
        for skill in skills
    ]
    weeks_out = [
        LearningPlanWeekOut(
            week=w.week,
            focus=w.focus,
            tasks=list(w.resources),
            resources=[],
            skills=[w.skill] if w.skill else [],
            priority=w.priority or "important",
        )
        for w in learning_plan_result.weeks
    ]
    return SkillGapOut(
        id=str(plan_row.id),
        match_id=match.id,
        have_skills=skill_gap.have_skills,
        missing_skills=missing_items,
        learning_plan=LearningPlanOut(
            id=str(plan_row.id),
            match_id=match.id,
            weeks=weeks_out,
            created_at=plan_row.created_at,
        ),
    )
