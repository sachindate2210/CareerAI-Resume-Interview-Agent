"""Guest (no-login) public tool requests, starting with the resume optimizer.

Revision ID: 0003
Revises: 0002
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    public_tool = postgresql.ENUM("resume_optimizer", name="public_tool", create_type=False)
    status = postgresql.ENUM("pending", "processing", "completed", "failed", name="public_request_status", create_type=False)
    public_tool.create(bind, checkfirst=True)
    status.create(bind, checkfirst=True)

    op.create_table(
        "public_tool_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tool", public_tool, nullable=False),
        sa.Column("status", status, nullable=False, server_default="pending"),
        sa.Column("access_token", sa.String(64), nullable=False),
        sa.Column("visitor_id", sa.String(64), nullable=True),
        sa.Column("ip_hash", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(512), nullable=True),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("input_meta", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("input_text", sa.Text(), nullable=True),
        sa.Column("file_path", sa.String(1024), nullable=True),
        sa.Column("parsed_json", postgresql.JSONB(), nullable=True),
        sa.Column("result", postgresql.JSONB(), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    for col in ("tool", "status", "visitor_id", "ip_hash", "input_hash", "score", "created_at"):
        op.create_index(f"ix_public_tool_requests_{col}", "public_tool_requests", [col])


def downgrade() -> None:
    op.drop_table("public_tool_requests")
    postgresql.ENUM(name="public_request_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="public_tool").drop(op.get_bind(), checkfirst=True)
