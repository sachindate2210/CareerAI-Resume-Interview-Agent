from __future__ import annotations

import enum
import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class SkillImportance(str, enum.Enum):
    required = "required"
    preferred = "preferred"


class Skill(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "skills"

    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(50), nullable=False)


class ResumeSkill(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "resume_skills"

    resume_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)

    resume_version: Mapped["ResumeVersion"] = relationship()
    skill: Mapped["Skill"] = relationship()


class JobSkill(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "job_skills"

    job_analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_analyses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    importance: Mapped[SkillImportance] = mapped_column(
        SAEnum(SkillImportance, name="skill_importance"), nullable=False
    )

    job_analysis: Mapped["JobAnalysis"] = relationship()
    skill: Mapped["Skill"] = relationship()
