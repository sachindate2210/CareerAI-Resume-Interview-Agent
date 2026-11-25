"""Golden-file style eval for the final interview evaluation LLM call. Makes a real Anthropic
API call, so it's skipped unless ANTHROPIC_API_KEY is set.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest

from app.agents.interview_evaluator import evaluate_interview
from app.core.database import AsyncSessionLocal
from app.models.interview import Interview, InterviewAnswer, InterviewMode, InterviewQuestion, InterviewStatus

pytestmark = pytest.mark.llm


def _has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _build_transcript() -> tuple[Interview, list[InterviewQuestion]]:
    interview = Interview(
        id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        mode=InterviewMode.technical,
        status=InterviewStatus.completed,
        difficulty_level=3,
        langgraph_thread_id=str(uuid.uuid4()),
    )
    q1 = InterviewQuestion(
        id=uuid.uuid4(),
        interview_id=interview.id,
        sequence=1,
        question="What is the time complexity of binary search, and why?",
        topic="data structures & algorithms",
        question_type="technical",
        difficulty=2,
    )
    q1.answer = InterviewAnswer(
        id=uuid.uuid4(),
        question_id=q1.id,
        answer_text=(
            "Binary search is O(log n) because each comparison halves the remaining search "
            "space, so after k steps the space is n / 2^k, and we stop when that's 1."
        ),
        submitted_at=datetime.now(timezone.utc),
        evaluation_json={"correctness": "correct", "strengths": ["explained the halving argument"], "missing_points": []},
    )
    q2 = InterviewQuestion(
        id=uuid.uuid4(),
        interview_id=interview.id,
        sequence=2,
        question="How would you design a URL shortener at scale?",
        topic="system design",
        question_type="technical",
        difficulty=4,
    )
    q2.answer = InterviewAnswer(
        id=uuid.uuid4(),
        question_id=q2.id,
        answer_text="I would use a hash of the URL and store it in a database, maybe with some caching.",
        submitted_at=datetime.now(timezone.utc),
        evaluation_json={
            "correctness": "partially correct",
            "strengths": ["mentioned hashing and caching"],
            "missing_points": ["no discussion of sharding, collision handling, or read/write scaling"],
        },
    )
    return interview, [q1, q2]


@pytest.mark.asyncio
async def test_interview_evaluation_grounded_in_transcript():
    if not _has_api_key():
        pytest.skip("ANTHROPIC_API_KEY not set; skipping real LLM eval test.")

    interview, questions = _build_transcript()
    async with AsyncSessionLocal() as db:
        evaluation = await evaluate_interview(db, interview, questions, user_id=None)

    for score in (
        evaluation.overall_score,
        evaluation.technical_score,
        evaluation.communication_score,
        evaluation.problem_solving_score,
        evaluation.confidence_score,
        evaluation.resume_knowledge_score,
    ):
        assert 0 <= score <= 100

    assert len(evaluation.summary) > 0
    assert len(evaluation.per_question_feedback) == 2
