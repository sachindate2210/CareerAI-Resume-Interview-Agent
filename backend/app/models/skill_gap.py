from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class LearningPlan(UUIDPKMixin, TimestampMixin, Base):
    """`plan_json` is a list of entries shaped like:
    {"week": int, "focus": str, "resources": list[str], "skill": str,
     "priority": "critical" | "important" | "nice_to_have"}
    """

    __tablename__ = "learning_plans"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    match_analysis_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("match_analyses.id", ondelete="SET NULL"), nullable=True
    )
    plan_json: Mapped[list] = mapped_column(JSONB, nullable=False)

    user: Mapped["User"] = relationship()
    match_analysis: Mapped["MatchAnalysis | None"] = relationship()
