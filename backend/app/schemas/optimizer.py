from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class OptimizeRequest(BaseModel):
    resume_version_id: uuid.UUID
    job_id: uuid.UUID
    sections: list[str] | None = None


class SectionRewrite(BaseModel):
    """The optimizer must never introduce a skill, employer, title, metric, or
    credential not present in the source resume JSON. `after` is validated against the
    source resume's named entities before being accepted.
    """

    section: str
    before: str
    after: str
    rationale: str | None = None


class OptimizeResult(BaseModel):
    resume_version_id: uuid.UUID
    job_id: uuid.UUID
    sections: list[SectionRewrite] = Field(default_factory=list)
