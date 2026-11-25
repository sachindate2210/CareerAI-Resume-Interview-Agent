from __future__ import annotations

import re

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm import run_structured
from app.schemas.job import JobAnalysisResult
from app.schemas.resume import ExperienceItem, ParsedResume, ProjectItem

VALID_SECTIONS = {"summary", "skills", "experience", "projects"}


class OptimizedSummary(BaseModel):
    summary: str


class OptimizedSkills(BaseModel):
    skills: list[str] = Field(default_factory=list)


class OptimizedExperience(BaseModel):
    experience: list[ExperienceItem] = Field(default_factory=list)


class OptimizedProjects(BaseModel):
    projects: list[ProjectItem] = Field(default_factory=list)


_SECTION_SCHEMAS: dict[str, type[BaseModel]] = {
    "summary": OptimizedSummary,
    "skills": OptimizedSkills,
    "experience": OptimizedExperience,
    "projects": OptimizedProjects,
}


class SectionOptimizationResult(BaseModel):
    section: str
    before: str
    after: str
    fabrication_detected: bool = False
    rationale: str | None = None


_BASE_RULES = """CRITICAL RULES:
- Only rephrase/quantify-if-already-implied/reorganize. Never invent employers, titles, dates,
  degrees, certifications, or metrics not present in the source.
- Do not add any company, institution, certification, skill, or number that is not already present
  somewhere in the source resume JSON below.
- You may improve wording, structure, clarity, and impact, and you may make an already-implied
  quantity more explicit (e.g. "a team" -> "a team" is fine, but never invent "a team of 8" if no
  size is given anywhere in the source).
"""

_SECTION_PROMPT_TEMPLATE = """You are an expert resume writer helping a candidate tailor their
resume to a specific job, one section at a time.

{base_rules}

Target job (for tailoring tone/emphasis/keyword alignment only — never as a source of facts about
the candidate):
<job_analysis_json>
{job_json}
</job_analysis_json>

Full source resume (the ONLY source of truth about the candidate):
<source_resume_json>
{resume_json}
</source_resume_json>

Rewrite ONLY the "{section}" section to better align with the target job. Return your answer
strictly according to the required schema for this section.

Current "{section}" section:
<current_section>
{current_section}
</current_section>
"""

_CORRECTION_SUFFIX = """

Your previous rewrite introduced information that is NOT present anywhere in the source resume:
{fabrications}

Regenerate the "{section}" section, removing every one of those fabricated items. You must only
use facts already present in the source resume JSON above.
"""


def _section_before_text(resume: ParsedResume, section: str) -> str:
    if section == "summary":
        return resume.summary or ""
    if section == "skills":
        return ", ".join(resume.skills)
    if section == "experience":
        return resume.model_dump_json(indent=2, include={"experience"})
    if section == "projects":
        return resume.model_dump_json(indent=2, include={"projects"})
    raise ValueError(f"Unsupported section: {section!r}")


def _section_after_text(result: BaseModel, section: str) -> str:
    if section == "summary":
        return result.summary  # type: ignore[attr-defined]
    if section == "skills":
        return ", ".join(result.skills)  # type: ignore[attr-defined]
    if section == "experience":
        return result.model_dump_json(indent=2)
    if section == "projects":
        return result.model_dump_json(indent=2)
    raise ValueError(f"Unsupported section: {section!r}")


# ---------------------------------------------------------------------------
# Anti-fabrication validation
# ---------------------------------------------------------------------------

_NUMBER_TOKEN_PATTERN = re.compile(r"\d[\d,.%$kKmMxX+]*")
_PROPER_NOUN_PATTERN = re.compile(r"\b[A-Z][a-zA-Z0-9&.]*(?:\s+[A-Z][a-zA-Z0-9&.]*){0,3}\b")

_GENERIC_WORDS = {
    "I", "The", "A", "An", "This", "That", "We", "It", "Led", "Built", "Developed",
    "Designed", "Created", "Managed", "Improved", "Increased", "Reduced", "Achieved",
}


def _collect_source_entities(resume: ParsedResume) -> tuple[set[str], set[str]]:
    """Returns (named_entities, number_tokens) present anywhere in the source resume."""
    text_blobs: list[str] = []
    if resume.summary:
        text_blobs.append(resume.summary)
    text_blobs.extend(resume.skills)
    text_blobs.extend(resume.certifications)
    text_blobs.extend(resume.achievements)
    for exp in resume.experience:
        text_blobs.extend([exp.company or "", exp.title or "", exp.location or ""])
        text_blobs.extend(exp.bullets)
    for edu in resume.education:
        text_blobs.extend([edu.institution or "", edu.degree or "", edu.field or ""])
    for proj in resume.projects:
        text_blobs.extend([proj.name or "", proj.description or ""])
        text_blobs.extend(proj.technologies)
        text_blobs.extend(proj.bullets)

    full_text = "\n".join(text_blobs)
    entities = {
        m.group(0).strip()
        for m in _PROPER_NOUN_PATTERN.finditer(full_text)
        if m.group(0).strip() not in _GENERIC_WORDS
    }
    numbers = {m.group(0) for m in _NUMBER_TOKEN_PATTERN.finditer(full_text)}
    return entities, numbers


def _validate_no_fabrication(original: ParsedResume, rewritten_text: str) -> list[str]:
    """Returns a list of newly-introduced named entities / number tokens found in
    `rewritten_text` that do not appear anywhere in the original source resume.
    """
    source_entities, source_numbers = _collect_source_entities(original)
    source_entities_lower = {e.lower() for e in source_entities}

    fabrications: list[str] = []

    for match in _PROPER_NOUN_PATTERN.finditer(rewritten_text):
        candidate = match.group(0).strip()
        if candidate in _GENERIC_WORDS or len(candidate) < 3:
            continue
        if candidate.lower() in source_entities_lower:
            continue
        # Allow substrings of a known entity (e.g. rewritten uses just "Google" from "Google Inc").
        if any(candidate.lower() in e or e in candidate.lower() for e in source_entities_lower):
            continue
        fabrications.append(candidate)

    for match in _NUMBER_TOKEN_PATTERN.finditer(rewritten_text):
        token = match.group(0)
        if token in source_numbers:
            continue
        # A bare "1" or single digit is too noisy/likely-benign (e.g. list numbering); skip.
        if len(token) <= 1:
            continue
        fabrications.append(token)

    return list(dict.fromkeys(fabrications))


async def optimize_section(
    resume: ParsedResume,
    job: JobAnalysisResult,
    section: str,
    *,
    user_id: str | None,
    db: AsyncSession,
) -> SectionOptimizationResult:
    """Generate an improved version of ONLY `section`, with a deterministic anti-fabrication
    guard: retry once with an explicit correction listing what was fabricated; if still
    failing, fall back to returning the original section unchanged with
    `fabrication_detected=True`.
    """
    if section not in VALID_SECTIONS:
        raise ValueError(f"Unsupported section: {section!r}. Must be one of {sorted(VALID_SECTIONS)}.")

    schema = _SECTION_SCHEMAS[section]
    before_text = _section_before_text(resume, section)

    base_prompt = _SECTION_PROMPT_TEMPLATE.format(
        base_rules=_BASE_RULES,
        job_json=job.model_dump_json(indent=2),
        resume_json=resume.model_dump_json(indent=2),
        section=section,
        current_section=before_text,
    )

    result = await run_structured(
        base_prompt,
        schema,
        operation=f"resume_optimize_{section}",
        user_id=user_id,
        db=db,
        prompt_version="v1",
    )
    after_text = _section_after_text(result, section)
    fabrications = _validate_no_fabrication(resume, after_text)

    if fabrications:
        correction_prompt = base_prompt + _CORRECTION_SUFFIX.format(
            fabrications=fabrications, section=section
        )
        retry_result = await run_structured(
            correction_prompt,
            schema,
            operation=f"resume_optimize_{section}_retry",
            user_id=user_id,
            db=db,
            prompt_version="v1",
        )
        retry_after_text = _section_after_text(retry_result, section)
        retry_fabrications = _validate_no_fabrication(resume, retry_after_text)

        if not retry_fabrications:
            return SectionOptimizationResult(
                section=section, before=before_text, after=retry_after_text, fabrication_detected=False
            )

        # Still failing: fall back to the original section unchanged, flag the issue.
        return SectionOptimizationResult(
            section=section,
            before=before_text,
            after=before_text,
            fabrication_detected=True,
            rationale=(
                "Automatic rewrite could not be verified against the source resume "
                "(possible fabricated details); returning the original section unchanged."
            ),
        )

    return SectionOptimizationResult(section=section, before=before_text, after=after_text, fabrication_detected=False)
