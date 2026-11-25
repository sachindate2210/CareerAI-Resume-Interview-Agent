from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.core.permissions import effective_permissions
from app.schemas.user import (
    ImpersonatorInfo,
    MeRead,
    RegisterResponse,
    Token,
    TokenRefresh,
    UserCreate,
    UserLogin,
    UserRead,
)
from app.services.auth_service import AuthError, issue_tokens, login_user, refresh_tokens, register_user

router = APIRouter()


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> RegisterResponse:
    try:
        user = await register_user(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    tokens = await issue_tokens(db, user)
    return RegisterResponse(**tokens.model_dump(), user=UserRead.model_validate(user))


@router.get("/me", response_model=MeRead)
async def me(user: User = Depends(get_current_user)) -> MeRead:
    imp = user.impersonator
    return MeRead(
        **UserRead.model_validate(user).model_dump(),
        permissions=effective_permissions(user),
        impersonator=ImpersonatorInfo(id=imp.id, email=imp.email, full_name=imp.full_name) if imp else None,
    )


@router.post("/login", response_model=Token)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)) -> Token:
    try:
        return await login_user(db, payload)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.post("/refresh", response_model=Token)
async def refresh(payload: TokenRefresh, db: AsyncSession = Depends(get_db)) -> Token:
    try:
        return await refresh_tokens(db, payload.refresh_token)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
