"""Golden-file style eval: fixed input -> assert the LLM output schema validates and key
invariants hold. Makes a real Anthropic API call, so it's skipped unless ANTHROPIC_API_KEY is set.
"""

from __future__ import annotations

import os

import pytest

from app.agents.resume_analyzer import analyze_resume
from app.core.database import AsyncSessionLocal

pytestmark = pytest.mark.llm


def _has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


@pytest.mark.asyncio
async def test_weak_resume_flags_weaknesses(sample_weak_resume):
    if not _has_api_key():
        pytest.skip("ANTHROPIC_API_KEY not set; skipping real LLM eval test.")

    async with AsyncSessionLocal() as db:
        analysis = await analyze_resume(sample_weak_resume, user_id=None, db=db)

    assert 0 <= analysis.score <= 100
    # A resume with no summary, no skills, no metrics, and weak verbs should score low and
    # surface concrete weaknesses (not an empty list).
    assert analysis.score < 60
    assert len(analysis.weaknesses) > 0


@pytest.mark.asyncio
async def test_strong_resume_scores_reasonably_well(sample_parsed_resume):
    if not _has_api_key():
        pytest.skip("ANTHROPIC_API_KEY not set; skipping real LLM eval test.")

    async with AsyncSessionLocal() as db:
        analysis = await analyze_resume(sample_parsed_resume, user_id=None, db=db)

    assert 0 <= analysis.score <= 100
    assert analysis.score >= 50
    assert isinstance(analysis.strengths, list)
