from __future__ import annotations

import hashlib
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from functools import lru_cache

import httpx
import structlog
import tiktoken
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.llm import run_structured
from app.models.document import Document, DocumentChunk
from app.schemas.rag import AnswerWithCitations, Citation

logger = structlog.get_logger(__name__)

EMBEDDING_DIM = 1024

# ---------------------------------------------------------------------------
# Chunker: recursive splitter, ~500 tokens with 50 token overlap, token-counted via tiktoken.
# Implemented directly (no langchain text splitter dependency) for clarity and to avoid an
# extra heavy import; the recursive-separator strategy mirrors
# `RecursiveCharacterTextSplitter` but counts tokens instead of characters.
# ---------------------------------------------------------------------------

_SEPARATORS = ["\n\n", "\n", ". ", " "]


@lru_cache
def _get_encoding():
    try:
        return tiktoken.get_encoding("cl100k_base")
    except Exception:  # noqa: BLE001
        return tiktoken.get_encoding("gpt2")


def _count_tokens(text: str) -> int:
    return len(_get_encoding().encode(text))


def _split_by_separator(text: str, separators: list[str]) -> list[str]:
    if not separators:
        return [text]
    sep, rest = separators[0], separators[1:]
    if sep not in text:
        return _split_by_separator(text, rest) if rest else [text]
    pieces = [p for p in text.split(sep) if p.strip()]
    return pieces if pieces else [text]


def chunk_text(text: str, *, chunk_size_tokens: int = 500, overlap_tokens: int = 50) -> list[str]:
    """Recursively split `text` into chunks of roughly `chunk_size_tokens` tokens, with
    `overlap_tokens` of overlap between consecutive chunks, using a separator cascade
    (paragraph -> line -> sentence -> word) so splits happen at natural boundaries.
    """
    text = text.strip()
    if not text:
        return []
    if _count_tokens(text) <= chunk_size_tokens:
        return [text]

    pieces = _split_by_separator(text, _SEPARATORS)
    chunks: list[str] = []
    current_parts: list[str] = []
    current_tokens = 0

    for piece in pieces:
        piece_tokens = _count_tokens(piece)
        if piece_tokens > chunk_size_tokens:
            # Piece itself is too large (e.g. one giant paragraph) - recurse on it directly.
            if current_parts:
                chunks.append(" ".join(current_parts))
                current_parts, current_tokens = [], 0
            chunks.extend(chunk_text(piece, chunk_size_tokens=chunk_size_tokens, overlap_tokens=overlap_tokens))
            continue

        if current_tokens + piece_tokens > chunk_size_tokens and current_parts:
            chunks.append(" ".join(current_parts))
            # Build overlap: carry the tail of the previous chunk forward.
            overlap_parts: list[str] = []
            overlap_count = 0
            for part in reversed(current_parts):
                part_tokens = _count_tokens(part)
                if overlap_count + part_tokens > overlap_tokens:
                    break
                overlap_parts.insert(0, part)
                overlap_count += part_tokens
            current_parts = overlap_parts
            current_tokens = overlap_count

        current_parts.append(piece)
        current_tokens += piece_tokens

    if current_parts:
        chunks.append(" ".join(current_parts))

    return chunks


# ---------------------------------------------------------------------------
# Embedding providers
# ---------------------------------------------------------------------------


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector (length EMBEDDING_DIM) per input text."""


class VoyageEmbeddingProvider(EmbeddingProvider):
    """Real semantic embeddings via Voyage AI's HTTP API (voyage-3, truncated/padded to
    EMBEDDING_DIM=1024, which is voyage-3's native output dimension).
    """

    _API_URL = "https://api.voyageai.com/v1/embeddings"

    def __init__(self, api_key: str, model: str = "voyage-3") -> None:
        self._api_key = api_key
        self._model = model

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                self._API_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"input": texts, "model": self._model, "input_type": "document"},
            )
            response.raise_for_status()
            data = response.json()
        return [item["embedding"] for item in data["data"]]


class LocalHashEmbeddingProvider(EmbeddingProvider):
    """DEV/OFFLINE FALLBACK ONLY. Deterministic hashing-based pseudo-embedding used only when
    no Voyage API key is configured, so the app remains runnable end-to-end without a paid key.

    This is NOT a real semantic embedding — it hashes overlapping word shingles into a fixed
    1024-dim bag-of-hashed-features vector (L2-normalized). It provides crude lexical-overlap
    retrieval (documents sharing literal words will score higher) but has none of a real
    embedding model's semantic generalization. A warning is logged every time it is used so
    this is never mistaken for genuine semantic search in a way that could mislead.
    """

    def __init__(self, dim: int = EMBEDDING_DIM) -> None:
        self._dim = dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        logger.warning(
            "local_hash_embedding_provider_active",
            reason="No VOYAGE_API_KEY configured; using deterministic hashing pseudo-embeddings "
            "(dev/offline fallback only, not real semantic search).",
        )
        return [self._embed_one(t) for t in texts]

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self._dim
        tokens = text.lower().split()
        shingles = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:])]
        if not shingles:
            shingles = [""]
        for shingle in shingles:
            digest = hashlib.sha256(shingle.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "big") % self._dim
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign
        norm = sum(v * v for v in vector) ** 0.5
        if norm > 0:
            vector = [v / norm for v in vector]
        return vector


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    settings = get_settings()
    if settings.EMBEDDING_PROVIDER == "voyage" and settings.VOYAGE_API_KEY:
        return VoyageEmbeddingProvider(api_key=settings.VOYAGE_API_KEY)
    logger.warning(
        "embedding_provider_fallback",
        configured_provider=settings.EMBEDDING_PROVIDER,
        has_voyage_key=bool(settings.VOYAGE_API_KEY),
    )
    return LocalHashEmbeddingProvider()


async def get_embeddings(texts: list[str]) -> list[list[float]]:
    return await get_embedding_provider().embed(texts)


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


async def ingest_document(db: AsyncSession, document: Document, text: str) -> list[DocumentChunk]:
    """Chunk `text`, embed each chunk, and persist `DocumentChunk` rows for `document`."""
    chunks = chunk_text(text)
    if not chunks:
        return []
    embeddings = await get_embeddings(chunks)

    rows: list[DocumentChunk] = []
    for idx, (content, embedding) in enumerate(zip(chunks, embeddings)):
        row = DocumentChunk(document_id=document.id, chunk_index=idx, content=content, embedding=embedding)
        db.add(row)
        rows.append(row)
    await db.commit()
    for row in rows:
        await db.refresh(row)
    return rows


# ---------------------------------------------------------------------------
# Retrieval + rerank
# ---------------------------------------------------------------------------


@dataclass
class ScoredChunk:
    chunk: DocumentChunk
    document: Document
    score: float
    rerank_score: float = field(default=0.0)


async def retrieve(
    db: AsyncSession,
    owner_id: uuid.UUID | str,
    query: str,
    *,
    resume_id: uuid.UUID | str | None = None,
    job_id: uuid.UUID | str | None = None,
    top_k: int = 8,
) -> list[ScoredChunk]:
    """Cosine-similarity retrieval, scoped strictly to the owner's own documents (never
    cross-user).

    `document_chunks.embedding` is a portable JSONB float array (see app/models/document.py
    for why), so similarity is computed in Python rather than via a native vector-index
    operator. This is the right tradeoff at portfolio scale (a user's own document set is
    small); if deployed against the `pgvector/pgvector` Docker image with a native `Vector`
    column, replace this with `DocumentChunk.embedding.cosine_distance(query_embedding)` and
    an `ORDER BY ... LIMIT top_k` pushed down to Postgres instead.
    """
    [query_embedding] = await get_embeddings([query])

    stmt = (
        select(DocumentChunk, Document)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.owner_id == owner_id)
        .where(DocumentChunk.embedding.is_not(None))
    )
    if resume_id is not None:
        stmt = stmt.where(Document.source_resume_id == resume_id)
    if job_id is not None:
        stmt = stmt.where(Document.source_job_id == job_id)

    result = await db.execute(stmt)
    rows = result.all()

    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(y * y for y in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    scored: list[ScoredChunk] = []
    for chunk, doc in rows:
        similarity = round(_cosine_similarity(query_embedding, chunk.embedding or []), 4)
        scored.append(ScoredChunk(chunk=chunk, document=doc, score=similarity))

    scored.sort(key=lambda sc: sc.score, reverse=True)
    return scored[:top_k]


def _lexical_overlap(query: str, text: str) -> float:
    query_tokens = {t.lower() for t in query.split() if len(t) > 2}
    text_tokens = {t.lower() for t in text.split() if len(t) > 2}
    if not query_tokens or not text_tokens:
        return 0.0
    return len(query_tokens & text_tokens) / len(query_tokens)


def rerank(query: str, chunks: list[ScoredChunk], *, final_k: int = 5) -> list[ScoredChunk]:
    """Reranks retrieved chunks and returns the top `final_k`.

    Design choice: this uses a deterministic lexical-overlap rerank rather than an extra LLM
    call. For a small top-k (<=8) candidate set drawn from cosine similarity already, an LLM
    relevance re-score adds real latency/cost for a portfolio-scale app without a large payoff
    over blending in straightforward lexical overlap with the vector-similarity score — so we
    keep this step cheap and fully deterministic/testable, and reserve the LLM budget for the
    final grounded-answer generation call in `answer_with_citations`.
    """
    for sc in chunks:
        overlap = _lexical_overlap(query, sc.chunk.content)
        # Blend: vector similarity is the primary signal, lexical overlap breaks ties / boosts
        # chunks that literally mention the query terms.
        sc.rerank_score = 0.7 * sc.score + 0.3 * overlap
    ranked = sorted(chunks, key=lambda sc: sc.rerank_score, reverse=True)
    return ranked[:final_k]


# ---------------------------------------------------------------------------
# Answer with citations
# ---------------------------------------------------------------------------

_ANSWER_PROMPT_TEMPLATE = """You are a career Q&A assistant. Answer the user's question using
ONLY the retrieved context chunks below, each tagged with an index. Cite which chunk(s) you used
for each part of your answer via the `citations` field (chunk_index must match one of the
provided indices).

If the retrieved context does not contain enough information to answer the question, set `answer`
to "Not enough information available." and leave `citations` empty and `grounded` to false —
do NOT answer from general knowledge.

Question: {question}

Retrieved context chunks:
{context_block}
"""


async def answer_with_citations(
    db: AsyncSession,
    owner_id: uuid.UUID | str,
    question: str,
    *,
    resume_id: uuid.UUID | str | None = None,
    job_id: uuid.UUID | str | None = None,
    user_id: str | None = None,
) -> AnswerWithCitations:
    retrieved = await retrieve(db, owner_id, question, resume_id=resume_id, job_id=job_id, top_k=8)
    if not retrieved:
        return AnswerWithCitations(answer="Not enough information available.", citations=[], grounded=False)

    top_chunks = rerank(question, retrieved, final_k=5)
    if not top_chunks or all(sc.rerank_score <= 0 for sc in top_chunks):
        return AnswerWithCitations(answer="Not enough information available.", citations=[], grounded=False)

    context_block = "\n\n".join(
        f"[chunk_index={i}] (document: {sc.document.title})\n{sc.chunk.content}"
        for i, sc in enumerate(top_chunks)
    )
    prompt = _ANSWER_PROMPT_TEMPLATE.format(question=question, context_block=context_block)

    result = await run_structured(
        prompt,
        AnswerWithCitations,
        operation="rag_answer",
        user_id=user_id,
        db=db,
        prompt_version="v1",
    )

    # Attach real document/chunk metadata to whatever chunk_index the LLM cited.
    enriched_citations: list[Citation] = []
    for citation in result.citations:
        idx = citation.chunk_index
        if idx is not None and 0 <= idx < len(top_chunks):
            sc = top_chunks[idx]
            enriched_citations.append(
                Citation(
                    document_id=sc.document.id,
                    title=sc.document.title,
                    chunk_index=sc.chunk.chunk_index,
                    snippet=sc.chunk.content[:280],
                )
            )
    result.citations = enriched_citations or result.citations
    return result
