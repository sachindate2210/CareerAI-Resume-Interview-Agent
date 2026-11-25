import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _create_token(
    subject: str,
    expires_delta: timedelta,
    token_type: Literal["access", "refresh"],
    extra: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    # `jti` keeps tokens unique even when issued for the same user within the same second;
    # refresh tokens are looked up by hash, so duplicates would break rotation.
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        "jti": uuid.uuid4().hex,
        **(extra or {}),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: str) -> str:
    return _create_token(user_id, timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES), "access")


def create_refresh_token(user_id: str) -> str:
    return _create_token(user_id, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS), "refresh")


IMPERSONATION_TOKEN_MINUTES = 30


def create_impersonation_token(target_user_id: str, impersonator_id: str) -> str:
    """Short-lived access token for `target_user_id` that records who is acting (`imp`).
    No refresh token is ever issued for it, so the session ends when it expires."""
    return _create_token(
        target_user_id,
        timedelta(minutes=IMPERSONATION_TOKEN_MINUTES),
        "access",
        extra={"imp": impersonator_id},
    )


class InvalidTokenError(Exception):
    pass


def decode_token(token: str, expected_type: Literal["access", "refresh"] = "access") -> str:
    return decode_token_payload(token, expected_type)["sub"]


def decode_token_payload(token: str, expected_type: Literal["access", "refresh"] = "access") -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise InvalidTokenError("Invalid or expired token") from exc
    if payload.get("type") != expected_type:
        raise InvalidTokenError("Unexpected token type")
    if not payload.get("sub"):
        raise InvalidTokenError("Malformed token")
    return payload
