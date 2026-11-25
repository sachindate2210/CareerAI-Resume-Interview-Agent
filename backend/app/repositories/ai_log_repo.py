from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_log import AIGenerationLog, AIGenerationStatus


async def create_ai_generation_log(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | str | None,
    operation: str,
    model: str,
    prompt_version: str,
    latency_ms: int,
    status: AIGenerationStatus,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    error_message: str | None = None,
) -> AIGenerationLog:
    log = AIGenerationLog(
        user_id=user_id,
        operation=operation,
        model=model,
        prompt_version=prompt_version,
        latency_ms=latency_ms,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        status=status,
        error_message=error_message,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return log
