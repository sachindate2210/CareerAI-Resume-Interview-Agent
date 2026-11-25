from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Priority = Literal["critical", "important", "nice_to_have"]


class SkillGapResult(BaseModel):
    """`missing_skills` is grouped by skill category (e.g. "language", "framework",
    "cloud", "soft_skill", "tool") -> list of skill names.
    """

    have_skills: list[str] = Field(default_factory=list)
    missing_skills: dict[str, list[str]] = Field(default_factory=dict)


class LearningPlanWeek(BaseModel):
    week: int
    focus: str
    resources: list[str] = Field(default_factory=list)
    skill: str | None = None
    priority: Literal["critical", "important", "nice_to_have"] | None = None


class LearningPlanResult(BaseModel):
    weeks: list[LearningPlanWeek] = Field(default_factory=list)


# --- API-facing shapes for GET /api/match/{id}/skill-gap ---------------------------------


class SkillGapItemOut(BaseModel):
    skill: str
    priority: Priority


class LearningPlanWeekOut(BaseModel):
    week: int
    focus: str
    tasks: list[str] = Field(default_factory=list)
    resources: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    priority: Priority


class LearningPlanOut(BaseModel):
    id: str | None = None
    match_id: uuid.UUID | None = None
    weeks: list[LearningPlanWeekOut] = Field(default_factory=list)
    created_at: datetime | None = None


class SkillGapOut(BaseModel):
    """API-facing response for `GET /api/match/{id}/skill-gap` — a single flat object
    (rather than a `{skill_gap, learning_plan}` wrapper), matching the frontend contract.
    """

    id: str | None = None
    match_id: uuid.UUID
    have_skills: list[str] = Field(default_factory=list)
    missing_skills: list[SkillGapItemOut] = Field(default_factory=list)
    learning_plan: LearningPlanOut
