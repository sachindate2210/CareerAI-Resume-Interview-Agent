from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class ReasoningMap(BaseModel):
    """Small schema used by the matching engine's LLM-explanation step: maps each of the
    five deterministic subscore keys to a short grounded explanation.
    """

    reasoning: dict[str, str] = Field(default_factory=dict)


class ChunkRelevanceScore(BaseModel):
    """Used by the LLM-based reranker: relevance score in [0, 1] for one retrieved chunk."""

    chunk_index: int
    relevance: float = Field(ge=0, le=1)


class ChunkRelevanceScores(BaseModel):
    scores: list[ChunkRelevanceScore] = Field(default_factory=list)


class Citation(BaseModel):
    document_id: uuid.UUID | None = None
    title: str | None = None
    chunk_index: int | None = None
    snippet: str | None = None


class AnswerWithCitations(BaseModel):
    """Structured answer for the RAG Q&A endpoint. If retrieval found nothing relevant, the
    caller should short-circuit before invoking the LLM at all and return the fallback
    message directly rather than asking the model to answer from general knowledge.
    """

    answer: str
    citations: list[Citation] = Field(default_factory=list)
    grounded: bool = True
