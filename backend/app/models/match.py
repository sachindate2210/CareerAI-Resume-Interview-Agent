from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class MatchAnalysis(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "match_analyses"

    resume_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    overall_score: Mapped[float] = mapped_column(Float, nullable=False)
    skills_match: Mapped[float] = mapped_column(Float, nullable=False)
    experience_match: Mapped[float] = mapped_column(Float, nullable=False)
    project_match: Mapped[float] = mapped_column(Float, nullable=False)
    keyword_match: Mapped[float] = mapped_column(Float, nullable=False)
    education_match: Mapped[float] = mapped_column(Float, nullable=False)
    reasoning: Mapped[dict] = mapped_column(JSONB, nullable=False)
    matched_skills: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    missing_skills: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    resume_version: Mapped["ResumeVersion"] = relationship()
    job: Mapped["Job"] = relationship()
