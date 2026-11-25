from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.public_tool import PublicRequestStatus, PublicTool
from app.schemas.resume import ParsedResume, ResumeAnalysis


class ResumeOptimizerInput(BaseModel):
    """What the guest submitted (minus the raw resume text)."""

    source: str  # "file" | "text"
    filename: str | None = None
    file_type: str | None = None
    job_title: str | None = None
    job_description: str | None = None


class PublicResumeResult(BaseModel):
    """Public response. Only returned to the submitter (who holds `access_token`)."""

    id: uuid.UUID
    access_token: str
    status: PublicRequestStatus
    created_at: datetime
    completed_at: datetime | None = None
    input: ResumeOptimizerInput
    parsed: ParsedResume | None = None
    analysis: ResumeAnalysis | None = None
    error_message: str | None = None
    # True when an identical recent submission was found and its result returned instead.
    deduplicated: bool = False


# ---------- Admin ----------


class PublicRequestRow(BaseModel):
    id: uuid.UUID
    tool: PublicTool
    status: PublicRequestStatus
    created_at: datetime
    completed_at: datetime | None
    duration_ms: int | None
    score: int | None
    source: str | None
    filename: str | None
    job_title: str | None
    candidate_name: str | None
    candidate_email: str | None
    visitor_key: str | None
    visitor_request_count: int
    error_message: str | None


class VisitorHistoryItem(BaseModel):
    id: uuid.UUID
    status: PublicRequestStatus
    created_at: datetime
    score: int | None
    filename: str | None


class PublicRequestDetail(PublicRequestRow):
    input: ResumeOptimizerInput
    input_text: str | None
    user_agent: str | None
    ip_hash: str | None
    visitor_id: str | None
    has_file: bool
    parsed: ParsedResume | None
    analysis: ResumeAnalysis | None
    visitor_history: list[VisitorHistoryItem] = Field(default_factory=list)


class UsageBucket(BaseModel):
    period: str
    total: int
    completed: int
    failed: int


class PublicAnalytics(BaseModel):
    total: int
    completed: int
    failed: int
    in_progress: int
    success_rate: float | None
    average_score: float | None
    average_duration_ms: int | None
    unique_visitors: int
    repeat_visitors: int
    today: int
    last_7_days: int
    last_30_days: int
    daily: list[UsageBucket]
    weekly: list[UsageBucket]
    monthly: list[UsageBucket]
