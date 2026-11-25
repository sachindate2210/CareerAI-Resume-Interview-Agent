from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class PublicTool(str, enum.Enum):
    """Free, no-login tools. Add a member here to track a new public tool in the same table."""

    resume_optimizer = "resume_optimizer"
    mock_interview = "mock_interview"


class PublicRequestStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class PublicToolRequest(UUIDPKMixin, TimestampMixin, Base):
    """One anonymous usage of a public tool. Visitors are identified only by a random
    browser-generated `visitor_id` and a salted hash of their IP — never by raw IP."""

    __tablename__ = "public_tool_requests"

    tool: Mapped[PublicTool] = mapped_column(SAEnum(PublicTool, name="public_tool"), nullable=False, index=True)
    status: Mapped[PublicRequestStatus] = mapped_column(
        SAEnum(PublicRequestStatus, name="public_request_status"),
        default=PublicRequestStatus.pending,
        nullable=False,
        index=True,
    )
    # Secret handed back to the submitter so only they (and admins) can re-open the result.
    access_token: Mapped[str] = mapped_column(String(64), nullable=False)

    visitor_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # sha256 of the normalized input; used to dedupe double submissions.
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Tool-specific input/output. For the resume optimizer: source, filename, job details, etc.
    input_meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    parsed_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
