from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class RoleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str | None
    is_active: bool
    is_admin: bool = False
    role: RoleSummary | None = None
    created_at: datetime


class ImpersonatorInfo(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None


class MeRead(UserRead):
    """`/api/auth/me`: the user plus what they may do. The frontend uses `permissions` only to
    shape the UI — every endpoint re-checks on the server."""

    permissions: dict[str, list[str]] = Field(default_factory=dict)
    impersonator: ImpersonatorInfo | None = None


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RegisterResponse(Token):
    user: UserRead


class TokenRefresh(BaseModel):
    refresh_token: str
