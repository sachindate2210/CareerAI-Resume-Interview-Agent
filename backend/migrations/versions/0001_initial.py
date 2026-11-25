"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamp_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    # NOTE: document_chunks.embedding is stored as JSONB (portable, works on any Postgres)
    # rather than pgvector's native `vector` type — see app/models/document.py for why.
    # If you deploy against the `pgvector/pgvector` Docker image and want native ANN search,
    # uncomment the next line and switch the column below to `Vector(1024)`.
    # op.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    # create_type=False: we create/drop these enum types explicitly below (checkfirst=True),
    # so SQLAlchemy must not also auto-create/drop them when they're used as a column type in
    # create_table/drop_table (that default behavior is what caused a DuplicateObject error).
    resume_status = postgresql.ENUM("pending", "parsed", "failed", name="resume_status", create_type=False)
    resume_version_source = postgresql.ENUM(
        "original", "ai_optimized", "manual_edit", name="resume_version_source", create_type=False
    )
    skill_importance = postgresql.ENUM("required", "preferred", name="skill_importance", create_type=False)
    interview_mode = postgresql.ENUM(
        "technical", "behavioral", "resume_based", "mixed", name="interview_mode", create_type=False
    )
    interview_status = postgresql.ENUM(
        "in_progress", "completed", "abandoned", name="interview_status", create_type=False
    )
    document_type = postgresql.ENUM(
        "resume", "job_description", "note", "prep_material", name="document_type", create_type=False
    )
    ai_generation_status = postgresql.ENUM(
        "success", "validation_retry", "failed", name="ai_generation_status", create_type=False
    )

    bind = op.get_bind()
    resume_status.create(bind, checkfirst=True)
    resume_version_source.create(bind, checkfirst=True)
    skill_importance.create(bind, checkfirst=True)
    interview_mode.create(bind, checkfirst=True)
    interview_status.create(bind, checkfirst=True)
    document_type.create(bind, checkfirst=True)
    ai_generation_status.create(bind, checkfirst=True)

    # --- users ------------------------------------------------------------------
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # --- refresh_tokens -----------------------------------------------------------
    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("revoked", sa.Boolean(), server_default=sa.false(), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    # --- resumes --------------------------------------------------------------
    op.create_table(
        "resumes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("file_path", sa.String(1024), nullable=False),
        sa.Column("file_type", sa.String(20), nullable=False),
        sa.Column("status", resume_status, nullable=False, server_default="pending"),
        sa.Column("raw_text", sa.Text(), nullable=True),
        *_timestamp_columns(),
    )
    op.create_index("ix_resumes_owner_id", "resumes", ["owner_id"])

    # --- jobs -------------------------------------------------------------------
    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("company", sa.String(255), nullable=False),
        sa.Column("raw_description", sa.Text(), nullable=False),
        sa.Column("source_url", sa.String(1024), nullable=True),
        *_timestamp_columns(),
    )
    op.create_index("ix_jobs_owner_id", "jobs", ["owner_id"])

    # --- resume_versions ----------------------------------------------------------
    op.create_table(
        "resume_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("resume_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resumes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("parsed_json", postgresql.JSONB(), nullable=False),
        sa.Column("is_original", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("tailored_for_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source", resume_version_source, nullable=False, server_default="original"),
        *_timestamp_columns(),
    )
    op.create_index("ix_resume_versions_resume_id", "resume_versions", ["resume_id"])

    # --- job_analyses -------------------------------------------------------------
    op.create_table(
        "job_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("extracted_json", postgresql.JSONB(), nullable=False),
        sa.Column("must_have_skills", postgresql.JSONB(), nullable=False),
        sa.Column("nice_to_have_skills", postgresql.JSONB(), nullable=False),
        sa.Column("keywords", postgresql.JSONB(), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_job_analyses_job_id", "job_analyses", ["job_id"], unique=True)

    # --- skills -------------------------------------------------------------------
    op.create_table(
        "skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_skills_name", "skills", ["name"], unique=True)

    # --- resume_skills --------------------------------------------------------------
    op.create_table(
        "resume_skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("resume_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=True),
        *_timestamp_columns(),
    )
    op.create_index("ix_resume_skills_resume_version_id", "resume_skills", ["resume_version_id"])
    op.create_index("ix_resume_skills_skill_id", "resume_skills", ["skill_id"])

    # --- job_skills -----------------------------------------------------------------
    op.create_table(
        "job_skills",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_analysis_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("job_analyses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("importance", skill_importance, nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_job_skills_job_analysis_id", "job_skills", ["job_analysis_id"])
    op.create_index("ix_job_skills_skill_id", "job_skills", ["skill_id"])

    # --- match_analyses ---------------------------------------------------------------
    op.create_table(
        "match_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("resume_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("overall_score", sa.Float(), nullable=False),
        sa.Column("skills_match", sa.Float(), nullable=False),
        sa.Column("experience_match", sa.Float(), nullable=False),
        sa.Column("project_match", sa.Float(), nullable=False),
        sa.Column("keyword_match", sa.Float(), nullable=False),
        sa.Column("education_match", sa.Float(), nullable=False),
        sa.Column("reasoning", postgresql.JSONB(), nullable=False),
        sa.Column("matched_skills", postgresql.JSONB(), nullable=False),
        sa.Column("missing_skills", postgresql.JSONB(), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_match_analyses_resume_version_id", "match_analyses", ["resume_version_id"])
    op.create_index("ix_match_analyses_job_id", "match_analyses", ["job_id"])

    # --- learning_plans -----------------------------------------------------------------
    op.create_table(
        "learning_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("match_analysis_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("match_analyses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("plan_json", postgresql.JSONB(), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_learning_plans_user_id", "learning_plans", ["user_id"])

    # --- interviews --------------------------------------------------------------------
    op.create_table(
        "interviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resume_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("mode", interview_mode, nullable=False),
        sa.Column("status", interview_status, nullable=False, server_default="in_progress"),
        sa.Column("difficulty_level", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("langgraph_thread_id", sa.String(255), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_interviews_owner_id", "interviews", ["owner_id"])

    # --- interview_questions -------------------------------------------------------------
    op.create_table(
        "interview_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("interview_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("topic", sa.String(255), nullable=False),
        sa.Column("question_type", sa.String(50), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_interview_questions_interview_id", "interview_questions", ["interview_id"])

    # --- interview_answers -----------------------------------------------------------------
    op.create_table(
        "interview_answers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("question_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("interview_questions.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("answer_text", sa.Text(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evaluation_json", postgresql.JSONB(), nullable=True),
        *_timestamp_columns(),
    )
    op.create_index("ix_interview_answers_question_id", "interview_answers", ["question_id"], unique=True)

    # --- interview_evaluations -----------------------------------------------------------
    op.create_table(
        "interview_evaluations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("interview_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("overall_score", sa.Float(), nullable=False),
        sa.Column("technical_score", sa.Float(), nullable=False),
        sa.Column("communication_score", sa.Float(), nullable=False),
        sa.Column("problem_solving_score", sa.Float(), nullable=False),
        sa.Column("confidence_score", sa.Float(), nullable=False),
        sa.Column("resume_knowledge_score", sa.Float(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("per_question_feedback", postgresql.JSONB(), nullable=False),
        *_timestamp_columns(),
    )
    op.create_index("ix_interview_evaluations_interview_id", "interview_evaluations", ["interview_id"], unique=True)

    # --- documents --------------------------------------------------------------------------
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("doc_type", document_type, nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("source_resume_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True),
        *_timestamp_columns(),
    )
    op.create_index("ix_documents_owner_id", "documents", ["owner_id"])

    # --- document_chunks --------------------------------------------------------------------
    op.create_table(
        "document_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        *_timestamp_columns(),
    )
    op.create_index("ix_document_chunks_document_id", "document_chunks", ["document_id"])

    # --- ai_generation_logs -----------------------------------------------------------------
    op.create_table(
        "ai_generation_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("operation", sa.String(100), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("prompt_version", sa.String(20), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("status", ai_generation_status, nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        *_timestamp_columns(),
    )
    op.create_index("ix_ai_generation_logs_user_id", "ai_generation_logs", ["user_id"])


def downgrade() -> None:
    op.drop_table("ai_generation_logs")
    op.drop_table("document_chunks")
    op.drop_table("documents")
    op.drop_table("interview_evaluations")
    op.drop_table("interview_answers")
    op.drop_table("interview_questions")
    op.drop_table("interviews")
    op.drop_table("learning_plans")
    op.drop_table("match_analyses")
    op.drop_table("job_skills")
    op.drop_table("resume_skills")
    op.drop_table("skills")
    op.drop_table("job_analyses")
    op.drop_table("resume_versions")
    op.drop_table("jobs")
    op.drop_table("resumes")
    op.drop_table("refresh_tokens")
    op.drop_table("users")

    bind = op.get_bind()
    postgresql.ENUM(name="ai_generation_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="document_type").drop(bind, checkfirst=True)
    postgresql.ENUM(name="interview_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="interview_mode").drop(bind, checkfirst=True)
    postgresql.ENUM(name="skill_importance").drop(bind, checkfirst=True)
    postgresql.ENUM(name="resume_version_source").drop(bind, checkfirst=True)
    postgresql.ENUM(name="resume_status").drop(bind, checkfirst=True)
