from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.resume_analyzer import analyze_resume
from app.api.deps import get_current_user, get_db
from app.core.llm import AIGenerationError
from app.models.interview import Interview, InterviewEvaluation, InterviewStatus
from app.models.job import Job
from app.models.match import MatchAnalysis
from app.models.resume import Resume, ResumeVersion
from app.models.user import User
from app.schemas.match import CategorizedSkills
from app.schemas.resume import ParsedResume

logger = structlog.get_logger(__name__)
router = APIRouter()


class RecentAnalysis(BaseModel):
    id: str
    resume_id: str
    filename: str | None
    score: float
    created_at: str


class RecentInterview(BaseModel):
    id: str
    mode: str
    status: str
    overall_score: float | None
    created_at: str


class DashboardResponse(BaseModel):
    resume_score: float | None = None
    ats_score: float | None = None
    job_match_score: float | None = None
    interview_readiness: float | None = None
    skills_detected: list[str] = Field(default_factory=list)
    missing_skills: list[str] = Field(default_factory=list)
    recent_analyses: list[RecentAnalysis] = Field(default_factory=list)
    recent_interviews: list[RecentInterview] = Field(default_factory=list)
    recommended_improvements: list[str] = Field(default_factory=list)


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DashboardResponse:
    recommended_improvements: list[str] = []

    # --- latest resume + on-the-fly analysis score (no persisted analysis table exists) ---
    resume_score: float | None = None
    latest_version_result = await db.execute(
        select(ResumeVersion)
        .join(Resume, ResumeVersion.resume_id == Resume.id)
        .where(Resume.owner_id == user.id)
        .order_by(ResumeVersion.created_at.desc())
        .limit(1)
    )
    latest_version = latest_version_result.scalar_one_or_none()
    if latest_version is not None:
        try:
            parsed = ParsedResume.model_validate(latest_version.parsed_json)
            analysis = await analyze_resume(parsed, user_id=str(user.id), db=db)
            resume_score = float(analysis.score)
            recommended_improvements.extend(analysis.weaknesses[:3])
        except AIGenerationError as exc:
            logger.warning("dashboard_resume_analysis_failed", error=str(exc))

    # --- latest job match (ATS / job-match score) ---
    match_result = await db.execute(
        select(MatchAnalysis, Job)
        .join(ResumeVersion, MatchAnalysis.resume_version_id == ResumeVersion.id)
        .join(Resume, ResumeVersion.resume_id == Resume.id)
        .join(Job, MatchAnalysis.job_id == Job.id)
        .where(Resume.owner_id == user.id)
        .order_by(MatchAnalysis.created_at.desc())
        .limit(1)
    )
    latest_match_row = match_result.first()
    ats_score: float | None = None
    job_match_score: float | None = None
    skills_detected: list[str] = []
    missing_skills: list[str] = []
    if latest_match_row is not None:
        latest_match, _job = latest_match_row
        job_match_score = latest_match.overall_score
        ats_score = latest_match.keyword_match
        matched = CategorizedSkills.model_validate(latest_match.matched_skills)
        missing = CategorizedSkills.model_validate(latest_match.missing_skills)
        skills_detected = list(dict.fromkeys(matched.critical + matched.important + matched.nice_to_have))
        missing_skills = list(dict.fromkeys(missing.critical + missing.important + missing.nice_to_have))
        if missing.critical:
            recommended_improvements.append(
                f"Close critical skill gaps for your most recent job match: {', '.join(missing.critical[:5])}."
            )

    # --- recent analyses: recent job-match scores, surfaced per resume (no persisted
    # ResumeAnalysis table exists to list standalone resume analyses cheaply; each match
    # is already a real, grounded score against a real resume, so this reuses that data
    # rather than re-running an LLM analysis per resume on every dashboard load). ---
    recent_matches_result = await db.execute(
        select(MatchAnalysis, Resume)
        .join(ResumeVersion, MatchAnalysis.resume_version_id == ResumeVersion.id)
        .join(Resume, ResumeVersion.resume_id == Resume.id)
        .where(Resume.owner_id == user.id)
        .order_by(MatchAnalysis.created_at.desc())
        .limit(5)
    )
    recent_analyses = [
        RecentAnalysis(
            id=str(match.id),
            resume_id=str(resume.id),
            filename=resume.original_filename,
            score=match.overall_score,
            created_at=match.created_at.isoformat(),
        )
        for match, resume in recent_matches_result.all()
    ]

    # --- interview readiness + recent interviews ---
    recent_interviews_result = await db.execute(
        select(Interview, InterviewEvaluation)
        .outerjoin(InterviewEvaluation, InterviewEvaluation.interview_id == Interview.id)
        .where(Interview.owner_id == user.id)
        .order_by(Interview.created_at.desc())
        .limit(5)
    )
    recent_interview_rows = recent_interviews_result.all()
    recent_interviews = [
        RecentInterview(
            id=str(interview.id),
            mode=interview.mode.value,
            status=interview.status.value,
            overall_score=evaluation.overall_score if evaluation else None,
            created_at=interview.created_at.isoformat(),
        )
        for interview, evaluation in recent_interview_rows
    ]

    interview_readiness: float | None = None
    latest_completed_eval_result = await db.execute(
        select(InterviewEvaluation)
        .join(Interview, InterviewEvaluation.interview_id == Interview.id)
        .where(Interview.owner_id == user.id, Interview.status == InterviewStatus.completed)
        .order_by(InterviewEvaluation.created_at.desc())
        .limit(1)
    )
    latest_eval = latest_completed_eval_result.scalar_one_or_none()
    if latest_eval is not None:
        interview_readiness = latest_eval.overall_score
        if latest_eval.overall_score < 70:
            recommended_improvements.append(
                f"Your last interview evaluation summary flagged: {latest_eval.summary[:200]}"
            )

    if not recommended_improvements:
        recommended_improvements.append(
            "Upload a resume and run a job match to get personalized improvement recommendations."
        )

    return DashboardResponse(
        resume_score=resume_score,
        ats_score=ats_score,
        job_match_score=job_match_score,
        interview_readiness=interview_readiness,
        skills_detected=skills_detected,
        missing_skills=missing_skills,
        recent_analyses=recent_analyses,
        recent_interviews=recent_interviews,
        recommended_improvements=recommended_improvements[:5],
    )
