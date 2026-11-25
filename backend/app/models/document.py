from __future__ import annotations

import enum
import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPKMixin

EMBEDDING_DIM = 1024

# NOTE ON VECTOR STORAGE: the architecture doc's "target" design uses pgvector's native
# `vector` column + `cosine_distance()` for fast in-database ANN search. pgvector has no
# precompiled Windows binary (it requires either compiling with Visual Studio Build Tools,
# or running Postgres via Docker with the `pgvector/pgvector` image) — the docker-compose
# stack in this repo DOES use that official image. For a native/no-Docker local run (e.g. on
# a plain `postgresql` Windows install), we store the embedding as a portable JSONB float
# array instead and compute cosine similarity in Python (see `app/services/rag.py::retrieve`).
# This keeps the app fully runnable everywhere; swapping back to `pgvector.sqlalchemy.Vector`
# + `cosine_distance()` is a drop-in change once pgvector is available in your Postgres.


class DocumentType(str, enum.Enum):
    resume = "resume"
    job_description = "job_description"
    note = "note"
    prep_material = "prep_material"


class Document(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "documents"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    doc_type: Mapped[DocumentType] = mapped_column(SAEnum(DocumentType, name="document_type"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True
    )
    source_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )

    owner: Mapped["User"] = relationship()
    source_resume: Mapped["Resume | None"] = relationship()
    source_job: Mapped["Job | None"] = relationship()
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="DocumentChunk.chunk_index"
    )


class DocumentChunk(UUIDPKMixin, TimestampMixin, Base):
    __tablename__ = "document_chunks"

    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(JSONB, nullable=True)

    document: Mapped["Document"] = relationship(back_populates="chunks")
