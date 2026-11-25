"""Free AI mock interview (no login). Each interview is a PublicToolRequest (tool=mock_interview)
whose `result` holds the questions, answers and feedback, so admins can track usage."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.interviewer import (
    AnswerEvaluation,
    GeneratedQuestion,
    InterviewLevel,
    InterviewSummary,
    InterviewType,
    evaluate_answer,
    generate_questions,
    summarise_interview,
)
from app.core.config import get_settings
from app.core.database import get_db
from app.core.llm import AIBusyError, AIGenerationError
from app.core.rate_limit import limiter
from app.models.public_tool import PublicRequestStatus, PublicTool, PublicToolRequest
from app.schemas.resume import ParsedResume
from app.services.app_settings import get_general
from app.services.public_tools import hash_ip, input_hash, new_access_token
from app.services.resume_parser import ResumeParsingError, extract_raw_text, parse_resume_text

logger = structlog.get_logger(__name__)
router = APIRouter()
settings = get_settings()

MAX_ANSWER_CHARS = 5000
MIN_TEXT_CHARS = 200
MAX_TEXT_CHARS = 30_000


class InterviewSettings(BaseModel):
    count: Literal[5, 8, 10]
    type: InterviewType
    level: InterviewLevel


class QuestionView(BaseModel):
    index: int
    question: str
    topic: str
    kind: str
    answer: str | None = None
    skipped: bool = False
    evaluation: AnswerEvaluation | None = None


class InterviewState(BaseModel):
    id: uuid.UUID
    access_token: str
    status: PublicRequestStatus
    created_at: datetime
    settings: InterviewSettings
    candidate_name: str | None = None
    job_title: str | None = None
    total: int
    current_index: int  # == number answered; == total when finished
    questions: list[QuestionView]  # answered ones + the current one only
    overall_score: int | None = None
    summary: InterviewSummary | None = None
    error_message: str | None = None


class AnswerIn(BaseModel):
    question_index: int = Field(ge=0)
    answer: str = Field("", max_length=MAX_ANSWER_CHARS)
    skip: bool = False


def _state(req: PublicToolRequest) -> InterviewState:
    data = req.result or {}
    questions = [GeneratedQuestion.model_validate(q) for q in data.get("questions", [])]
    answers = data.get("answers", [])
    views = []
    for i, q in enumerate(questions):
        if i > len(answers):
            break  # don't reveal upcoming questions
        a = answers[i] if i < len(answers) else None
        views.append(
            QuestionView(
                index=i,
                question=q.question,
                topic=q.topic,
                kind=q.kind,
                answer=a.get("answer") if a else None,
                skipped=bool(a and a.get("skipped")),
                evaluation=AnswerEvaluation.model_validate(a["evaluation"]) if a and a.get("evaluation") else None,
            )
        )
    meta = req.input_meta or {}
    parsed = req.parsed_json or {}
    return InterviewState(
        id=req.id,
        access_token=req.access_token,
        status=req.status,
        created_at=req.created_at,
        settings=InterviewSettings.model_validate(data.get("settings") or {"count": 5, "type": "mixed", "level": "mid"}),
        candidate_name=parsed.get("name"),
        job_title=meta.get("job_title"),
        total=len(questions),
        current_index=min(len(answers), len(questions)),
        questions=views,
        overall_score=data.get("overall_score"),
        summary=InterviewSummary.model_validate(data["summary"]) if data.get("summary") else None,
        error_message=req.error_message,
    )


async def _owned(db: AsyncSession, request_id: uuid.UUID, token: str, *, tool: PublicTool | None = PublicTool.mock_interview) -> PublicToolRequest:
    req = await db.get(PublicToolRequest, request_id)
    if req is None or not secrets.compare_digest(req.access_token, token) or (tool and req.tool != tool):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interview not found or link expired.")
    return req


def _clean(value: str | None, limit: int, field: str) -> str | None:
    value = (value or "").strip()
    if len(value) > limit:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} must be at most {limit} characters.")
    return value or None


@router.post("", response_model=InterviewState)
@limiter.limit(settings.PUBLIC_RATE_LIMIT)
async def start_interview(
    request: Request,
    file: UploadFile | None = File(None),
    resume_text: str | None = Form(None),
    from_request_id: uuid.UUID | None = Form(None),
    from_token: str | None = Form(None),
    job_title: str | None = Form(None),
    job_description: str | None = Form(None),
    count: int = Form(5),
    interview_type: str = Form("mixed"),
    level: str = Form("mid"),
    visitor_id: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
) -> InterviewState:
    general = await get_general(db)
    if not general.public_optimizer_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Free tools are temporarily unavailable.")
    try:
        cfg = InterviewSettings(count=count, type=interview_type, level=level)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose 5, 8 or 10 questions, a valid type and level.") from exc

    job_title = _clean(job_title, 200, "Job title")
    job_description = _clean(job_description, 10_000, "Job description")
    visitor_id = (visitor_id or "").strip()[:64] or None
    resume_text = (resume_text or "").strip() or None

    parsed: ParsedResume | None = None
    raw_text: str | None = None
    meta: dict = {}

    if from_request_id:
        # Reuse a resume the visitor already submitted (e.g. from their optimizer report).
        source = await _owned(db, from_request_id, from_token or "", tool=None)
        if not source.parsed_json:
            raise HTTPException(status.HTTP_409_CONFLICT, "That resume hasn't been read yet.")
        parsed = ParsedResume.model_validate(source.parsed_json)
        raw_text = source.input_text
        src_meta = source.input_meta or {}
        job_title = job_title or src_meta.get("job_title")
        job_description = job_description or src_meta.get("job_description")
        meta.update(source="report", filename=src_meta.get("filename"))
    elif bool(file and file.filename) == bool(resume_text):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Upload a resume file or paste your resume text.")
    elif resume_text:
        if not (MIN_TEXT_CHARS <= len(resume_text) <= MAX_TEXT_CHARS):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Paste your full resume ({MIN_TEXT_CHARS}-{MAX_TEXT_CHARS} characters).")
        raw_text = resume_text
        meta["source"] = "text"
    else:
        filename = file.filename or "resume"
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if f".{ext}" not in settings.ALLOWED_RESUME_EXTENSIONS:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only PDF and DOCX files are supported.")
        data = await file.read()
        if not data or len(data) > general.max_upload_mb * 1024 * 1024:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"File must be between 1 byte and {general.max_upload_mb}MB.")
        try:
            raw_text = extract_raw_text(data, ext)
        except ResumeParsingError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
        meta.update(source="file", filename=filename[:255], file_type=ext)

    meta.update(job_title=job_title, job_description=job_description)
    ip = hash_ip(get_remote_address(request))
    digest = input_hash(raw_text or (parsed.model_dump_json() if parsed else ""), job_title, job_description, f"{cfg.count}-{cfg.type}-{cfg.level}")

    # Double-click guard: same input from the same visitor in the last 2 minutes.
    recent = (
        await db.execute(
            select(PublicToolRequest)
            .where(
                PublicToolRequest.tool == PublicTool.mock_interview,
                PublicToolRequest.input_hash == digest,
                PublicToolRequest.created_at >= datetime.now(timezone.utc) - timedelta(minutes=2),
                PublicToolRequest.status != PublicRequestStatus.failed,
                (PublicToolRequest.visitor_id == visitor_id) if visitor_id else (PublicToolRequest.ip_hash == ip),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if recent is not None:
        return _state(recent)

    req = PublicToolRequest(
        tool=PublicTool.mock_interview,
        status=PublicRequestStatus.processing,
        access_token=new_access_token(),
        visitor_id=visitor_id,
        ip_hash=ip,
        user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        input_hash=digest,
        input_meta=meta,
        input_text=raw_text,
        parsed_json=parsed.model_dump(mode="json") if parsed else None,
        result={"settings": cfg.model_dump(), "questions": [], "answers": []},
    )
    db.add(req)
    await db.commit()
    await db.refresh(req)

    try:
        if parsed is None:
            parsed = await parse_resume_text(raw_text or "", user_id=None, db=db)
            req.parsed_json = parsed.model_dump(mode="json")
        questions = await generate_questions(
            parsed, count=cfg.count, interview_type=cfg.type, level=cfg.level, job_title=job_title, job_description=job_description, db=db
        )
        if not questions:
            raise AIGenerationError("No questions generated")
        req.result = {"settings": cfg.model_dump(), "questions": [q.model_dump() for q in questions], "answers": []}
    except ResumeParsingError as exc:
        req.status, req.error_message = PublicRequestStatus.failed, str(exc)
    except AIBusyError:
        req.status, req.error_message = PublicRequestStatus.failed, "Our AI interviewer is very busy right now. Please try again in a minute."
    except AIGenerationError as exc:
        logger.error("interview_start_failed", request_id=str(req.id), error=str(exc))
        req.status, req.error_message = PublicRequestStatus.failed, "We couldn't prepare your interview. Please try again."
    await db.commit()
    await db.refresh(req)
    return _state(req)


@router.get("/{request_id}", response_model=InterviewState)
async def get_interview(request_id: uuid.UUID, token: str, db: AsyncSession = Depends(get_db)) -> InterviewState:
    return _state(await _owned(db, request_id, token))


@router.post("/{request_id}/answer", response_model=InterviewState)
@limiter.limit("30/minute")
async def answer_question(
    request: Request, request_id: uuid.UUID, token: str, payload: AnswerIn, db: AsyncSession = Depends(get_db)
) -> InterviewState:
    req = await _owned(db, request_id, token)
    data = req.result or {}
    questions = [GeneratedQuestion.model_validate(q) for q in data.get("questions", [])]
    answered = len(data.get("answers", []))
    if req.status == PublicRequestStatus.failed or not questions:
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview couldn't be started. Please start a new one.")
    if payload.question_index < answered:
        return _state(req)  # already answered (double submit) — just return the current state
    if payload.question_index > answered or answered >= len(questions):
        raise HTTPException(status.HTTP_409_CONFLICT, "That question isn't the current one.")

    text = payload.answer.strip()
    skipped = payload.skip or not text
    if skipped:
        evaluation = AnswerEvaluation(
            score=0,
            verdict="Skipped.",
            strengths=[],
            improvements=["Try answering even briefly; a partial answer beats none in a real interview."],
            better_answer="",
        )
    else:
        cfg = InterviewSettings.model_validate(data["settings"])
        try:
            evaluation = await evaluate_answer(
                questions[answered], text, parsed=ParsedResume.model_validate(req.parsed_json or {}), level=cfg.level, db=db
            )
        except AIBusyError as exc:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Our AI interviewer is very busy. Please submit again in a minute.") from exc
        except AIGenerationError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Couldn't evaluate your answer. Please submit again.") from exc

    # Re-read under a row lock: another submit may have landed while we waited for the AI.
    await db.refresh(req, with_for_update=True)
    data = dict(req.result or {})
    answers = list(data.get("answers", []))
    if len(answers) != payload.question_index:
        await db.commit()
        return _state(req)
    answers.append({"answer": text if not payload.skip else "", "skipped": skipped, "evaluation": evaluation.model_dump()})
    data["answers"] = answers

    if len(answers) >= len(questions):
        scores = [a["evaluation"]["score"] for a in answers]
        data["overall_score"] = round(sum(scores) * 10 / len(scores))
        req.score = data["overall_score"]
        req.status = PublicRequestStatus.completed
        req.completed_at = datetime.now(timezone.utc)
        req.result = data
        await db.commit()  # save answers even if the summary call fails
        try:
            cfg = InterviewSettings.model_validate(data["settings"])
            summary = await summarise_interview(
                [(q.question, a["evaluation"]["score"], a["evaluation"]["verdict"]) for q, a in zip(questions, answers)],
                interview_type=cfg.type,
                level=cfg.level,
                job_title=(req.input_meta or {}).get("job_title"),
                db=db,
            )
            req.result = {**data, "summary": summary.model_dump()}
        except AIGenerationError as exc:
            logger.warning("interview_summary_failed", request_id=str(req.id), error=str(exc))
    else:
        req.result = data
    await db.commit()
    await db.refresh(req)
    return _state(req)
