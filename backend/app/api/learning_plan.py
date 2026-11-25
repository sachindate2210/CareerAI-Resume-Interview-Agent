from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.skill_gap import LearningPlan
from app.models.user import User
from app.schemas.skill_gap import LearningPlanResult, LearningPlanWeek

router = APIRouter()


@router.get("/{plan_id}", response_model=LearningPlanResult)
async def get_learning_plan(
    plan_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> LearningPlanResult:
    result = await db.execute(
        select(LearningPlan).where(LearningPlan.id == plan_id, LearningPlan.user_id == user.id)
    )
    plan = result.scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Learning plan not found")
    weeks = [LearningPlanWeek.model_validate(w) for w in plan.plan_json]
    return LearningPlanResult(weeks=weeks)
