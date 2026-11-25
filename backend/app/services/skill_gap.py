from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm import run_structured
from app.models.match import MatchAnalysis
from app.schemas.match import CategorizedSkills
from app.schemas.skill_gap import LearningPlanResult, SkillGapResult


def categorize_missing_skills(match: MatchAnalysis) -> SkillGapResult:
    """Categorize missing skills from a persisted MatchAnalysis into critical/important/
    nice_to_have, and list the skills the candidate already has.

    - critical: required job skills entirely absent from the resume.
    - important: preferred skills absent from the resume.
    - nice_to_have: any other keyword-level gaps (kept for completeness, empty here since
      MatchAnalysis.missing_skills is already split into critical/important buckets by the
      matching engine).
    """
    missing = CategorizedSkills.model_validate(match.missing_skills)
    matched = CategorizedSkills.model_validate(match.matched_skills)

    have_skills = list(dict.fromkeys(matched.critical + matched.important + matched.nice_to_have))
    missing_by_category: dict[str, list[str]] = {
        "critical": missing.critical,
        "important": missing.important,
        "nice_to_have": missing.nice_to_have,
    }
    missing_by_category = {k: v for k, v in missing_by_category.items() if v}

    return SkillGapResult(have_skills=have_skills, missing_skills=missing_by_category)


_LEARNING_PLAN_PROMPT_TEMPLATE = """You are a career coach building a personalized week-by-week
learning plan for a job seeker preparing for a specific role.

The plan MUST be grounded strictly in the missing-skills list below — do not invent skills that
are not listed. Prioritize critical skills first, then important, then nice_to_have. Distribute
skills across a reasonable number of weeks (typically 4-8 weeks), and for each week specify the
focus, the skill it targets, its priority, and 1-3 concrete learning resources (course names, doc
sites, project ideas — general well-known resources are fine, but do not fabricate specific URLs
that may not exist; prefer resource *types* and well-known platform names, e.g. "official docs",
"a hands-on project building X", "freeCodeCamp module on Y").

Missing skills by priority:
- critical: {critical}
- important: {important}
- nice_to_have: {nice_to_have}

Skills the candidate already has (do not create plan weeks for these): {have_skills}
"""


async def generate_learning_plan(
    skill_gap: SkillGapResult,
    *,
    user_id: str | None,
    db: AsyncSession,
) -> LearningPlanResult:
    """One LLM call producing a week-by-week learning plan grounded strictly in the
    missing-skills list computed by `categorize_missing_skills`.
    """
    prompt = _LEARNING_PLAN_PROMPT_TEMPLATE.format(
        critical=skill_gap.missing_skills.get("critical", []),
        important=skill_gap.missing_skills.get("important", []),
        nice_to_have=skill_gap.missing_skills.get("nice_to_have", []),
        have_skills=skill_gap.have_skills,
    )
    return await run_structured(
        prompt,
        LearningPlanResult,
        operation="learning_plan_generate",
        user_id=user_id,
        db=db,
        prompt_version="v1",
    )
