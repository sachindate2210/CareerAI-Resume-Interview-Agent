from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.resume import ResumeStatus, ResumeVersionSource


class ExperienceItem(BaseModel):
    """If a field cannot be grounded in the source resume, return null."""

    company: str | None = None
    title: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    location: str | None = None
    bullets: list[str] = Field(default_factory=list)


class EducationItem(BaseModel):
    """If a field cannot be grounded in the source resume, return null."""

    institution: str | None = None
    degree: str | None = None
    field: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class ProjectItem(BaseModel):
    """If a field cannot be grounded in the source resume, return null."""

    name: str | None = None
    description: str | None = None
    technologies: list[str] = Field(default_factory=list)
    bullets: list[str] = Field(default_factory=list)


class ParsedResume(BaseModel):
    """Structured extraction schema for a resume. Every field must be grounded in the
    source document — never invent or infer information that is not present in the text.
    If a field cannot be grounded in the source resume, return null (or an empty list).
    """

    name: str | None = None
    email: str | None = None
    phone: str | None = None
    summary: str | None = None
    skills: list[str] = Field(default_factory=list)
    experience: list[ExperienceItem] = Field(default_factory=list)
    education: list[EducationItem] = Field(default_factory=list)
    projects: list[ProjectItem] = Field(default_factory=list)
    certifications: list[str] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)


class ResumeContentFeedback(BaseModel):
    clarity: str | None = None
    impact: str | None = None
    relevance: str | None = None


class ResumeQualityFeedback(BaseModel):
    grammar: str | None = None
    formatting: str | None = None
    conciseness: str | None = None


class ResumeATSFeedback(BaseModel):
    keyword_coverage: str | None = None
    formatting_compatibility: str | None = None
    parseable_sections: bool | None = None


class ScoreBreakdown(BaseModel):
    """0-100 sub-scores. Each must be justified by the resume content."""

    content: int = Field(ge=0, le=100, description="Substance and relevance of the experience and summary")
    impact: int = Field(ge=0, le=100, description="Quantified, outcome-focused achievements")
    ats: int = Field(ge=0, le=100, description="Keyword coverage and machine-readability")
    formatting: int = Field(ge=0, le=100, description="Structure, consistency and readability")
    skills: int = Field(ge=0, le=100, description="Breadth and relevance of listed skills")


class ResumeAnalysisOutput(BaseModel):
    """What the LLM returns. All feedback must be grounded in the resume text; if a judgement
    cannot be supported, omit it (leave as null) rather than guessing.
    """

    score: int = Field(ge=0, le=100)
    score_breakdown: ScoreBreakdown | None = None
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    content_feedback: ResumeContentFeedback
    quality_feedback: ResumeQualityFeedback
    ats_feedback: ResumeATSFeedback
    # Concrete "what to add / fix" items shown to the user and to admins.
    suggestions: list[str] = Field(default_factory=list)
    missing_keywords: list[str] = Field(default_factory=list)
    # Only when a target job is given: the job's important skills/keywords, copied from the job
    # text. Whether the resume has them is decided by code, not by the model.
    job_keywords: list[str] = Field(default_factory=list)


class JobMatch(BaseModel):
    score: int = Field(ge=0, le=100)
    matched: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)


class BulletRewrite(BaseModel):
    original: str
    improved: str
    reason: str | None = None


class ResumeAnalysis(ResumeAnalysisOutput):
    """Stored/returned analysis: the LLM output plus fields computed or generated afterwards."""

    job_match: JobMatch | None = None
    bullet_rewrites: list[BulletRewrite] | None = None


class ResumeVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    resume_id: uuid.UUID
    version_number: int
    # Exposed to the frontend as `parsed_content` (the model/DB column is `parsed_json`).
    parsed_content: dict = Field(validation_alias="parsed_json")
    is_original: bool
    source: ResumeVersionSource
    created_at: datetime


class ResumeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    title: str
    # Exposed to the frontend as `filename` (the model/DB column is `original_filename`).
    filename: str = Field(validation_alias="original_filename")
    file_type: str
    status: ResumeStatus
    created_at: datetime
    analysis: ResumeAnalysis | None = None
    analyzed_at: datetime | None = None


class ResumeDetailRead(ResumeRead):
    """`GET /api/resumes/{id}` response: the resume plus its latest parsed version inline,
    matching the frontend's expected shape (a flat resume object with a nested
    `latest_version`), rather than the `{resume, version}` wrapper used by the upload
    endpoint.
    """

    latest_version: ResumeVersionRead | None = None


class ResumeUploadResponse(BaseModel):
    resume: ResumeRead
    version: ResumeVersionRead | None = None
