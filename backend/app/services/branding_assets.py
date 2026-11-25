"""Uploaded branding images (logos, favicon, loader): validation and storage."""

from __future__ import annotations

import secrets

from app.services.storage import get_storage

MAX_ASSET_BYTES = 2 * 1024 * 1024
PREFIX = "branding/"

# extension -> content type. SVG is allowed but always served with a locked-down CSP.
TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "svg": "image/svg+xml",
    "ico": "image/x-icon",
}
ALLOWED = {
    "logo": {"png", "jpg", "jpeg", "webp", "svg"},
    "logo_dark": {"png", "jpg", "jpeg", "webp", "svg"},
    "favicon": {"png", "ico", "svg"},
    "loader": {"gif", "svg", "png", "webp"},
}

# Magic bytes for raster formats, so a renamed file can't masquerade as an image.
_SIGNATURES = {
    "png": [b"\x89PNG\r\n\x1a\n"],
    "jpg": [b"\xff\xd8\xff"],
    "jpeg": [b"\xff\xd8\xff"],
    "gif": [b"GIF87a", b"GIF89a"],
    "ico": [b"\x00\x00\x01\x00"],
}


class AssetError(Exception):
    pass


def validate(asset: str, filename: str, data: bytes) -> str:
    """Return the normalized extension or raise AssetError with a user-safe message."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    allowed = ALLOWED[asset]
    if ext not in allowed:
        raise AssetError(f"Unsupported file type. Allowed: {', '.join(sorted(allowed)).upper()}.")
    if not data:
        raise AssetError("The file is empty.")
    if len(data) > MAX_ASSET_BYTES:
        raise AssetError("Image must be 2 MB or smaller.")
    if ext in _SIGNATURES and not any(data.startswith(sig) for sig in _SIGNATURES[ext]):
        raise AssetError("The file content doesn't match its extension.")
    if ext == "webp" and not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        raise AssetError("The file content doesn't match its extension.")
    if ext == "svg":
        head = data[:2048].decode("utf-8", errors="ignore").lower()
        if "<svg" not in head:
            raise AssetError("That doesn't look like a valid SVG file.")
    return ext


def save(asset: str, ext: str, data: bytes) -> str:
    key = f"{PREFIX}{asset}-{secrets.token_hex(6)}.{ext}"
    get_storage().save(data, key)
    return key


def delete(key: str | None) -> None:
    if key and key.startswith(PREFIX):
        try:
            get_storage().delete(key)
        except Exception:  # noqa: BLE001 - stale file cleanup is best effort
            pass


def read(name: str) -> tuple[bytes, str]:
    """Read a public asset by file name (no path segments)."""
    if "/" in name or "\\" in name or ".." in name:
        raise FileNotFoundError(name)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in TYPES:
        raise FileNotFoundError(name)
    return get_storage().read(PREFIX + name), TYPES[ext]


def public_url(key: str | None) -> str | None:
    return f"/api/settings/assets/{key.removeprefix(PREFIX)}" if key else None
