from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class InterviewMode(str, enum.Enum):
    technical = "technical"
    behavioral = "behavioral"
    resume_based = "resume_based"
    mixed = "mixed"


class InterviewStatus(str, enum.Enum):
    in_progress = "in_progress"
    completed = "completed"
    abandoned = "abandoned"


class Interview(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "interviews"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resume_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_versions.id", ondelete="SET NULL"), nullable=True
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )
    mode: Mapped[InterviewMode] = mapped_column(SAEnum(InterviewMode, name="interview_mode"), nullable=False)
    status: Mapped[InterviewStatus] = mapped_column(
        SAEnum(InterviewStatus, name="interview_status"), default=InterviewStatus.in_progress, nullable=False
    )
    difficulty_level: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    langgraph_thread_id: Mapped[str] = mapped_column(String(255), nullable=False)

    owner: Mapped["User"] = relationship(back_populates="interviews")
    resume_version: Mapped["ResumeVersion | None"] = relationship()
    job: Mapped["Job | None"] = relationship()
    questions: Mapped[list["InterviewQuestion"]] = relationship(
        back_populates="interview", cascade="all, delete-orphan", order_by="InterviewQuestion.sequence"
    )
    evaluation: Mapped["InterviewEvaluation | None"] = relationship(
        back_populates="interview", uselist=False, cascade="all, delete-orphan"
    )


class InterviewQuestion(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "interview_questions"

    interview_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    question_type: Mapped[str] = mapped_column(String(50), nullable=False)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)

    interview: Mapped["Interview"] = relationship(back_populates="questions")
    answer: Mapped["InterviewAnswer | None"] = relationship(
        back_populates="question", uselist=False, cascade="all, delete-orphan"
    )


class InterviewAnswer(UUIDPKMixin, TimestampMixin, Base):
    """`evaluation_json` shape:
    {"correctness": ..., "depth": ..., "communication_notes": ..., "missing_points": ...,
     "better_answer": ..., "strengths": ..., "follow_up_topic": ...}
    """

    __tablename__ = "interview_answers"

    question_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("interview_questions.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    evaluation_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    question: Mapped["InterviewQuestion"] = relationship(back_populates="answer")


class InterviewEvaluation(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "interview_evaluations"

    interview_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    overall_score: Mapped[float] = mapped_column(Float, nullable=False)
    technical_score: Mapped[float] = mapped_column(Float, nullable=False)
    communication_score: Mapped[float] = mapped_column(Float, nullable=False)
    problem_solving_score: Mapped[float] = mapped_column(Float, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    resume_knowledge_score: Mapped[float] = mapped_column(Float, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    per_question_feedback: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    interview: Mapped["Interview"] = relationship(back_populates="evaluation")
