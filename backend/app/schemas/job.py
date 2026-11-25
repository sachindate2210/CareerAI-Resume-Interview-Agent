from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class JobAnalysisResult(BaseModel):
    """Structured extraction schema for a job description. If a field cannot be grounded
    in the source job description, return null (or an empty list).
    """

    job_title: str | None = None
    company: str | None = None
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    experience_required: str | None = None
    responsibilities: list[str] = Field(default_factory=list)
    technologies: list[str] = Field(default_factory=list)
    education_requirements: str | None = None
    keywords: list[str] = Field(default_factory=list)


class JobCreate(BaseModel):
    title: str
    company: str
    raw_description: str
    source_url: str | None = None


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    title: str
    company: str
    raw_description: str
    source_url: str | None
    created_at: datetime
