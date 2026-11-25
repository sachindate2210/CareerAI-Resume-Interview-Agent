"""Deterministic tests for the matching engine. `compute_subscores` is pure Python (no DB/LLM
calls), so these assert exact expected values given fixed fixtures.
"""

from __future__ import annotations

from app.schemas.job import JobAnalysisResult
from app.schemas.match import CategorizedSkills
from app.schemas.resume import EducationItem, ExperienceItem, ParsedResume
from app.services.matching_engine import (
    _degree_level,
    _education_match,
    _experience_match,
    _parse_required_years,
    _skills_match,
    _total_experience_years,
    compute_subscores,
)


def test_skills_match_required_and_preferred(sample_parsed_resume, sample_job_analysis):
    score, matched, missing = _skills_match(sample_parsed_resume, sample_job_analysis)

    assert set(matched.critical) == {"Python", "FastAPI", "PostgreSQL"}
    assert set(missing.critical) == {"Kubernetes"}
    assert set(matched.important) == {"AWS", "Docker"}
    assert missing.important == []

    # required_score = 3/4 * 100 = 75, preferred_score = 2/2 * 100 = 100
    # overall = 75*0.75 + 100*0.25 = 56.25 + 25 = 81.25
    assert score == 81.25


def test_degree_level_ordering():
    assert _degree_level(None) is None
    assert _degree_level("High School Diploma") == 0
    assert _degree_level("Associate's Degree") == 1
    assert _degree_level("Bachelor of Science") == 2
    assert _degree_level("Master of Science") == 3
    assert _degree_level("PhD in Computer Science") == 4


def test_education_match_meets_requirement(sample_parsed_resume, sample_job_analysis):
    # Resume has a Bachelor's (level 2), job requires "Bachelor's degree" (level 2) -> exact match.
    score = _education_match(sample_parsed_resume, sample_job_analysis)
    assert score == 100.0


def test_education_match_below_requirement():
    resume = ParsedResume(education=[EducationItem(degree="High School Diploma")])
    job = JobAnalysisResult(education_requirements="Master's degree required")
    score = _education_match(resume, job)
    # required level 3, highest resume level 0 -> gap 3 -> 100 - 3*35 = -5 -> clamped to 0
    assert score == 0.0


def test_education_match_no_requirement_stated(sample_parsed_resume):
    job = JobAnalysisResult(education_requirements=None)
    assert _education_match(sample_parsed_resume, job) == 100.0


def test_parse_required_years():
    assert _parse_required_years("3+ years") == 3.0
    assert _parse_required_years("3-5 years of experience") == 4.0
    assert _parse_required_years(None) is None
    assert _parse_required_years("entry level") is None


def test_total_experience_years(sample_parsed_resume):
    years = _total_experience_years(sample_parsed_resume)
    # start "Jan 2021" to "Present" (today) is always >= a few years; just assert it's positive
    # and consistent with a Jan 2021 start.
    assert years > 3.0


def test_experience_match_meets_requirement(sample_parsed_resume, sample_job_analysis):
    score = _experience_match(sample_parsed_resume, sample_job_analysis)
    assert score == 100.0


def test_experience_match_below_requirement():
    resume = ParsedResume(
        experience=[ExperienceItem(start_date="Jan 2023", end_date="Jan 2024")]
    )
    job = JobAnalysisResult(experience_required="4+ years")
    score = _experience_match(resume, job)
    assert 0 < score < 100


def test_compute_subscores_overall_weighting(sample_parsed_resume, sample_job_analysis):
    scores = compute_subscores(sample_parsed_resume, sample_job_analysis)

    assert scores["skills_match"] == 81.25
    assert scores["education_match"] == 100.0
    assert scores["experience_match"] == 100.0

    expected_overall = round(
        scores["skills_match"] * 0.35
        + scores["experience_match"] * 0.20
        + scores["project_match"] * 0.15
        + scores["keyword_match"] * 0.20
        + scores["education_match"] * 0.10,
        2,
    )
    assert scores["overall_score"] == expected_overall
    assert 0 <= scores["overall_score"] <= 100


def test_compute_subscores_no_requirements_yields_perfect_scores():
    resume = ParsedResume(skills=["Python"])
    job = JobAnalysisResult()  # no requirements stated at all
    scores = compute_subscores(resume, job)
    assert scores["skills_match"] == 100.0
    assert scores["keyword_match"] == 100.0
    assert scores["education_match"] == 100.0
    assert scores["experience_match"] == 100.0
    assert scores["project_match"] == 100.0
    assert scores["overall_score"] == 100.0


def test_missing_skills_categorization_is_deterministic(sample_parsed_resume, sample_job_analysis):
    scores = compute_subscores(sample_parsed_resume, sample_job_analysis)
    missing: CategorizedSkills = scores["missing_skills"]
    assert missing.critical == ["Kubernetes"]
    assert missing.important == []
