from __future__ import annotations

import re
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm import run_structured
from app.schemas.job import JobAnalysisResult
from app.schemas.match import CategorizedSkills, MatchResult
from app.schemas.resume import ParsedResume

# ---------------------------------------------------------------------------
# Text normalization helpers
# ---------------------------------------------------------------------------

_STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
    "as", "at", "by", "be", "this", "that", "will", "you", "your", "we", "our", "it",
    "from", "into", "using", "use", "years", "year", "experience", "strong", "ability",
    "team", "work", "working", "etc",
}

_WORD_PATTERN = re.compile(r"[a-zA-Z][a-zA-Z0-9+#./-]*")


def _normalize_token(token: str) -> str:
    """Lowercase and strip a small set of trailing suffixes for crude stemming."""
    t = token.lower().strip()
    for suffix in ("ing", "ed", "es", "s"):
        if len(t) > len(suffix) + 2 and t.endswith(suffix):
            t = t[: -len(suffix)]
            break
    return t


def _tokenize(text: str) -> set[str]:
    return {_normalize_token(m.group(0)) for m in _WORD_PATTERN.finditer(text)} - _STOPWORDS


def _normalize_skill(skill: str) -> str:
    return re.sub(r"[^a-z0-9+#.]", "", skill.lower().strip())


# ---------------------------------------------------------------------------
# Skill extraction from resume text (skills field + implied by experience/project bullets)
# ---------------------------------------------------------------------------


def _resume_full_text(resume: ParsedResume) -> str:
    parts: list[str] = []
    if resume.summary:
        parts.append(resume.summary)
    parts.extend(resume.skills)
    for exp in resume.experience:
        if exp.title:
            parts.append(exp.title)
        parts.extend(exp.bullets)
    for proj in resume.projects:
        if proj.name:
            parts.append(proj.name)
        if proj.description:
            parts.append(proj.description)
        parts.extend(proj.technologies)
        parts.extend(proj.bullets)
    for edu in resume.education:
        if edu.degree:
            parts.append(edu.degree)
        if edu.field:
            parts.append(edu.field)
    parts.extend(resume.certifications)
    parts.extend(resume.achievements)
    return "\n".join(parts)


def _extract_resume_skill_set(resume: ParsedResume) -> set[str]:
    """Skills explicitly listed, plus skills implied by experience/project bullets via
    simple keyword extraction (normalized token overlap against the skill's own tokens).
    """
    explicit = {_normalize_skill(s) for s in resume.skills if s}
    bullet_text = " ".join(
        b for exp in resume.experience for b in exp.bullets
    ) + " " + " ".join(
        b for proj in resume.projects for b in proj.bullets
    ) + " " + " ".join(t for proj in resume.projects for t in proj.technologies)
    bullet_tokens = _tokenize(bullet_text)
    implied = {tok for tok in bullet_tokens if len(tok) > 1}
    return explicit | implied


# ---------------------------------------------------------------------------
# Skills match
# ---------------------------------------------------------------------------


def _skills_match(resume: ParsedResume, job: JobAnalysisResult) -> tuple[float, CategorizedSkills, CategorizedSkills]:
    resume_skill_tokens = _extract_resume_skill_set(resume)
    resume_skill_norm = {_normalize_skill(s) for s in resume.skills if s}

    required = [s for s in job.required_skills if s]
    preferred = [s for s in job.preferred_skills if s]

    matched_required: list[str] = []
    missing_required: list[str] = []
    matched_preferred: list[str] = []
    missing_preferred: list[str] = []

    def _is_present(skill: str) -> bool:
        norm = _normalize_skill(skill)
        if not norm:
            return False
        if norm in resume_skill_norm:
            return True
        skill_tokens = _tokenize(skill)
        # A multi-word skill counts as present if all its meaningful tokens appear in the
        # resume's skill/experience/project token set, or the normalized form is a substring
        # match of an explicit resume skill (handles e.g. "React.js" vs "react").
        if skill_tokens and skill_tokens.issubset(resume_skill_tokens):
            return True
        return any(norm in s or s in norm for s in resume_skill_norm if len(norm) > 2 and len(s) > 2)

    for skill in required:
        (matched_required if _is_present(skill) else missing_required).append(skill)
    for skill in preferred:
        (matched_preferred if _is_present(skill) else missing_preferred).append(skill)

    # Weighted: required skills worth more than preferred.
    required_weight, preferred_weight = 0.75, 0.25
    required_score = (len(matched_required) / len(required) * 100) if required else 100.0
    preferred_score = (len(matched_preferred) / len(preferred) * 100) if preferred else 100.0
    score = required_score * required_weight + preferred_score * preferred_weight

    matched = CategorizedSkills(critical=matched_required, important=matched_preferred, nice_to_have=[])
    missing = CategorizedSkills(critical=missing_required, important=missing_preferred, nice_to_have=[])
    return round(score, 2), matched, missing


# ---------------------------------------------------------------------------
# Keyword match
# ---------------------------------------------------------------------------


def _keyword_match(resume: ParsedResume, job: JobAnalysisResult) -> float:
    keywords = [k for k in job.keywords if k]
    if not keywords:
        return 100.0
    resume_tokens = _tokenize(_resume_full_text(resume))
    hits = 0
    for kw in keywords:
        kw_tokens = _tokenize(kw)
        if not kw_tokens:
            continue
        if kw_tokens.issubset(resume_tokens) or (kw_tokens & resume_tokens):
            hits += 1
    return round((hits / len(keywords)) * 100, 2)


# ---------------------------------------------------------------------------
# Education match
# ---------------------------------------------------------------------------

_DEGREE_LEVELS: list[tuple[int, tuple[str, ...]]] = [
    (0, ("high school", "ged")),
    (1, ("associate",)),
    (2, ("bachelor", "b.s", "b.a", "bs ", "ba ", "bsc", "undergraduate")),
    (3, ("master", "m.s", "m.a", "ms ", "ma ", "msc", "mba", "graduate")),
    (4, ("phd", "ph.d", "doctorate", "doctoral")),
]


def _degree_level(text: str | None) -> int | None:
    if not text:
        return None
    lowered = text.lower()
    best: int | None = None
    for level, markers in _DEGREE_LEVELS:
        if any(marker in lowered for marker in markers):
            best = level if best is None else max(best, level)
    return best


def _education_match(resume: ParsedResume, job: JobAnalysisResult) -> float:
    required_level = _degree_level(job.education_requirements)
    if required_level is None:
        return 100.0  # No explicit education requirement stated.

    resume_levels = [lvl for edu in resume.education if (lvl := _degree_level(edu.degree)) is not None]
    if not resume_levels:
        return 30.0  # Requirement exists but resume shows no gradeable education.

    highest = max(resume_levels)
    if highest >= required_level:
        return 100.0
    gap = required_level - highest
    return max(0.0, 100.0 - gap * 35.0)


# ---------------------------------------------------------------------------
# Experience match
# ---------------------------------------------------------------------------

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_DATE_PATTERN = re.compile(
    r"(?P<month>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)?[a-z]*\.?\s*(?P<year>\d{4})",
    re.IGNORECASE,
)


def _parse_date_token(token: str | None) -> date | None:
    if not token:
        return None
    lowered = token.strip().lower()
    if "present" in lowered or "current" in lowered or "now" in lowered:
        return date.today()
    match = _DATE_PATTERN.search(lowered)
    if not match:
        return None
    year = int(match.group("year"))
    month_str = match.group("month")
    month = _MONTHS.get(month_str[:3].lower(), 1) if month_str else 1
    try:
        return date(year, month, 1)
    except ValueError:
        return None


def _total_experience_years(resume: ParsedResume) -> float:
    total_months = 0
    for exp in resume.experience:
        start = _parse_date_token(exp.start_date)
        end = _parse_date_token(exp.end_date) or (date.today() if start else None)
        if start and end and end >= start:
            months = (end.year - start.year) * 12 + (end.month - start.month)
            total_months += max(0, months)
    return round(total_months / 12, 2)


_EXPERIENCE_REQ_PATTERN = re.compile(r"(\d+)\s*\+?\s*(?:-|to)?\s*(\d+)?\s*(?:years|yrs|year)", re.IGNORECASE)


def _parse_required_years(text: str | None) -> float | None:
    if not text:
        return None
    match = _EXPERIENCE_REQ_PATTERN.search(text)
    if not match:
        return None
    low = float(match.group(1))
    high = match.group(2)
    return (low + float(high)) / 2 if high else low


def _experience_match(resume: ParsedResume, job: JobAnalysisResult) -> float:
    required_years = _parse_required_years(job.experience_required)
    actual_years = _total_experience_years(resume)
    if required_years is None or required_years <= 0:
        return 100.0
    if actual_years >= required_years:
        return 100.0
    ratio = actual_years / required_years
    return round(max(0.0, ratio * 100), 2)


# ---------------------------------------------------------------------------
# Project match
# ---------------------------------------------------------------------------


def _project_match(resume: ParsedResume, job: JobAnalysisResult) -> float:
    job_tech = {_normalize_skill(t) for t in (job.technologies + job.required_skills) if t}
    if not job_tech:
        return 100.0
    project_tech: set[str] = set()
    for proj in resume.projects:
        project_tech |= {_normalize_skill(t) for t in proj.technologies if t}
        project_tech |= _tokenize(" ".join(proj.bullets))
        if proj.description:
            project_tech |= _tokenize(proj.description)
    if not project_tech:
        return 0.0
    hits = sum(1 for t in job_tech if t in project_tech or any(t in p or p in t for p in project_tech if len(t) > 2 and len(p) > 2))
    return round((hits / len(job_tech)) * 100, 2)


# ---------------------------------------------------------------------------
# Overall scoring
# ---------------------------------------------------------------------------

WEIGHTS = {
    "skills_match": 0.35,
    "experience_match": 0.20,
    "project_match": 0.15,
    "keyword_match": 0.20,
    "education_match": 0.10,
}


def compute_subscores(resume: ParsedResume, job: JobAnalysisResult) -> dict:
    """Pure, deterministic computation of all 5 subscores plus matched/missing skill lists.
    No LLM call happens here — this is the ground truth the LLM reasoning step explains.
    """
    skills_score, matched_skills, missing_skills = _skills_match(resume, job)
    keyword_score = _keyword_match(resume, job)
    education_score = _education_match(resume, job)
    experience_score = _experience_match(resume, job)
    project_score = _project_match(resume, job)

    overall = (
        skills_score * WEIGHTS["skills_match"]
        + experience_score * WEIGHTS["experience_match"]
        + project_score * WEIGHTS["project_match"]
        + keyword_score * WEIGHTS["keyword_match"]
        + education_score * WEIGHTS["education_match"]
    )

    return {
        "overall_score": round(overall, 2),
        "skills_match": skills_score,
        "experience_match": experience_score,
        "project_match": project_score,
        "keyword_match": keyword_score,
        "education_match": education_score,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "actual_years_experience": _total_experience_years(resume),
        "required_years_experience": _parse_required_years(job.experience_required),
    }


_REASONING_PROMPT_TEMPLATE = """You are explaining a resume-to-job match score to a job seeker.
The numeric scores below were computed deterministically by rule-based matching logic — you must
NOT change or contradict them, only explain WHY each score is what it is, grounded strictly in the
matched/missing lists and facts provided.

Scores (0-100):
- overall_score: {overall_score}
- skills_match: {skills_match}
- experience_match: {experience_match}
- project_match: {project_match}
- keyword_match: {keyword_match}
- education_match: {education_match}

Facts:
- Matched required skills: {matched_required}
- Missing required skills: {missing_required}
- Matched preferred skills: {matched_preferred}
- Missing preferred skills: {missing_preferred}
- Candidate's total years of experience (computed from resume dates): {actual_years}
- Job's required years of experience: {required_years}
- Job education requirement: {education_requirement}

Write a short (1-3 sentence) grounded explanation for EACH of the five subscore keys
(skills_match, experience_match, project_match, keyword_match, education_match), referencing only
the facts above. Return a JSON object mapping each of those five keys to its explanation string.
"""


async def generate_match_result(
    resume: ParsedResume,
    job: JobAnalysisResult,
    *,
    resume_version_id,
    job_id,
    user_id: str | None,
    db: AsyncSession,
) -> MatchResult:
    """Compute deterministic subscores, then make ONE LLM call to generate grounded
    human-readable reasoning per subscore. The LLM never invents the numbers.
    """
    scores = compute_subscores(resume, job)

    prompt = _REASONING_PROMPT_TEMPLATE.format(
        overall_score=scores["overall_score"],
        skills_match=scores["skills_match"],
        experience_match=scores["experience_match"],
        project_match=scores["project_match"],
        keyword_match=scores["keyword_match"],
        education_match=scores["education_match"],
        matched_required=scores["matched_skills"].critical,
        missing_required=scores["missing_skills"].critical,
        matched_preferred=scores["matched_skills"].important,
        missing_preferred=scores["missing_skills"].important,
        actual_years=scores["actual_years_experience"],
        required_years=scores["required_years_experience"],
        education_requirement=job.education_requirements,
    )

    from app.schemas.rag import ReasoningMap  # local import to avoid cycle at module load

    reasoning_out = await run_structured(
        prompt,
        ReasoningMap,
        operation="match_reasoning",
        user_id=user_id,
        db=db,
        prompt_version="v1",
        fast=True,
    )

    return MatchResult(
        resume_version_id=resume_version_id,
        job_id=job_id,
        overall_score=scores["overall_score"],
        skills_match=scores["skills_match"],
        experience_match=scores["experience_match"],
        project_match=scores["project_match"],
        keyword_match=scores["keyword_match"],
        education_match=scores["education_match"],
        reasoning=reasoning_out.reasoning,
        matched_skills=scores["matched_skills"],
        missing_skills=scores["missing_skills"],
    )
