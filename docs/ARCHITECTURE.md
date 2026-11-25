# CareerAI — Architecture

CareerAI is an AI-native career platform: resume parsing → analysis → job matching → skill-gap
analysis → ATS scoring → tailored resume generation → adaptive AI mock interviews → evaluation →
personalized improvement plans.

## 1. Technology decisions

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Recharts | Server components for fast initial load, file-based routing matches our page list, shadcn gives accessible unstyled primitives (no "AI generated" look), Recharts is lightweight for score gauges/radars. |
| Backend | FastAPI + Pydantic v2 + SQLAlchemy 2.0 (async) | Native async fits LLM/IO-bound workloads, Pydantic gives us the structured-output contracts we need for every agent, first-class OpenAPI docs. |
| DB | PostgreSQL 16 + `pgvector` | One database for relational data *and* embeddings — no separate vector DB to operate, `pgvector` cosine search is enough at portfolio scale, ACID guarantees for resume/interview state. |
| Cache / Queue | Redis + Celery | Resume parsing + embedding + LLM calls are slow; uploads must return immediately and process in the background. Redis also backs rate-limiting and the WebSocket pub/sub fan-out. |
| AI orchestration | LangChain (tools, retrievers, structured output) + LangGraph (stateful agent graphs) | LangGraph's checkpointed state machine is the right fit for the interview agent (memory, follow-ups, difficulty adjustment) and for the multi-step optimizer pipeline. Plain LangChain chains are used where a single structured LLM call suffices — no graph needed there. |
| LLM provider | Anthropic Claude (`claude-sonnet-5` default, configurable) via `langchain-anthropic` | Strong structured-output + tool-use reliability; provider is abstracted behind `app/core/llm.py` so it can be swapped. |
| Auth | JWT (access + refresh) with `passlib[bcrypt]` | Stateless, simple to reason about, standard for a portfolio SaaS; refresh tokens stored hashed in DB for revocation. |
| File storage | Storage abstraction (`app/services/storage.py`) — local disk in dev, S3-compatible (MinIO/AWS) in prod via the same interface | Lets us run entirely locally with `docker compose` while the code path is production-realistic. |
| Realtime | WebSockets (FastAPI native) for the interview loop | Interview is inherently turn-based + streaming feedback; WS is simpler than SSE for bidirectional turn state and works well with LangGraph streaming. |

## 2. High-level architecture

```
                        ┌─────────────────────┐
                        │   Next.js Frontend   │
                        │ (dashboard, upload,  │
                        │  interview UI, etc.) │
                        └──────────┬───────────┘
                        REST + WS  │
                        ┌──────────▼───────────┐
                        │   FastAPI Backend     │
                        │  api/ → services/ →   │
                        │  agents/ (LangGraph)  │
                        └──┬────────┬────────┬──┘
                           │        │        │
                 ┌─────────▼──┐ ┌───▼───┐ ┌──▼──────────┐
                 │ PostgreSQL │ │ Redis │ │ Celery worker│
                 │ + pgvector │ │ queue │ │ (parse/embed/│
                 │            │ │       │ │  analyze)    │
                 └────────────┘ └───────┘ └──────────────┘
                                                  │
                                          ┌────────▼────────┐
                                          │  Anthropic Claude│
                                          └─────────────────┘
```

## 3. Agent architecture

```
                         Orchestrator (LangGraph, per-flow)
                                     │
        ┌────────────────┬──────────┼──────────┬───────────────┐
        ▼                ▼          ▼          ▼               ▼
  Resume Agent       Job Agent   Match Engine  Optimizer Agent  Interview Agent
   - parse (det.)   - JD extract  (deterministic  - gap detect   (LangGraph state
   - structure LLM    (LLM,        scoring +       - section       machine, see §5)
     extraction       structured)  LLM rationale)   rewrite (LLM,
   - analyzer (LLM)                                 grounded in
   - ATS check (det.                                 source resume)
     rules + LLM)
```

Design principle: **agents only where LLM reasoning is required**; scoring math, keyword
diffing, and section structure checks are deterministic Python. This keeps costs low and
outputs reproducible/testable.

## 4. RAG pipeline

Knowledge base per user: resume, job descriptions, interview prep notes, uploaded docs.

```
Document → Parser (pdfplumber / python-docx) → Chunker (recursive, ~500 tok, 50 overlap)
  → Embeddings (voyage-3 via langchain, stored in pgvector) → Retriever (top-k cosine)
  → Reranker (cross-encoder-lite: LLM relevance re-score of top-k) → LLM answer w/ citations
```

`DocumentChunk` rows store `source_document_id`, `chunk_index`, `content`, `embedding vector(1024)`.
Retrieval is used by: the Interview Agent (grounding follow-up questions in resume/JD chunks with
citation of which document a claim came from), and a "Career Q&A" RAG endpoint that answers
questions against the user's own documents only (never across users).

## 5. Interview agent state machine (LangGraph)

State (`InterviewState`, a `TypedDict`/Pydantic model checkpointed per session):
```
session_id, mode, resume_context, job_context, history: list[QA],
current_difficulty, current_topic, questions_asked, scores_running, remaining_turns
```

Graph nodes:
```
question_generator → (interrupt: wait for user answer) → answer_evaluator
   → difficulty_adjuster → follow_up_decider → (loop to question_generator | end)
```
- `question_generator`: LLM call, structured output `{question, topic, type}`, conditioned on
  full history + resume/JD RAG context — never a static bank.
- `answer_evaluator`: LLM structured output `{correctness, depth, communication_notes, missing_points}`.
- `difficulty_adjuster`: deterministic function over the last 2 evaluations → raises/lowers a
  1-5 difficulty scalar fed back into the next `question_generator` prompt.
- `follow_up_decider`: LLM decides `needs_follow_up: bool` + reason; if true, loop back with the
  same topic; else move to next topic from the coverage plan.
- Ends when `remaining_turns == 0` or coverage plan exhausted → hands off to Evaluation.

Memory: LangGraph's checkpointer (Postgres-backed) persists `InterviewState` per
`thread_id = interview.id`, so the graph is resumable across WS reconnects and answers
reference earlier turns naturally (state is in the prompt, not re-derived).

## 6. Database schema (see `backend/app/models/`)

Core entities: `User`, `Resume`, `ResumeVersion`, `Job`, `JobAnalysis`, `Skill`,
`ResumeSkill`, `JobSkill`, `MatchAnalysis`, `Interview`, `InterviewQuestion`,
`InterviewAnswer`, `InterviewEvaluation`, `LearningPlan`, `Document`, `DocumentChunk`,
`AIGenerationLog` (prompt/version/latency/token audit trail).

Relationships: `User 1—N Resume 1—N ResumeVersion`; `User 1—N Job 1—1 JobAnalysis`;
`(Resume, Job) 1—1 MatchAnalysis`; `User 1—N Interview 1—N InterviewQuestion 1—1 InterviewAnswer`;
`Interview 1—1 InterviewEvaluation`; `Resume/Job 1—N Document 1—N DocumentChunk`.

## 7. API design

See `backend/app/api/` routers; summarized in root README. All mutating/user-scoped routes
require a JWT bearer token; ownership is checked in the repository layer, not just the router.

## 8. Anti-hallucination guarantees

- Optimizer/rewrite prompts are given the parsed resume JSON as the **only** source of truth and
  are explicitly instructed to never introduce a skill, employer, title, metric, or credential not
  present in that JSON. A post-generation validator diffs named entities (companies, degrees,
  certifications) in the output against the input resume and rejects/retries generations that
  introduce new ones.
- Interview evaluation feedback is generated only from the transcript of that answer — the
  evaluator prompt is passed the exact answer text and is instructed to quote it.
- Any field the LLM cannot ground in provided context is returned as `null` and rendered as
  "Not enough information available."

## 9. Evaluation & observability

Every AI call goes through `app/core/llm.py::run_structured()` which: validates output against a
Pydantic schema (retry once on validation failure with the error appended to the prompt), records
an `AIGenerationLog` row (`model`, `prompt_version`, `latency_ms`, `input_tokens`, `output_tokens`,
`status`), and raises a typed `AIGenerationError` on exhausted retries so callers can fall back
gracefully. `backend/tests/eval/` holds golden-file test cases for resume analysis and interview
evaluation.
