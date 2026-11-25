"""Slim down to resume optimizer + admin: drop jobs/interviews/RAG tables, add admin + analysis.

Revision ID: 0002
Revises: 0001
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DROPPED_TABLES = [
    "document_chunks", "documents", "interview_evaluations", "interview_answers",
    "interview_questions", "interviews", "learning_plans", "match_analyses",
    "job_skills", "resume_skills", "skills", "job_analyses",
]
_DROPPED_ENUMS = ["document_type", "interview_status", "interview_mode", "skill_importance"]


def upgrade() -> None:
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("resumes", sa.Column("analysis", postgresql.JSONB(), nullable=True))
    op.add_column("resumes", sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=True))

    for table in _DROPPED_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    op.execute("ALTER TABLE resume_versions DROP COLUMN IF EXISTS tailored_for_job_id")
    op.execute("DROP TABLE IF EXISTS jobs CASCADE")
    for enum in _DROPPED_ENUMS:
        op.execute(f"DROP TYPE IF EXISTS {enum}")


def downgrade() -> None:
    raise NotImplementedError("Dropped feature tables are not restorable; downgrade to 0001 on a fresh DB.")
