"""Roles + permission matrix. Super admin only: anyone able to edit roles could grant
themselves anything, so this is deliberately not itself a grantable permission."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

import structlog
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_super_admin
from app.core.permissions import ACTIONS, MODULES, normalize_permissions
from app.models.role import Role
from app.models.user import User
from app.services import table_export
from app.services.app_settings import get_general

logger = structlog.get_logger(__name__)
router = APIRouter(dependencies=[Depends(require_super_admin)])


class ModuleInfo(BaseModel):
    key: str
    label: str
    actions: list[str]


class PermissionCatalog(BaseModel):
    actions: list[str]
    modules: list[ModuleInfo]


class RoleRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    permissions: dict[str, list[str]]
    user_count: int
    is_active: bool
    created_at: datetime


class RoleWrite(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(None, max_length=500)
    permissions: dict[str, list[str]] = Field(default_factory=dict)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Name must be at least 2 characters")
        return v


async def _read(db: AsyncSession, role: Role) -> RoleRead:
    count = (await db.execute(select(func.count()).where(User.role_id == role.id))).scalar_one()
    return RoleRead(
        id=role.id,
        name=role.name,
        description=role.description,
        permissions=normalize_permissions(role.permissions),
        user_count=count,
        created_at=role.created_at,
        is_active=role.is_active,
    )


async def _name_taken(db: AsyncSession, name: str, exclude: uuid.UUID | None = None) -> bool:
    stmt = select(Role.id).where(func.lower(Role.name) == name.lower())
    if exclude:
        stmt = stmt.where(Role.id != exclude)
    return (await db.execute(stmt)).first() is not None


async def _get(db: AsyncSession, role_id: uuid.UUID) -> Role:
    role = await db.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    return role


@router.get("/catalog", response_model=PermissionCatalog)
async def catalog() -> PermissionCatalog:
    return PermissionCatalog(
        actions=list(ACTIONS),
        modules=[ModuleInfo(key=k, label=label, actions=list(acts)) for k, (label, acts) in MODULES.items()],
    )


@router.get("", response_model=list[RoleRead])
async def list_roles(db: AsyncSession = Depends(get_db)) -> list[RoleRead]:
    rows = (
        await db.execute(
            select(Role, func.count(User.id)).outerjoin(User, User.role_id == Role.id).group_by(Role.id).order_by(Role.name)
        )
    ).all()
    return [
        RoleRead(
            id=r.id,
            name=r.name,
            description=r.description,
            permissions=normalize_permissions(r.permissions),
            user_count=n,
            created_at=r.created_at,
            is_active=r.is_active,
        )
        for r, n in rows
    ]


@router.post("", response_model=RoleRead, status_code=status.HTTP_201_CREATED)
async def create_role(payload: RoleWrite, db: AsyncSession = Depends(get_db)) -> RoleRead:
    if await _name_taken(db, payload.name):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A role with this name already exists")
    role = Role(
        name=payload.name,
        description=(payload.description or "").strip() or None,
        permissions=normalize_permissions(payload.permissions),
        is_active=payload.is_active,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    logger.info("role_created", role=str(role.id))
    return await _read(db, role)


@router.put("/{role_id}", response_model=RoleRead)
async def update_role(role_id: uuid.UUID, payload: RoleWrite, db: AsyncSession = Depends(get_db)) -> RoleRead:
    role = await _get(db, role_id)
    if await _name_taken(db, payload.name, exclude=role.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A role with this name already exists")
    role.name = payload.name
    role.description = (payload.description or "").strip() or None
    role.permissions = normalize_permissions(payload.permissions)
    role.is_active = payload.is_active
    await db.commit()
    await db.refresh(role)
    logger.info("role_updated", role=str(role.id))
    return await _read(db, role)


@router.delete("/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_role(role_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    role = await _get(db, role_id)
    assigned = (await db.execute(select(func.count()).where(User.role_id == role.id))).scalar_one()
    if assigned:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This role is assigned to {assigned} user{'s' if assigned != 1 else ''}. Reassign them first.",
        )
    await db.delete(role)
    await db.commit()
    logger.info("role_deleted", role=str(role_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/export")
async def export_roles(
    format: Literal["csv", "xlsx", "pdf"] = "csv",
    q: str | None = None,
    tab: Literal["all", "active", "inactive"] = "all",
    db: AsyncSession = Depends(get_db),
) -> Response:
    rows = (
        await db.execute(
            select(Role, func.count(User.id)).outerjoin(User, User.role_id == Role.id).group_by(Role.id).order_by(Role.name)
        )
    ).all()
    term = (q or "").strip().lower()
    labels = {k: label for k, (label, _) in MODULES.items()}

    def summary(perms: dict) -> str:
        parts = []
        for module, actions in normalize_permissions(perms).items():
            parts.append(f"{labels.get(module, module)}: {'Full' if 'manage' in actions else ', '.join(a.title() for a in actions)}")
        return "; ".join(parts) or "No admin access"

    general = await get_general(db)
    tz = ZoneInfo(general.timezone)
    data = [
        [
            r.name,
            r.description or "",
            summary(r.permissions),
            "Active" if r.is_active else "Inactive",
            n,
            r.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
        ]
        for r, n in rows
        if (not term or term in r.name.lower() or term in (r.description or "").lower())
        and (tab == "all" or r.is_active == (tab == "active"))
    ]
    # Built-in Super Admin (per-user flag, not a roles row) leads the export, like the UI table.
    if tab in ("all", "active") and (not term or term in "super admin"):
        supers = (await db.execute(select(func.count()).where(User.is_admin.is_(True)))).scalar_one()
        data.insert(0, ["Super Admin", "Built-in · full access", "All modules: Full", "Active", supers, "System"])
    stamp = datetime.now(tz)
    content = table_export.render(
        format,
        ["Role", "Description", "Permissions", "Status", "Users", "Created"],
        data,
        title="Roles",
        subtitle=f"{general.app_name} · {len(data)} roles · exported {stamp:%Y-%m-%d %H:%M} ({general.timezone})",
    )
    return Response(
        content=content,
        media_type=table_export.MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="roles-{stamp:%Y%m%d-%H%M}.{format}"'},
    )
