"""Admin user management: list, create, edit, delete, impersonate.

Privilege rules (enforced here, never only in the UI):
- Only super admins can grant/revoke super admin, assign roles, or touch another super admin.
- Nobody can deactivate, demote, or delete themselves, and the last super admin can't be removed.
- Impersonation needs `users:manage`, can't target super admins, can't be chained, and a
  non-super-admin may only impersonate users without an admin role.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_permission
from app.core.permissions import effective_permissions
from app.core.security import IMPERSONATION_TOKEN_MINUTES, create_impersonation_token, hash_password
from app.models.resume import Resume
from app.models.role import Role
from app.models.user import User
from app.schemas.common import Page
from app.schemas.user import RoleSummary
from app.services import table_export
from app.services.app_settings import get_general

logger = structlog.get_logger(__name__)
router = APIRouter()


class AdminUserRow(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    is_active: bool
    is_admin: bool
    role: RoleSummary | None
    created_at: datetime
    resume_count: int


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(None, max_length=255)
    is_active: bool = True
    is_admin: bool = False
    role_id: uuid.UUID | None = None


class AdminUserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(None, max_length=255)
    is_active: bool | None = None
    is_admin: bool | None = None
    role_id: uuid.UUID | None = None
    password: str | None = Field(None, min_length=8, max_length=128)


class ImpersonationResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def _row(db: AsyncSession, user: User) -> AdminUserRow:
    count = (await db.execute(select(func.count()).where(Resume.owner_id == user.id))).scalar_one()
    return AdminUserRow(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        is_admin=user.is_admin,
        role=RoleSummary.model_validate(user.role) if user.role else None,
        created_at=user.created_at,
        resume_count=count,
    )


async def _get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


async def _check_role(db: AsyncSession, role_id: uuid.UUID | None) -> None:
    if role_id is not None and await db.get(Role, role_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Role not found")


async def _email_taken(db: AsyncSession, email: str, exclude: uuid.UUID | None = None) -> bool:
    stmt = select(User.id).where(func.lower(User.email) == email.lower())
    if exclude:
        stmt = stmt.where(User.id != exclude)
    return (await db.execute(stmt)).first() is not None


async def _other_active_super_admins(db: AsyncSession, exclude: uuid.UUID) -> int:
    return (
        await db.execute(
            select(func.count()).where(User.is_admin.is_(True), User.is_active.is_(True), User.id != exclude)
        )
    ).scalar_one()


UserTab = Literal["all", "active", "inactive", "super_admin", "staff", "user"]
UserSort = Literal["created_at", "name", "email", "role", "resumes", "status"]


class UserCounts(BaseModel):
    all: int = 0
    active: int = 0
    super_admin: int = 0
    staff: int = 0
    user: int = 0
    inactive: int = 0


class AdminUserPage(Page[AdminUserRow]):
    # Per-tab totals for the current search/filters, for the tab badges.
    counts: UserCounts


_RESUME_COUNT = (
    select(func.count(Resume.id)).where(Resume.owner_id == User.id).correlate(User).scalar_subquery()
)
_USER_SORTS = {
    "created_at": User.created_at,
    "name": func.lower(func.coalesce(User.full_name, User.email)),
    "email": func.lower(User.email),
    "role": func.lower(func.coalesce(Role.name, "")),
    "resumes": _RESUME_COUNT,
    "status": User.is_active,
}
_TAB_FILTERS = {
    "super_admin": User.is_admin.is_(True),
    "staff": (User.is_admin.is_(False)) & (User.role_id.is_not(None)),
    "user": (User.is_admin.is_(False)) & (User.role_id.is_(None)),
    "active": User.is_active.is_(True),
    "inactive": User.is_active.is_(False),
}


def _user_query(q: str | None, name: str | None, email: str | None, role: str | None, role_id: uuid.UUID | None):
    """Users joined to their role, with global search and inline column filters applied."""
    stmt = select(User, Role.name.label("role_name"), _RESUME_COUNT.label("resume_count")).outerjoin(Role, User.role_id == Role.id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like), Role.name.ilike(like)))
    if name and name.strip():
        stmt = stmt.where(User.full_name.ilike(f"%{name.strip()}%"))
    if email and email.strip():
        stmt = stmt.where(User.email.ilike(f"%{email.strip()}%"))
    if role and role.strip():
        term = role.strip().lower()
        conds = [Role.name.ilike(f"%{term}%")]
        if term in "super admin":
            conds.append(User.is_admin.is_(True))
        if term in "user":
            conds.append((User.role_id.is_(None)) & (User.is_admin.is_(False)))
        stmt = stmt.where(or_(*conds))
    if role_id:
        stmt = stmt.where(User.role_id == role_id)
    return stmt


def _user_ordering(sort: str, order: str):
    column = _USER_SORTS[sort]
    return column.asc().nulls_last() if order == "asc" else column.desc().nulls_last()


def _admin_row(u: User, resume_count: int) -> AdminUserRow:
    return AdminUserRow(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        is_active=u.is_active,
        is_admin=u.is_admin,
        role=RoleSummary.model_validate(u.role) if u.role else None,
        created_at=u.created_at,
        resume_count=resume_count or 0,
    )


@router.get("", response_model=AdminUserPage)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    name: str | None = None,
    email: str | None = None,
    role: str | None = None,
    role_id: uuid.UUID | None = None,
    tab: UserTab = "all",
    sort: UserSort = "created_at",
    order: Literal["asc", "desc"] = "desc",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("users", "view")),
) -> AdminUserPage:
    base = _user_query(q, name, email, role, role_id)
    sub = base.with_only_columns(User.id, User.is_admin, User.role_id, User.is_active).subquery()
    c = sub.c
    agg = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(c.is_admin.is_(True)),
                func.count().filter(c.is_admin.is_(False), c.role_id.is_not(None)),
                func.count().filter(c.is_admin.is_(False), c.role_id.is_(None)),
                func.count().filter(c.is_active.is_(False)),
                func.count().filter(c.is_active.is_(True)),
            ).select_from(sub)
        )
    ).one()
    counts = UserCounts(all=agg[0], super_admin=agg[1], staff=agg[2], user=agg[3], inactive=agg[4], active=agg[5])

    stmt = base.where(_TAB_FILTERS[tab]) if tab != "all" else base
    rows = (
        await db.execute(
            stmt.order_by(_user_ordering(sort, order), User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    return AdminUserPage(
        items=[_admin_row(u, n) for u, _role, n in rows],
        total=getattr(counts, tab),
        page=page,
        page_size=page_size,
        counts=counts,
    )


@router.get("/export")
async def export_users(
    format: Literal["csv", "xlsx", "pdf"] = "csv",
    q: str | None = None,
    name: str | None = None,
    email: str | None = None,
    role: str | None = None,
    tab: UserTab = "all",
    sort: UserSort = "created_at",
    order: Literal["asc", "desc"] = "desc",
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("users", "view")),
) -> Response:
    stmt = _user_query(q, name, email, role, None)
    if tab != "all":
        stmt = stmt.where(_TAB_FILTERS[tab])
    rows = (await db.execute(stmt.order_by(_user_ordering(sort, order), User.created_at.desc()).limit(10_000))).all()
    general = await get_general(db)
    tz = ZoneInfo(general.timezone)
    headers = ["Name", "Email", "Role", "Status", "Resumes", "Joined"]
    data = [
        [
            u.full_name or "",
            u.email,
            "Super Admin" if u.is_admin else (role_name or "User"),
            "Active" if u.is_active else "Inactive",
            n or 0,
            u.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
        ]
        for u, role_name, n in rows
    ]
    stamp = datetime.now(tz)
    content = table_export.render(
        format,
        headers,
        data,
        title="Users",
        subtitle=f"{general.app_name} · {tab.replace('_', ' ').title()} · {len(data)} records · exported {stamp:%Y-%m-%d %H:%M} ({general.timezone})",
    )
    return Response(
        content=content,
        media_type=table_export.MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="users-{stamp:%Y%m%d-%H%M}.{format}"'},
    )


@router.get("/{user_id}", response_model=AdminUserRow)
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("users", "view")),
) -> AdminUserRow:
    return await _row(db, await _get_user(db, user_id))


@router.post("", response_model=AdminUserRow, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: AdminUserCreate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_permission("users", "create")),
) -> AdminUserRow:
    if (payload.is_admin or payload.role_id) and not actor.is_admin:
        raise _forbidden("Only a super admin can grant roles or super admin access")
    await _check_role(db, payload.role_id)
    if await _email_taken(db, payload.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=(payload.full_name or "").strip() or None,
        is_active=payload.is_active,
        is_admin=payload.is_admin,
        role_id=payload.role_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user, attribute_names=["role", "created_at"])
    logger.info("admin_user_created", actor=str(actor.id), user=str(user.id))
    return await _row(db, user)


@router.patch("/{user_id}", response_model=AdminUserRow)
async def update_user(
    user_id: uuid.UUID,
    payload: AdminUserUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_permission("users", "edit")),
) -> AdminUserRow:
    user = await _get_user(db, user_id)
    changes = payload.model_dump(exclude_unset=True)
    is_self = user.id == actor.id

    if user.is_admin and not actor.is_admin:
        raise _forbidden("Only a super admin can edit a super admin")
    if ("role_id" in changes or "is_admin" in changes) and not actor.is_admin:
        raise _forbidden("Only a super admin can change roles or super admin access")
    if is_self and changes.get("is_active") is False:
        raise _forbidden("You can't deactivate your own account")
    if is_self and changes.get("is_admin") is False:
        raise _forbidden("You can't remove your own super admin access")
    removing_super = user.is_admin and (changes.get("is_admin") is False or changes.get("is_active") is False)
    if removing_super and await _other_active_super_admins(db, user.id) == 0:
        raise _forbidden("There must be at least one active super admin")

    if "email" in changes:
        if changes["email"] is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Email is required")
        if await _email_taken(db, changes["email"], exclude=user.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
        user.email = changes["email"]
    if "full_name" in changes:
        user.full_name = (changes["full_name"] or "").strip() or None
    if changes.get("is_active") is not None:
        user.is_active = changes["is_active"]
    if changes.get("is_admin") is not None:
        user.is_admin = changes["is_admin"]
    if "role_id" in changes:
        await _check_role(db, changes["role_id"])
        user.role_id = changes["role_id"]
    if changes.get("password"):
        user.hashed_password = hash_password(changes["password"])

    await db.commit()
    await db.refresh(user, attribute_names=["role"])
    logger.info("admin_user_updated", actor=str(actor.id), user=str(user.id), fields=sorted(changes))
    return await _row(db, user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_permission("users", "delete")),
) -> Response:
    user = await _get_user(db, user_id)
    if user.id == actor.id:
        raise _forbidden("You can't delete your own account")
    if user.is_admin:
        if not actor.is_admin:
            raise _forbidden("Only a super admin can delete a super admin")
        if await _other_active_super_admins(db, user.id) == 0:
            raise _forbidden("There must be at least one active super admin")
    await db.delete(user)
    await db.commit()
    logger.info("admin_user_deleted", actor=str(actor.id), user=str(user_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/impersonate", response_model=ImpersonationResponse)
async def impersonate_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_permission("users", "manage")),
) -> ImpersonationResponse:
    if actor.impersonator is not None:
        raise _forbidden("Return to your own account before impersonating someone else")
    target = await _get_user(db, user_id)
    if target.id == actor.id:
        raise _forbidden("You can't impersonate yourself")
    if not target.is_active:
        raise _forbidden("Inactive users can't be impersonated")
    if target.is_admin:
        raise _forbidden("Super admins can't be impersonated")
    if not actor.is_admin and effective_permissions(target):
        raise _forbidden("Only a super admin can impersonate users who have admin permissions")

    logger.warning("admin_impersonation_started", actor=str(actor.id), target=str(target.id))
    return ImpersonationResponse(
        access_token=create_impersonation_token(str(target.id), str(actor.id)),
        expires_in_minutes=IMPERSONATION_TOKEN_MINUTES,
    )
