from __future__ import annotations

import hashlib

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    InvalidTokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.repositories import user_repo
from app.schemas.user import Token, UserCreate, UserLogin


class AuthError(Exception):
    """Raised for user-facing auth failures (bad credentials, invalid/expired tokens)."""


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def register_user(db: AsyncSession, payload: UserCreate) -> User:
    existing = await user_repo.get_user_by_email(db, payload.email)
    if existing is not None:
        raise AuthError("A user with this email already exists")
    hashed = hash_password(payload.password)
    return await user_repo.create_user(db, email=payload.email, hashed_password=hashed, full_name=payload.full_name)


async def issue_tokens(db: AsyncSession, user: User) -> Token:
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))
    await user_repo.create_refresh_token(db, user_id=user.id, token_hash=_hash_refresh_token(refresh_token))
    return Token(access_token=access_token, refresh_token=refresh_token)


async def login_user(db: AsyncSession, payload: UserLogin) -> Token:
    user = await user_repo.get_user_by_email(db, payload.email)
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise AuthError("Invalid email or password")
    if not user.is_active:
        raise AuthError("This account is inactive")
    return await issue_tokens(db, user)


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> Token:
    try:
        user_id = decode_token(refresh_token, expected_type="refresh")
    except InvalidTokenError as exc:
        raise AuthError(str(exc)) from exc

    token_hash = _hash_refresh_token(refresh_token)
    stored = await user_repo.get_valid_refresh_token(db, user_id=user_id, token_hash=token_hash)
    if stored is None:
        raise AuthError("Refresh token has been revoked or is invalid")

    user = await user_repo.get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise AuthError("User not found or inactive")

    # Rotate: revoke the used refresh token and issue a new pair.
    await user_repo.revoke_refresh_token(db, stored)
    return await issue_tokens(db, user)
