import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agents.interview_evaluator import evaluate_interview
from app.agents.interview_graph import CompletionEvent, QuestionEvent, get_max_questions, start_interview, submit_answer
from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.core.llm import AIGenerationError
from app.core.rate_limit import limiter
from app.core.security import InvalidTokenError, decode_token
from app.models.interview import Interview, InterviewEvaluation, InterviewQuestion, InterviewStatus
from app.models.job import Job, JobAnalysis
from app.models.resume import Resume, ResumeVersion
from app.models.user import User
from app.repositories import user_repo
from app.schemas.interview import (
    AnswerSubmit,
    InterviewCreate,
    InterviewEvaluationOut,
    WSCompleteMessage,
    WSErrorMessage,
    WSEvaluatingMessage,
    WSEvaluationMessage,
)

logger = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()


def _question_out(q: InterviewQuestion, index: int) -> dict:
    return {
        "id": str(q.id),
        "index": index,
        "question": q.question,
        "topic": q.topic,
        "type": q.question_type,
    }


def _interview_out(interview: Interview, questions: list[InterviewQuestion], *, max_questions: int) -> dict:
    """Flat interview state shape consumed by the frontend (`InterviewRead` in
    `types/api.ts`): the interview fields plus its question/answer history and the
    currently-pending question, if any.
    """
    q_list: list[dict] = []
    a_list: list[dict] = []
    current_question: dict | None = None
    for idx, q in enumerate(questions):
        qout = _question_out(q, idx)
        q_list.append(qout)
        if q.answer is not None:
            a_list.append({"question_id": str(q.id), "answer_text": q.answer.answer_text})
        else:
            current_question = qout

    return {
        "id": str(interview.id),
        "user_id": str(interview.owner_id),
        "mode": interview.mode.value,
        "status": interview.status.value,
        "resume_version_id": str(interview.resume_version_id) if interview.resume_version_id else None,
        "job_id": str(interview.job_id) if interview.job_id else None,
        "num_questions": max_questions,
        "questions": q_list,
        "answers": a_list,
        "current_question": current_question,
        "created_at": interview.created_at.isoformat(),
    }


async def _get_owned_interview(db: AsyncSession, interview_id: uuid.UUID, owner_id: uuid.UUID) -> Interview:
    result = await db.execute(select(Interview).where(Interview.id == interview_id, Interview.owner_id == owner_id))
    interview = result.scalar_one_or_none()
    if interview is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")
    return interview


async def _get_questions(db: AsyncSession, interview_id: uuid.UUID) -> list[InterviewQuestion]:
    result = await db.execute(
        select(InterviewQuestion)
        .options(selectinload(InterviewQuestion.answer))
        .where(InterviewQuestion.interview_id == interview_id)
        .order_by(InterviewQuestion.sequence)
    )
    return list(result.scalars().unique().all())


async def _resolve_contexts(
    db: AsyncSession, resume_version_id: uuid.UUID | None, job_id: uuid.UUID | None
) -> tuple[dict | None, dict | None]:
    resume_context = None
    job_context = None
    if resume_version_id is not None:
        result = await db.execute(select(ResumeVersion).where(ResumeVersion.id == resume_version_id))
        version = result.scalar_one_or_none()
        if version is not None:
            resume_context = version.parsed_json
    if job_id is not None:
        result = await db.execute(select(JobAnalysis).where(JobAnalysis.job_id == job_id))
        analysis = result.scalar_one_or_none()
        if analysis is not None:
            job_context = analysis.extracted_json
    return resume_context, job_context


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def create_interview(
    request: Request,
    payload: InterviewCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if payload.resume_version_id is not None:
        owned = await db.execute(
            select(ResumeVersion)
            .join(Resume, ResumeVersion.resume_id == Resume.id)
            .where(ResumeVersion.id == payload.resume_version_id, Resume.owner_id == user.id)
        )
        if owned.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resume version not found")
    if payload.job_id is not None:
        owned_job = await db.execute(select(Job).where(Job.id == payload.job_id, Job.owner_id == user.id))
        if owned_job.scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    interview = Interview(
        owner_id=user.id,
        resume_version_id=payload.resume_version_id,
        job_id=payload.job_id,
        mode=payload.mode,
        status=InterviewStatus.in_progress,
        difficulty_level=3,
        langgraph_thread_id=str(uuid.uuid4()),
    )
    db.add(interview)
    await db.commit()
    await db.refresh(interview)

    resume_context, job_context = await _resolve_contexts(db, payload.resume_version_id, payload.job_id)

    try:
        event = await start_interview(
            db, interview, resume_context=resume_context, job_context=job_context, user_id=str(user.id)
        )
    except AIGenerationError as exc:
        logger.error("interview_start_failed", interview_id=str(interview.id), error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not start the interview right now")

    questions = await _get_questions(db, interview.id)
    max_questions = get_max_questions(interview.mode, resume_context, job_context)
    return _interview_out(interview, questions, max_questions=max_questions)


@router.get("/{interview_id}", response_model=dict)
async def get_interview(
    interview_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    interview = await _get_owned_interview(db, interview_id, user.id)
    questions = await _get_questions(db, interview.id)
    resume_context, job_context = await _resolve_contexts(db, interview.resume_version_id, interview.job_id)
    max_questions = get_max_questions(interview.mode, resume_context, job_context)
    return _interview_out(interview, questions, max_questions=max_questions)


@router.post("/{interview_id}/answer", response_model=dict)
@limiter.limit(settings.RATE_LIMIT_DEFAULT)
async def answer_interview(
    request: Request,
    interview_id: uuid.UUID,
    payload: AnswerSubmit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    interview = await _get_owned_interview(db, interview_id, user.id)
    if interview.status != InterviewStatus.in_progress:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Interview is not in progress")

    questions = await _get_questions(db, interview.id)
    resume_context, job_context = await _resolve_contexts(db, interview.resume_version_id, interview.job_id)

    try:
        event = await submit_answer(
            db,
            interview,
            questions,
            payload.answer_text,
            resume_context=resume_context,
            job_context=job_context,
            user_id=str(user.id),
        )
    except AIGenerationError as exc:
        logger.error("interview_answer_failed", interview_id=str(interview_id), error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not evaluate the answer right now")

    if isinstance(event, CompletionEvent):
        interview.status = InterviewStatus.completed
        await db.commit()
        questions = await _get_questions(db, interview.id)
        evaluation = await evaluate_interview(db, interview, questions, user_id=str(user.id))
        eval_row = InterviewEvaluation(
            interview_id=interview.id,
            overall_score=evaluation.overall_score,
            technical_score=evaluation.technical_score,
            communication_score=evaluation.communication_score,
            problem_solving_score=evaluation.problem_solving_score,
            confidence_score=evaluation.confidence_score,
            resume_knowledge_score=evaluation.resume_knowledge_score,
            summary=evaluation.summary,
            per_question_feedback=[qf.model_dump(mode="json") for qf in evaluation.question_feedback],
        )
        db.add(eval_row)
        await db.commit()
        return {"type": "complete", "evaluation": evaluation.model_dump(mode="json")}

    return {"type": "question", "question": event.question.model_dump(mode="json")}


@router.post("/{interview_id}/complete", response_model=InterviewEvaluationOut)
async def complete_interview(
    interview_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InterviewEvaluationOut:
    interview = await _get_owned_interview(db, interview_id, user.id)
    questions = await _get_questions(db, interview.id)

    existing = await db.execute(select(InterviewEvaluation).where(InterviewEvaluation.interview_id == interview.id))
    existing_row = existing.scalar_one_or_none()
    if existing_row is not None:
        return InterviewEvaluationOut(
            interview_id=interview.id,
            overall_score=existing_row.overall_score,
            technical_score=existing_row.technical_score,
            communication_score=existing_row.communication_score,
            problem_solving_score=existing_row.problem_solving_score,
            confidence_score=existing_row.confidence_score,
            resume_knowledge_score=existing_row.resume_knowledge_score,
            summary=existing_row.summary,
            question_feedback=existing_row.per_question_feedback,
        )

    try:
        evaluation = await evaluate_interview(db, interview, questions, user_id=str(user.id))
    except AIGenerationError as exc:
        logger.error("interview_complete_failed", interview_id=str(interview_id), error=str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not evaluate the interview right now")

    interview.status = InterviewStatus.completed
    eval_row = InterviewEvaluation(
        interview_id=interview.id,
        overall_score=evaluation.overall_score,
        technical_score=evaluation.technical_score,
        communication_score=evaluation.communication_score,
        problem_solving_score=evaluation.problem_solving_score,
        confidence_score=evaluation.confidence_score,
        resume_knowledge_score=evaluation.resume_knowledge_score,
        summary=evaluation.summary,
        per_question_feedback=[qf.model_dump(mode="json") for qf in evaluation.question_feedback],
    )
    db.add(eval_row)
    await db.commit()
    return evaluation


@router.websocket("/{interview_id}/ws")
async def interview_ws(websocket: WebSocket, interview_id: uuid.UUID) -> None:
    """WS message protocol (see docs/API.md): client sends {"type":"answer","text":...};
    server sends question/evaluating/evaluation/complete/error messages.
    """
    token = websocket.query_params.get("token")
    await websocket.accept()

    async with AsyncSessionLocal() as db:
        if not token:
            await websocket.send_json(WSErrorMessage(detail="Missing auth token").model_dump())
            await websocket.close()
            return
        try:
            user_id = decode_token(token, expected_type="access")
        except InvalidTokenError:
            await websocket.send_json(WSErrorMessage(detail="Invalid or expired token").model_dump())
            await websocket.close()
            return

        user = await user_repo.get_user_by_id(db, user_id)
        if user is None:
            await websocket.send_json(WSErrorMessage(detail="User not found").model_dump())
            await websocket.close()
            return

        try:
            interview = await _get_owned_interview(db, interview_id, user.id)
        except HTTPException:
            await websocket.send_json(WSErrorMessage(detail="Interview not found").model_dump())
            await websocket.close()
            return

        try:
            while True:
                message = await websocket.receive_json()
                if message.get("type") != "answer":
                    await websocket.send_json(WSErrorMessage(detail="Expected message of type 'answer'").model_dump())
                    continue

                answer_text = message.get("text", "")
                if interview.status != InterviewStatus.in_progress:
                    await websocket.send_json(WSErrorMessage(detail="Interview is not in progress").model_dump())
                    continue

                questions = await _get_questions(db, interview.id)
                pending_question = next((q for q in questions if q.answer is None), None)
                if pending_question is None:
                    await websocket.send_json(WSErrorMessage(detail="No question is awaiting an answer").model_dump())
                    continue

                await websocket.send_json(WSEvaluatingMessage(question_id=pending_question.id).model_dump(mode="json"))

                resume_context, job_context = await _resolve_contexts(db, interview.resume_version_id, interview.job_id)

                try:
                    event = await submit_answer(
                        db, interview, questions, answer_text,
                        resume_context=resume_context, job_context=job_context, user_id=str(user.id),
                    )
                except AIGenerationError as exc:
                    logger.error("interview_ws_answer_failed", interview_id=str(interview_id), error=str(exc))
                    await websocket.send_json(WSErrorMessage(detail="Could not evaluate the answer right now").model_dump())
                    continue

                answered_questions = await _get_questions(db, interview.id)
                answered_pending = next((q for q in answered_questions if q.id == pending_question.id), None)
                if answered_pending is not None and answered_pending.answer is not None:
                    await websocket.send_json(
                        WSEvaluationMessage(
                            question_id=answered_pending.id,
                            evaluation=answered_pending.answer.evaluation_json,
                        ).model_dump(mode="json")
                    )

                if isinstance(event, CompletionEvent):
                    interview.status = InterviewStatus.completed
                    await db.commit()
                    final_questions = await _get_questions(db, interview.id)
                    evaluation = await evaluate_interview(db, interview, final_questions, user_id=str(user.id))
                    eval_row = InterviewEvaluation(
                        interview_id=interview.id,
                        overall_score=evaluation.overall_score,
                        technical_score=evaluation.technical_score,
                        communication_score=evaluation.communication_score,
                        problem_solving_score=evaluation.problem_solving_score,
                        confidence_score=evaluation.confidence_score,
                        resume_knowledge_score=evaluation.resume_knowledge_score,
                        summary=evaluation.summary,
                        per_question_feedback=[qf.model_dump(mode="json") for qf in evaluation.question_feedback],
                    )
                    db.add(eval_row)
                    await db.commit()
                    await websocket.send_json(WSCompleteMessage(evaluation=evaluation).model_dump(mode="json"))
                    await websocket.close()
                    return

                max_questions = get_max_questions(interview.mode, resume_context, job_context)
                await websocket.send_json(
                    {
                        "type": "question",
                        "question": {
                            "id": str(event.question.id),
                            "index": event.question.sequence - 1,
                            "question": event.question.question,
                            "topic": event.question.topic,
                            "type": event.question.question_type,
                        },
                        "index": event.question.sequence - 1,
                        "total": max_questions,
                    }
                )
        except WebSocketDisconnect:
            logger.info("interview_ws_disconnected", interview_id=str(interview_id))
