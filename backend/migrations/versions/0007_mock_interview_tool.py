"""Public tool type for the free AI mock interview.

Revision ID: 0007
Revises: 0006
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE public_tool ADD VALUE IF NOT EXISTS 'mock_interview'")


def downgrade() -> None:
    # Postgres can't drop enum values; leaving it in place is harmless.
    pass
