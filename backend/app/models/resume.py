from __future__ import annotations

import enum
import uuid

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class ResumeStatus(str, enum.Enum):
    pending = "pending"
    parsed = "parsed"
    failed = "failed"


class ResumeVersionSource(str, enum.Enum):
    original = "original"
    ai_optimized = "ai_optimized"
    manual_edit = "manual_edit"


class Resume(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "resumes"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[ResumeStatus] = mapped_column(
        SAEnum(ResumeStatus, name="resume_status"), default=ResumeStatus.pending, nullable=False
    )
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Latest optimizer result (ResumeAnalysis JSON); persisted so admins can view it later.
    analysis: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped["User"] = relationship(back_populates="resumes")
    versions: Mapped[list["ResumeVersion"]] = relationship(
        back_populates="resume", cascade="all, delete-orphan", foreign_keys="ResumeVersion.resume_id"
    )


class ResumeVersion(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "resume_versions"

    resume_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parsed_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_original: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[ResumeVersionSource] = mapped_column(
        SAEnum(ResumeVersionSource, name="resume_version_source"),
        default=ResumeVersionSource.original,
        nullable=False,
    )

    resume: Mapped["Resume"] = relationship(back_populates="versions", foreign_keys=[resume_id])
