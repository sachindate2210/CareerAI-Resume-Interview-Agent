from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_permission
from app.models.ai_log import AIGenerationLog, AIGenerationStatus
from app.models.public_tool import PublicTool, PublicToolRequest
from app.models.resume import Resume, ResumeStatus, ResumeVersion
from app.models.role import Role
from app.models.user import User
from app.schemas.common import Page
from app.schemas.resume import ResumeDetailRead, ResumeRead, ResumeVersionRead
from app.services import table_export
from app.services.app_settings import get_general
from app.services.storage import get_storage

router = APIRouter()

_SCORE = cast(Resume.analysis["score"].astext, Float)


class OwnerInfo(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None


class AdminResumeRow(BaseModel):
    id: uuid.UUID
    title: str
    filename: str
    file_type: str
    status: ResumeStatus
    score: float | None
    analyzed_at: datetime | None
    created_at: datetime
    owner: OwnerInfo


class AdminResumeDetail(ResumeDetailRead):
    owner: OwnerInfo


class DayCount(BaseModel):
    date: str
    count: int


class ScoreBucket(BaseModel):
    label: str
    count: int


class AdminStats(BaseModel):
    total_resumes: int
    total_users: int
    parsed: int
    failed: int
    analyzed: int
    average_score: float | None
    last_7_days: int
    uploads_per_day: list[DayCount]
    score_distribution: list[ScoreBucket]
    recent: list[AdminResumeRow]
    pending: int = 0
    active_users: int = 0
    new_users_7_days: int = 0
    roles: int = 0
    guest_runs: int = 0
    guest_runs_7_days: int = 0
    interviews: int = 0
    interviews_7_days: int = 0
    # Trends (14 days, oldest first) and previous-week totals for the "vs last week" deltas.
    users_per_day: list[DayCount] = []
    guest_per_day: list[DayCount] = []
    analyzed_per_day: list[DayCount] = []
    prev_7_days: int = 0
    prev_new_users_7_days: int = 0
    prev_guest_runs_7_days: int = 0
    ai: "AIUsage | None" = None


class AIUsage(BaseModel):
    calls_7_days: int
    success_rate: float | None
    avg_latency_ms: int | None
    tokens_7_days: int
    failed_7_days: int
    calls_per_day: list[dict]  # {date, success, failed}
    top_operations: list[dict]  # {operation, count}



AdminStats.model_rebuild()


def _row(resume: Resume, owner: User) -> AdminResumeRow:
    score = (resume.analysis or {}).get("score")
    return AdminResumeRow(
        id=resume.id,
        title=resume.title,
        filename=resume.original_filename,
        file_type=resume.file_type,
        status=resume.status,
        score=score,
        analyzed_at=resume.analyzed_at,
        created_at=resume.created_at,
        owner=OwnerInfo(id=owner.id, email=owner.email, full_name=owner.full_name),
    )


@router.get("/stats", response_model=AdminStats, dependencies=[Depends(require_permission("dashboard", "view"))])
async def stats(db: AsyncSession = Depends(get_db)) -> AdminStats:
    total_resumes = (await db.execute(select(func.count()).select_from(Resume))).scalar_one()
    total_users = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    by_status = dict((await db.execute(select(Resume.status, func.count()).group_by(Resume.status))).all())
    analyzed = (
        await db.execute(select(func.count()).select_from(Resume).where(Resume.analysis.is_not(None)))
    ).scalar_one()
    avg = (await db.execute(select(func.avg(_SCORE)).where(Resume.analysis.is_not(None)))).scalar_one()

    since = datetime.now(timezone.utc) - timedelta(days=13)
    day = func.date(Resume.created_at)
    per_day = dict(
        (await db.execute(select(day, func.count()).where(Resume.created_at >= since).group_by(day))).all()
    )
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    uploads = [DayCount(date=d.isoformat(), count=per_day.get(d, 0)) for d in days]

    scores = (await db.execute(select(_SCORE).where(Resume.analysis.is_not(None)))).scalars().all()
    buckets = [("0-39", 0, 40), ("40-59", 40, 60), ("60-79", 60, 80), ("80-100", 80, 101)]
    distribution = [
        ScoreBucket(label=label, count=sum(1 for s in scores if lo <= s < hi)) for label, lo, hi in buckets
    ]

    recent_rows = (
        await db.execute(
            select(Resume, User).join(User, Resume.owner_id == User.id).order_by(Resume.created_at.desc()).limit(5)
        )
    ).all()

    async def per_day_counts(created_col, *conds) -> list[DayCount]:
        d = func.date(created_col)
        rows = dict(
            (await db.execute(select(d, func.count()).where(created_col >= since, *conds).group_by(d))).all()
        )
        return [DayCount(date=x.isoformat(), count=rows.get(x, 0)) for x in days]

    users_per_day = await per_day_counts(User.created_at)
    guest_per_day = await per_day_counts(PublicToolRequest.created_at, PublicToolRequest.tool == PublicTool.resume_optimizer)
    analyzed_per_day = await per_day_counts(Resume.analyzed_at, Resume.analyzed_at.is_not(None))

    # AI usage, from the metadata-only audit log every LLM call writes.
    week_start = datetime.now(timezone.utc) - timedelta(days=7)
    L = AIGenerationLog
    ai_row = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(L.status == AIGenerationStatus.failed),
                func.avg(L.latency_ms).filter(L.status != AIGenerationStatus.failed),
                func.coalesce(func.sum(func.coalesce(L.input_tokens, 0) + func.coalesce(L.output_tokens, 0)), 0),
            ).where(L.created_at >= week_start)
        )
    ).one()
    ai_calls, ai_failed, ai_latency, ai_tokens = ai_row
    ld = func.date(L.created_at)
    ai_days = {
        d: (ok, bad)
        for d, ok, bad in (
            await db.execute(
                select(ld, func.count().filter(L.status != AIGenerationStatus.failed), func.count().filter(L.status == AIGenerationStatus.failed))
                .where(L.created_at >= since)
                .group_by(ld)
            )
        ).all()
    }
    top_ops = (
        await db.execute(
            select(L.operation, func.count()).where(L.created_at >= week_start).group_by(L.operation).order_by(func.count().desc()).limit(5)
        )
    ).all()
    ai_usage = AIUsage(
        calls_7_days=ai_calls,
        failed_7_days=ai_failed,
        success_rate=round((ai_calls - ai_failed) * 100 / ai_calls, 1) if ai_calls else None,
        avg_latency_ms=int(ai_latency) if ai_latency is not None else None,
        tokens_7_days=int(ai_tokens or 0),
        calls_per_day=[{"date": x.isoformat(), "success": ai_days.get(x, (0, 0))[0], "failed": ai_days.get(x, (0, 0))[1]} for x in days],
        top_operations=[{"operation": op, "count": n} for op, n in top_ops],
    )

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active_users = (await db.execute(select(func.count()).select_from(User).where(User.is_active.is_(True)))).scalar_one()
    new_users = (await db.execute(select(func.count()).select_from(User).where(User.created_at >= week_ago))).scalar_one()
    roles = (await db.execute(select(func.count()).select_from(Role))).scalar_one()
    is_optimizer = PublicToolRequest.tool == PublicTool.resume_optimizer
    is_interview = PublicToolRequest.tool == PublicTool.mock_interview
    guest_runs = (await db.execute(select(func.count()).select_from(PublicToolRequest).where(is_optimizer))).scalar_one()
    interviews = (await db.execute(select(func.count()).select_from(PublicToolRequest).where(is_interview))).scalar_one()
    interviews_week = (
        await db.execute(select(func.count()).select_from(PublicToolRequest).where(is_interview, PublicToolRequest.created_at >= week_start))
    ).scalar_one()
    guest_week = (
        await db.execute(select(func.count()).select_from(PublicToolRequest).where(is_optimizer, PublicToolRequest.created_at >= week_ago))
    ).scalar_one()

    def prev_week(series: list[DayCount]) -> int:
        return sum(c.count for c in series[:7])

    return AdminStats(
        users_per_day=users_per_day,
        guest_per_day=guest_per_day,
        analyzed_per_day=analyzed_per_day,
        prev_7_days=prev_week(uploads),
        prev_new_users_7_days=prev_week(users_per_day),
        prev_guest_runs_7_days=prev_week(guest_per_day),
        ai=ai_usage,
        pending=by_status.get(ResumeStatus.pending, 0),
        active_users=active_users,
        new_users_7_days=new_users,
        roles=roles,
        guest_runs=guest_runs,
        interviews=interviews,
        interviews_7_days=interviews_week,
        guest_runs_7_days=guest_week,
        total_resumes=total_resumes,
        total_users=total_users,
        parsed=by_status.get(ResumeStatus.parsed, 0),
        failed=by_status.get(ResumeStatus.failed, 0),
        analyzed=analyzed,
        average_score=round(float(avg), 1) if avg is not None else None,
        last_7_days=sum(c.count for c in uploads[-7:]),
        uploads_per_day=uploads,
        score_distribution=distribution,
        recent=[_row(r, u) for r, u in recent_rows],
    )


class StatusCounts(BaseModel):
    all: int = 0
    parsed: int = 0
    failed: int = 0
    pending: int = 0


class AdminResumePage(Page[AdminResumeRow]):
    # Per-status totals for the current search (ignoring the status filter), for the tabs.
    counts: StatusCounts


_RESUME_SORTS = {
    "created_at": Resume.created_at,
    "filename": func.lower(Resume.original_filename),
    "user": func.lower(func.coalesce(User.full_name, User.email)),
    "status": Resume.status,
    "score": _SCORE,
}


def _resume_query(q: str | None, filename: str | None, user: str | None):
    """Base select for the resumes table with the global search + inline column filters."""
    stmt = select(Resume, User).join(User, Resume.owner_id == User.id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Resume.original_filename.ilike(like), User.email.ilike(like), User.full_name.ilike(like)))
    if filename and filename.strip():
        stmt = stmt.where(Resume.original_filename.ilike(f"%{filename.strip()}%"))
    if user and user.strip():
        like = f"%{user.strip()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.full_name.ilike(like)))
    return stmt


def _resume_ordering(sort: str, order: str):
    column = _RESUME_SORTS[sort]
    return column.asc().nulls_last() if order == "asc" else column.desc().nulls_last()


@router.get("/resumes", response_model=AdminResumePage, dependencies=[Depends(require_permission("resumes", "view"))])
async def list_resumes(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    filename: str | None = None,
    user: str | None = None,
    status_filter: ResumeStatus | None = Query(None, alias="status"),
    sort: Literal["created_at", "filename", "user", "status", "score"] = "created_at",
    order: Literal["asc", "desc"] = "desc",
    db: AsyncSession = Depends(get_db),
) -> AdminResumePage:
    """Server-side data table: global search (`q`), inline column filters (`filename`, `user`),
    status tab, sorting and pagination."""
    base = _resume_query(q, filename, user)
    sub = base.subquery()
    by_status = dict((await db.execute(select(sub.c.status, func.count()).group_by(sub.c.status))).all())
    counts = StatusCounts(
        all=sum(by_status.values()),
        parsed=by_status.get(ResumeStatus.parsed, 0),
        failed=by_status.get(ResumeStatus.failed, 0),
        pending=by_status.get(ResumeStatus.pending, 0),
    )

    stmt = base.where(Resume.status == status_filter) if status_filter else base
    total = getattr(counts, status_filter.value) if status_filter else counts.all
    rows = (
        await db.execute(
            stmt.order_by(_resume_ordering(sort, order), Resume.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    return AdminResumePage(
        items=[_row(r, u) for r, u in rows], total=total, page=page, page_size=page_size, counts=counts
    )


EXPORT_LIMIT = 10_000


@router.get("/resumes/export", dependencies=[Depends(require_permission("resumes", "view"))])
async def export_resumes(
    format: Literal["csv", "xlsx", "pdf"] = "csv",
    q: str | None = None,
    filename: str | None = None,
    user: str | None = None,
    status_filter: ResumeStatus | None = Query(None, alias="status"),
    sort: Literal["created_at", "filename", "user", "status", "score"] = "created_at",
    order: Literal["asc", "desc"] = "desc",
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Every row matching the current table filters (up to EXPORT_LIMIT), not just one page."""
    stmt = _resume_query(q, filename, user)
    if status_filter:
        stmt = stmt.where(Resume.status == status_filter)
    rows = (await db.execute(stmt.order_by(_resume_ordering(sort, order), Resume.created_at.desc()).limit(EXPORT_LIMIT))).all()

    general = await get_general(db)
    tz = ZoneInfo(general.timezone)
    headers = ["Resume", "User name", "User email", "Status", "Score", "Uploaded"]
    data = [
        [
            r.original_filename,
            u.full_name or "",
            u.email,
            r.status.value,
            (r.analysis or {}).get("score"),
            r.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M"),
        ]
        for r, u in rows
    ]
    stamp = datetime.now(tz)
    scope = f"Status: {status_filter.value}" if status_filter else "All statuses"
    content = table_export.render(
        format,
        headers,
        data,
        title="Resumes",
        subtitle=f"{general.app_name} · {scope} · {len(data)} records · exported {stamp:%Y-%m-%d %H:%M} ({general.timezone})",
    )
    name = f"resumes-{stamp:%Y%m%d-%H%M}.{format}"
    return Response(
        content=content,
        media_type=table_export.MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


async def _get_resume(db: AsyncSession, resume_id: uuid.UUID) -> tuple[Resume, User]:
    row = (
        await db.execute(select(Resume, User).join(User, Resume.owner_id == User.id).where(Resume.id == resume_id))
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume not found")
    return row[0], row[1]


@router.get(
    "/resumes/{resume_id}", response_model=AdminResumeDetail, dependencies=[Depends(require_permission("resumes", "view"))]
)
async def get_resume(resume_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> AdminResumeDetail:
    resume, owner = await _get_resume(db, resume_id)
    version = (
        await db.execute(
            select(ResumeVersion)
            .where(ResumeVersion.resume_id == resume.id)
            .order_by(ResumeVersion.version_number.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return AdminResumeDetail(
        **ResumeRead.model_validate(resume).model_dump(),
        latest_version=ResumeVersionRead.model_validate(version) if version else None,
        owner=OwnerInfo(id=owner.id, email=owner.email, full_name=owner.full_name),
    )


@router.get("/resumes/{resume_id}/file", dependencies=[Depends(require_permission("resumes", "view"))])
async def download_resume_file(resume_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    resume, _ = await _get_resume(db, resume_id)
    try:
        content = get_storage().read(f"resumes/{resume.id}/original.{resume.file_type}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original file not available") from exc
    media = (
        "application/pdf"
        if resume.file_type == "pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{resume.original_filename}"'},
    )


@router.delete(
    "/resumes/{resume_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("resumes", "delete"))],
)
async def delete_resume(resume_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    resume, _ = await _get_resume(db, resume_id)
    await db.delete(resume)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

