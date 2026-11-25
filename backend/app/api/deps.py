from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import has_permission
from app.core.security import InvalidTokenError, decode_token_payload
from app.models.user import User
from app.repositories import user_repo

__all__ = ["get_db", "get_current_user", "require_admin", "require_permission", "require_super_admin"]

_bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token_payload(credentials.credentials, expected_type="access")
    except InvalidTokenError as exc:
        raise unauthorized from exc

    user = await user_repo.get_user_by_id(db, payload["sub"])
    if user is None or not user.is_active:
        raise unauthorized

    # Impersonation: the token names the acting admin. Re-check them on every request so
    # revoking/deactivating the admin ends the impersonated session immediately.
    user.impersonator = None
    if imp_id := payload.get("imp"):
        impersonator = await user_repo.get_user_by_id(db, imp_id)
        if impersonator is None or not impersonator.is_active or not has_permission(impersonator, "users", "manage"):
            raise unauthorized
        user.impersonator = impersonator
    return user


def require_permission(module: str, action: str) -> Callable:
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if not has_permission(user, module, action):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have permission to do this")
        return user

    return dependency


async def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return user


# Back-compat alias: "admin" means super admin.
require_admin = require_super_admin
