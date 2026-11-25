"""Symmetric encryption for secrets stored in the database (AI provider API keys).

Uses Fernet (AES-128-CBC + HMAC-SHA256). The key comes from `SETTINGS_ENCRYPTION_KEY` when set
(recommended in production), otherwise it is derived from `JWT_SECRET_KEY`. Rotating whichever
key is in use makes stored secrets unreadable; callers treat that as "not configured" and fall
back to `.env`, so the admin just re-enters the key.
"""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


class DecryptionError(Exception):
    pass


@lru_cache
def _fernet() -> Fernet:
    settings = get_settings()
    if settings.SETTINGS_ENCRYPTION_KEY:
        key = settings.SETTINGS_ENCRYPTION_KEY.encode()
    else:
        digest = hashlib.sha256(f"careerai-settings:{settings.JWT_SECRET_KEY}".encode()).digest()
        key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError) as exc:
        raise DecryptionError("Stored secret could not be decrypted (encryption key changed?)") from exc


def mask(secret: str | None) -> str | None:
    """`sk-…abcd` style hint safe to show in the UI: never more than the last 4 characters."""
    if not secret:
        return None
    return f"••••••••{secret[-4:]}" if len(secret) > 8 else "••••••••"
