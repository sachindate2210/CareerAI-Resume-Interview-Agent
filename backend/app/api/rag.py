from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.llm import AIGenerationError
from app.models.user import User
from app.schemas.rag import AnswerWithCitations
from app.services.rag import answer_with_citations

logger = structlog.get_logger(__name__)
router = APIRouter()


class AskRequest(BaseModel):
    question: str
    resume_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None


@router.post("/ask", response_model=AnswerWithCitations)
async def ask(
    payload: AskRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AnswerWithCitations:
    try:
        return await answer_with_citations(
            db, user.id, payload.question, resume_id=payload.resume_id, job_id=payload.job_id, user_id=str(user.id)
        )
    except AIGenerationError as exc:
        logger.error("rag_ask_failed", error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Q&A is temporarily unavailable")
