from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CategorizedSkills(BaseModel):
    critical: list[str] = Field(default_factory=list)
    important: list[str] = Field(default_factory=list)
    nice_to_have: list[str] = Field(default_factory=list)


class MatchResult(BaseModel):
    """Internal result of the matching engine: deterministic scoring + LLM-authored
    rationale. `reasoning` maps each subscore name to a short, grounded explanation
    referencing only the resume/job content provided. This is what `matching_engine.py`
    produces and what gets persisted to `MatchAnalysis`; the API-facing shape returned to
    the frontend is `MatchResultOut` (below), built from a persisted row.
    """

    resume_version_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    overall_score: float = Field(ge=0, le=100)
    skills_match: float = Field(ge=0, le=100)
    experience_match: float = Field(ge=0, le=100)
    project_match: float = Field(ge=0, le=100)
    keyword_match: float = Field(ge=0, le=100)
    education_match: float = Field(ge=0, le=100)
    reasoning: dict[str, str] = Field(default_factory=dict)
    matched_skills: CategorizedSkills
    missing_skills: CategorizedSkills


class MatchSubscore(BaseModel):
    name: str
    score: float
    reasoning: str


_SUBSCORE_LABELS: dict[str, str] = {
    "skills_match": "Skills",
    "experience_match": "Experience",
    "project_match": "Project",
    "keyword_match": "Keyword",
    "education_match": "Education",
}


class MatchResultOut(BaseModel):
    """API-facing response for `POST /api/match` and `GET /api/match/{id}`."""

    id: uuid.UUID
    resume_version_id: uuid.UUID
    job_id: uuid.UUID
    overall_score: float
    subscores: list[MatchSubscore]
    matched_skills: list[str]
    missing_skills: list[str]
    created_at: datetime | None = None

    @classmethod
    def from_row(cls, match) -> "MatchResultOut":  # match: app.models.match.MatchAnalysis
        matched = CategorizedSkills.model_validate(match.matched_skills)
        missing = CategorizedSkills.model_validate(match.missing_skills)
        reasoning = match.reasoning or {}
        subscores = [
            MatchSubscore(
                name=label,
                score=getattr(match, field_name),
                reasoning=reasoning.get(field_name, ""),
            )
            for field_name, label in _SUBSCORE_LABELS.items()
        ]
        flat_matched = list(dict.fromkeys(matched.critical + matched.important + matched.nice_to_have))
        flat_missing = list(dict.fromkeys(missing.critical + missing.important + missing.nice_to_have))
        return cls(
            id=match.id,
            resume_version_id=match.resume_version_id,
            job_id=match.job_id,
            overall_score=match.overall_score,
            subscores=subscores,
            matched_skills=flat_matched,
            missing_skills=flat_missing,
            created_at=getattr(match, "created_at", None),
        )
