"""Admin views over anonymous public-tool usage."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_admin
from app.models.public_tool import PublicRequestStatus, PublicTool, PublicToolRequest as R
from app.schemas.common import Page
from app.schemas.public_tool import (
    PublicAnalytics,
    PublicRequestDetail,
    PublicRequestRow,
    ResumeOptimizerInput,
    UsageBucket,
    VisitorHistoryItem,
)
from app.schemas.resume import ParsedResume, ResumeAnalysis
from app.services.public_tools import file_key, run_resume_optimizer
from app.services.storage import get_storage

router = APIRouter(dependencies=[Depends(require_admin)])

# A visitor is their browser id when we have one, otherwise their hashed IP.
VISITOR_KEY = func.coalesce(R.visitor_id, R.ip_hash)
_SORTS = {"created_at": R.created_at, "score": R.score, "duration_ms": R.duration_ms, "status": R.status}


async def _visitor_counts(db: AsyncSession, keys: set[str]) -> dict[str, int]:
    if not keys:
        return {}
    rows = await db.execute(select(VISITOR_KEY, func.count()).where(VISITOR_KEY.in_(keys)).group_by(VISITOR_KEY))
    return dict(rows.all())


def _visitor_key(req: R) -> str | None:
    return req.visitor_id or req.ip_hash


def _row(req: R, counts: dict[str, int]) -> dict:
    meta = req.input_meta or {}
    parsed = req.parsed_json or {}
    key = _visitor_key(req)
    return dict(
        id=req.id,
        tool=req.tool,
        status=req.status,
        created_at=req.created_at,
        completed_at=req.completed_at,
        duration_ms=req.duration_ms,
        score=req.score,
        source=meta.get("source"),
        filename=meta.get("filename"),
        job_title=meta.get("job_title"),
        candidate_name=parsed.get("name"),
        candidate_email=parsed.get("email"),
        visitor_key=key,
        visitor_request_count=counts.get(key, 1) if key else 1,
        error_message=req.error_message,
    )


@router.get("", response_model=Page[PublicRequestRow])
async def list_requests(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = None,
    status_filter: PublicRequestStatus | None = Query(None, alias="status"),
    tool: PublicTool | None = None,
    visitor: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    sort: Literal["created_at", "score", "duration_ms", "status"] = "created_at",
    order: Literal["asc", "desc"] = "desc",
    db: AsyncSession = Depends(get_db),
) -> Page[PublicRequestRow]:
    stmt = select(R)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                R.input_meta["filename"].astext.ilike(like),
                R.input_meta["job_title"].astext.ilike(like),
                R.parsed_json["name"].astext.ilike(like),
                R.parsed_json["email"].astext.ilike(like),
                R.visitor_id.ilike(like),
            )
        )
    if status_filter:
        stmt = stmt.where(R.status == status_filter)
    if tool:
        stmt = stmt.where(R.tool == tool)
    if visitor:
        stmt = stmt.where(VISITOR_KEY == visitor)
    if date_from:
        stmt = stmt.where(R.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        stmt = stmt.where(R.created_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=timezone.utc))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    column = _SORTS[sort]
    ordering = column.asc().nulls_last() if order == "asc" else column.desc().nulls_last()
    items = (
        await db.execute(stmt.order_by(ordering, R.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()

    counts = await _visitor_counts(db, {k for k in (_visitor_key(r) for r in items) if k})
    return Page(
        items=[PublicRequestRow(**_row(r, counts)) for r in items], total=total, page=page, page_size=page_size
    )


async def _buckets(db: AsyncSession, unit: str, start: datetime) -> dict[date, tuple[int, int, int]]:
    period = func.date_trunc(unit, func.timezone("UTC", R.created_at))
    rows = await db.execute(
        select(
            period,
            func.count(),
            func.count().filter(R.status == PublicRequestStatus.completed),
            func.count().filter(R.status == PublicRequestStatus.failed),
        )
        .where(R.created_at >= start)
        .group_by(period)
    )
    return {p.date(): (t, c, f) for p, t, c, f in rows.all()}


def _series(data: dict[date, tuple[int, int, int]], periods: list[date], fmt) -> list[UsageBucket]:
    out = []
    for p in periods:
        t, c, f = data.get(p, (0, 0, 0))
        out.append(UsageBucket(period=fmt(p), total=t, completed=c, failed=f))
    return out


@router.get("/analytics", response_model=PublicAnalytics)
async def analytics(tool: PublicTool | None = None, db: AsyncSession = Depends(get_db)) -> PublicAnalytics:
    base = select(R)
    if tool:
        base = base.where(R.tool == tool)
    sub = base.subquery()

    totals = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(sub.c.status == PublicRequestStatus.completed),
                func.count().filter(sub.c.status == PublicRequestStatus.failed),
                func.avg(sub.c.score),
                func.avg(sub.c.duration_ms).filter(sub.c.status == PublicRequestStatus.completed),
            ).select_from(sub)
        )
    ).one()
    total, completed, failed, avg_score, avg_duration = totals

    per_visitor = (
        select(func.coalesce(sub.c.visitor_id, sub.c.ip_hash).label("k"), func.count().label("n"))
        .group_by("k")
        .subquery()
    )
    unique_visitors, repeat_visitors = (
        await db.execute(select(func.count(), func.count().filter(per_visitor.c.n > 1)).select_from(per_visitor))
    ).one()

    now = datetime.now(timezone.utc)
    today = now.date()
    midnight = datetime.combine(today, time.min, tzinfo=timezone.utc)

    async def since(start: datetime) -> int:
        return (await db.execute(select(func.count()).select_from(sub).where(sub.c.created_at >= start))).scalar_one()

    days = [today - timedelta(days=i) for i in range(29, -1, -1)]
    week0 = today - timedelta(days=today.weekday())
    weeks = [week0 - timedelta(weeks=i) for i in range(11, -1, -1)]
    month0 = today.replace(day=1)
    months = []
    m = month0
    for _ in range(12):
        months.append(m)
        m = (m - timedelta(days=1)).replace(day=1)
    months.reverse()

    def start_of(d: date) -> datetime:
        return datetime.combine(d, time.min, tzinfo=timezone.utc)

    return PublicAnalytics(
        total=total,
        completed=completed,
        failed=failed,
        in_progress=total - completed - failed,
        success_rate=round(completed * 100 / (completed + failed), 1) if (completed + failed) else None,
        average_score=round(float(avg_score), 1) if avg_score is not None else None,
        average_duration_ms=int(avg_duration) if avg_duration is not None else None,
        unique_visitors=unique_visitors,
        repeat_visitors=repeat_visitors,
        today=await since(midnight),
        last_7_days=await since(midnight - timedelta(days=6)),
        last_30_days=await since(midnight - timedelta(days=29)),
        daily=_series(await _buckets(db, "day", start_of(days[0])), days, lambda d: d.isoformat()),
        weekly=_series(await _buckets(db, "week", start_of(weeks[0])), weeks, lambda d: d.isoformat()),
        monthly=_series(await _buckets(db, "month", start_of(months[0])), months, lambda d: d.strftime("%Y-%m")),
    )


async def _get(db: AsyncSession, request_id: uuid.UUID) -> R:
    req = await db.get(R, request_id)
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    return req


async def _detail(db: AsyncSession, req: R) -> PublicRequestDetail:
    key = _visitor_key(req)
    history: list[VisitorHistoryItem] = []
    counts: dict[str, int] = {}
    if key:
        others = (
            await db.execute(select(R).where(VISITOR_KEY == key).order_by(R.created_at.desc()).limit(50))
        ).scalars().all()
        counts = await _visitor_counts(db, {key})
        history = [
            VisitorHistoryItem(
                id=o.id,
                status=o.status,
                created_at=o.created_at,
                score=o.score,
                filename=(o.input_meta or {}).get("filename"),
            )
            for o in others
        ]
    return PublicRequestDetail(
        **_row(req, counts),
        input=ResumeOptimizerInput(**(req.input_meta or {"source": "text"})),
        input_text=req.input_text,
        user_agent=req.user_agent,
        ip_hash=req.ip_hash[:12] if req.ip_hash else None,
        visitor_id=req.visitor_id,
        has_file=bool(req.file_path),
        parsed=ParsedResume.model_validate(req.parsed_json) if req.parsed_json else None,
        analysis=ResumeAnalysis.model_validate(req.result) if req.result else None,
        visitor_history=history,
    )


@router.get("/{request_id}", response_model=PublicRequestDetail)
async def get_request(request_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> PublicRequestDetail:
    return await _detail(db, await _get(db, request_id))


@router.get("/{request_id}/file")
async def get_request_file(request_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    req = await _get(db, request_id)
    meta = req.input_meta or {}
    if not req.file_path or not meta.get("file_type"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No file was uploaded for this request")
    try:
        content = get_storage().read(file_key(req, meta["file_type"]))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Original file not available") from exc
    media = (
        "application/pdf"
        if meta["file_type"] == "pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return Response(content=content, media_type=media, headers={"Content-Disposition": "inline"})


@router.post("/{request_id}/retry", response_model=PublicRequestDetail)
async def retry_request(request_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> PublicRequestDetail:
    req = await _get(db, request_id)
    if req.status in (PublicRequestStatus.pending, PublicRequestStatus.processing):
        raise HTTPException(status.HTTP_409_CONFLICT, "This request is still running")
    if not req.input_text and not req.file_path:
        raise HTTPException(status.HTTP_409_CONFLICT, "The original input is not available to retry")
    req = await run_resume_optimizer(db, req)
    return await _detail(db, req)


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_request(request_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    req = await _get(db, request_id)
    meta = req.input_meta or {}
    if req.file_path and meta.get("file_type"):
        try:
            get_storage().delete(file_key(req, meta["file_type"]))
        except Exception:  # noqa: BLE001
            pass
    await db.delete(req)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

