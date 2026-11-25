from __future__ import annotations

import asyncio
import socket
import sys
from urllib.parse import urlparse

import pytest

if sys.platform == "win32":
    # asyncpg's connection teardown is incompatible with Windows' default ProactorEventLoop
    # (a harmless "Event loop is closed" / AttributeError can surface during pool/connection
    # close). The selector event loop policy avoids it; this only affects test runs.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.config import get_settings
from app.schemas.resume import EducationItem, ExperienceItem, ParsedResume, ProjectItem


def _postgres_reachable(database_url: str, timeout: float = 1.0) -> bool:
    try:
        parsed = urlparse(database_url.replace("+asyncpg", "").replace("+psycopg2", ""))
        host = parsed.hostname or "localhost"
        port = parsed.port or 5432
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


@pytest.fixture(scope="session", autouse=True)
async def _dispose_engine_at_session_end():
    """Without this, pooled asyncpg connections opened by integration tests are only closed
    by garbage collection after the test session's event loop has already been torn down,
    which surfaces as a harmless-but-noisy 'Event loop is closed' error on Windows. Disposing
    the engine explicitly, on the still-live loop, avoids it.
    """
    yield
    from app.core.database import engine

    await engine.dispose()


@pytest.fixture(scope="session")
def database_available() -> bool:
    # Use the SAME settings the app itself resolves (env vars / .env), so this check reflects
    # whether `app.main`'s actual DATABASE_URL is reachable from this test process.
    database_url = get_settings().DATABASE_URL
    return _postgres_reachable(database_url)


@pytest.fixture
def sample_parsed_resume() -> ParsedResume:
    """A moderately strong resume fixture used across tests."""
    return ParsedResume(
        name="Jordan Rivera",
        email="jordan.rivera@example.com",
        phone="555-123-4567",
        summary="Backend engineer with 4 years of experience building Python services.",
        skills=["Python", "FastAPI", "PostgreSQL", "Docker", "AWS"],
        experience=[
            ExperienceItem(
                company="Acme Corp",
                title="Software Engineer",
                start_date="Jan 2021",
                end_date="Present",
                location="Remote",
                bullets=[
                    "Built and shipped a Python/FastAPI microservice handling 2M requests/day.",
                    "Reduced API latency by 35% through query optimization and caching.",
                    "Led migration of a monolith to Docker-based microservices on AWS.",
                ],
            ),
        ],
        education=[
            EducationItem(institution="State University", degree="Bachelor of Science", field="Computer Science", start_date="2015", end_date="2019")
        ],
        projects=[
            ProjectItem(
                name="Task Tracker",
                description="A personal project for tracking tasks.",
                technologies=["Python", "PostgreSQL", "Docker"],
                bullets=["Implemented REST API with FastAPI and PostgreSQL."],
            )
        ],
        certifications=["AWS Certified Developer – Associate"],
        achievements=[],
        links=["https://github.com/jordanrivera"],
    )


@pytest.fixture
def sample_weak_resume() -> ParsedResume:
    """A deliberately weak resume fixture: no metrics, weak verbs, missing sections."""
    return ParsedResume(
        name="Alex Doe",
        email=None,
        phone=None,
        summary=None,
        skills=[],
        experience=[
            ExperienceItem(
                company="Some Company",
                title="Helper",
                start_date="2022",
                end_date="2023",
                bullets=["Was responsible for stuff.", "Helped with things sometimes."],
            )
        ],
        education=[],
        projects=[],
        certifications=[],
        achievements=[],
        links=[],
    )

