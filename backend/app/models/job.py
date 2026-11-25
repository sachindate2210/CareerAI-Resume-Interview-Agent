from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class Job(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "jobs"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    company: Mapped[str] = mapped_column(String(255), nullable=False)
    raw_description: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    owner: Mapped["User"] = relationship(back_populates="jobs")
    analysis: Mapped["JobAnalysis | None"] = relationship(
        back_populates="job", uselist=False, cascade="all, delete-orphan"
    )


class JobAnalysis(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "job_analyses"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    extracted_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    must_have_skills: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    nice_to_have_skills: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    keywords: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    job: Mapped["Job"] = relationship(back_populates="analysis")
