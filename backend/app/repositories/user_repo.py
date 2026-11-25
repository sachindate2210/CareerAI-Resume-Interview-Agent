from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import RefreshToken, User


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID | str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, *, email: str, hashed_password: str, full_name: str | None) -> User:
    user = User(email=email, hashed_password=hashed_password, full_name=full_name)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def create_refresh_token(db: AsyncSession, *, user_id: uuid.UUID | str, token_hash: str) -> RefreshToken:
    refresh_token = RefreshToken(user_id=str(user_id), token_hash=token_hash)
    db.add(refresh_token)
    await db.commit()
    await db.refresh(refresh_token)
    return refresh_token


async def get_valid_refresh_token(db: AsyncSession, *, user_id: uuid.UUID | str, token_hash: str) -> RefreshToken | None:
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == str(user_id),
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked.is_(False),
        )
    )
    return result.scalar_one_or_none()


async def revoke_refresh_token(db: AsyncSession, refresh_token: RefreshToken) -> None:
    refresh_token.revoked = True
    await db.commit()
