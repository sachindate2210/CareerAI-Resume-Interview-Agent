from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin


class User(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Super admin: every permission, plus role management. See app/core/permissions.py.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    role_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("roles.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # selectin: permissions are checked on every authenticated request.
    role: Mapped["Role | None"] = relationship(back_populates="users", lazy="selectin")

    # Set per request by `get_current_user` when this user is being impersonated; not a column.
    impersonator = None  # type: User | None

    resumes: Mapped[list["Resume"]] = relationship(back_populates="owner", cascade="all, delete-orphan")


class RefreshToken(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[str] = mapped_column(nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
