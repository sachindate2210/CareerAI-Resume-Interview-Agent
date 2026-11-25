"""Turn an analysis into an updated resume: rewritten bullets and summary applied to a copy of
the parsed resume. The original is never modified; the candidate reviews before downloading."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from app.schemas.resume import BulletRewrite, ParsedResume

PLACEHOLDER = re.compile(r"\[[^\]]{1,40}\]")


class ResumeChange(BaseModel):
    section: str
    before: str | None
    after: str


class ImprovedResume(BaseModel):
    resume: ParsedResume
    changes: list[ResumeChange] = Field(default_factory=list)
    placeholders: int = 0


def build_improved_resume(parsed: ParsedResume, rewrites: list[BulletRewrite], summary: str | None) -> ImprovedResume:
    updated = parsed.model_copy(deep=True)
    changes: list[ResumeChange] = []
    by_original = {r.original.strip().lower(): r.improved for r in rewrites}

    if summary and summary.strip() != (parsed.summary or "").strip():
        changes.append(ResumeChange(section="Summary", before=parsed.summary, after=summary))
        updated.summary = summary

    def apply(bullets: list[str], label: str) -> list[str]:
        out = []
        for b in bullets:
            new = by_original.get(b.strip().lower())
            if new:
                changes.append(ResumeChange(section=label, before=b, after=new))
                out.append(new)
            else:
                out.append(b)
        return out

    for exp in updated.experience:
        exp.bullets = apply(exp.bullets, f"Experience · {exp.title or exp.company or 'Role'}")
    for proj in updated.projects:
        proj.bullets = apply(proj.bullets, f"Project · {proj.name or 'Project'}")

    text = updated.model_dump_json()
    return ImprovedResume(resume=updated, changes=changes, placeholders=len(PLACEHOLDER.findall(text)))


MAX_EXPORT_CHARS = 60_000


def validate_export_payload(resume: ParsedResume) -> None:
    if len(resume.model_dump_json()) > MAX_EXPORT_CHARS:
        raise ValueError("Resume is too long to export.")
