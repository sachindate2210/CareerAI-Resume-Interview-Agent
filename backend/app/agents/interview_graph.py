"""LangGraph-based adaptive interview agent.

Design notes / deviations from a literal `interrupt()`-based implementation
------------------------------------------------------------------------
The architecture doc describes the graph as
`question_generator -> (interrupt: wait for user answer) -> answer_evaluator -> ...`.
`langgraph==0.2.39` (pinned in requirements.txt) predates the `langgraph.types.interrupt`
human-in-the-loop primitive (added in later 0.2.x/0.3.x releases), and
`langgraph-checkpoint-postgres` requires the `psycopg` (v3) driver which is NOT in
requirements.txt (only `psycopg2-binary`, used by SQLAlchemy, is). Rather than depend on an
unlisted package or an API this pinned version may not have, this module uses the
"manual step-function" pattern explicitly permitted by the task brief:

- ONE `StateGraph` is built with all the nodes described in the architecture
  (`question_generator`, `answer_evaluator`, `difficulty_adjuster`, `follow_up_decider`) and
  real conditional edges between them, so the state machine shape is faithfully represented
  and unit-testable.
- Instead of a mid-graph `interrupt`, the graph has a `router` entry node: when there is no
  pending answer to process it routes straight to `question_generator`, which always leads to
  END (a "turn" that only produces a question). When a `pending_answer` is present it routes to
  `answer_evaluator -> difficulty_adjuster -> follow_up_decider`, which conditionally loops back
  to `question_generator` (same or next topic) or to END (interview finished). This means each
  WebSocket/HTTP turn is exactly one `ainvoke()` of the same compiled graph — no interrupt
  primitive is needed because "waiting for the user's answer" is simply "the graph is not
  invoked again until the next message arrives".
- Durable state: rather than relying on LangGraph's checkpointer as the source of truth (which
  would require the unavailable `psycopg` v3 driver), the *actual* durable state is the
  already-modeled Postgres rows (`Interview`, `InterviewQuestion`, `InterviewAnswer`) — these are
  reconstructed into an `InterviewState` at the start of every turn in `start_interview` /
  `submit_answer`, which is what makes the interview resumable across WebSocket reconnects.
  `get_checkpointer()` is still provided and used when available (best-effort, see below) to
  stay aligned with the architecture doc; if constructing it fails for any reason (driver
  missing, DB unreachable) the graph simply runs without a checkpointer.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, TypedDict

import structlog
from langgraph.graph import END, StateGraph
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.llm import run_structured
from app.models.interview import Interview, InterviewAnswer, InterviewMode, InterviewQuestion
from app.schemas.interview import AnswerEvaluationOut, QuestionOut

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Coverage plans (deterministic; NEVER a static question bank — only topic labels that
# steer the LLM question_generator, which always writes the actual question text).
# ---------------------------------------------------------------------------


def _coverage_plan_for_mode(mode: InterviewMode, resume_context: dict | None, job_context: dict | None) -> list[str]:
    if mode == InterviewMode.technical:
        topics = [
            "data structures & algorithms",
            "system design",
            "language/framework proficiency",
            "debugging & problem solving",
            "testing & code quality",
        ]
        if job_context and job_context.get("technologies"):
            topics.insert(1, f"hands-on experience with {', '.join(job_context['technologies'][:3])}")
        return topics
    if mode == InterviewMode.behavioral:
        return [
            "teamwork & collaboration",
            "conflict resolution",
            "leadership & ownership",
            "handling failure or mistakes",
            "communication & stakeholder management",
        ]
    if mode == InterviewMode.resume_based:
        topics: list[str] = []
        if resume_context:
            for exp in (resume_context.get("experience") or [])[:3]:
                label = exp.get("title") or exp.get("company")
                if label:
                    topics.append(f"your experience at {label}")
            for proj in (resume_context.get("projects") or [])[:2]:
                if proj.get("name"):
                    topics.append(f"your project '{proj['name']}'")
        if not topics:
            topics = ["your professional background", "a notable accomplishment", "your career goals"]
        return topics
    # mixed
    return [
        "your professional background",
        "data structures & algorithms",
        "teamwork & collaboration",
        "system design",
        "handling failure or mistakes",
    ]


def get_max_questions(mode: InterviewMode, resume_context: dict | None, job_context: dict | None) -> int:
    """Total question budget for an interview of this mode — the single source of truth
    shared by the graph's own `max_questions` state and the API layer (so a client's
    displayed "Question N / total" always matches the graph's actual stopping point).
    """
    return len(_coverage_plan_for_mode(mode, resume_context, job_context)) + 3


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------


class InterviewState(TypedDict, total=False):
    interview_id: str
    mode: str
    resume_context: dict[str, Any] | None
    job_context: dict[str, Any] | None
    history: list[dict[str, Any]]
    current_difficulty: int
    current_topic: str | None
    is_follow_up: bool
    questions_asked: int
    max_questions: int
    coverage_plan: list[str]
    topics_asked: list[str]
    followed_up_topics: list[str]
    last_question: dict[str, Any] | None
    pending_answer: str | None
    last_evaluation: dict[str, Any] | None
    finished: bool


@dataclass
class QuestionEvent:
    question: QuestionOut


@dataclass
class CompletionEvent:
    finished: bool = True


# ---------------------------------------------------------------------------
# Internal LLM-facing schemas
# ---------------------------------------------------------------------------

from pydantic import BaseModel, Field  # noqa: E402


class _QuestionDraft(BaseModel):
    question: str
    topic: str
    question_type: str = Field(description="e.g. 'technical', 'behavioral', 'follow_up', 'resume_based'")


class _FollowUpDecision(BaseModel):
    needs_follow_up: bool
    reason: str


# ---------------------------------------------------------------------------
# Node implementations (factory so nodes can close over `db`/`user_id`)
# ---------------------------------------------------------------------------

_QUESTION_PROMPT = """You are conducting a live {mode} mock interview. Generate the NEXT interview
question yourself — never reuse a canned/static question bank.

Candidate resume context (may be null if not provided):
<resume_context>
{resume_context}
</resume_context>

Target job context (may be null if not provided):
<job_context>
{job_context}
</job_context>

Conversation so far (question/answer/evaluation history, oldest first):
<history>
{history}
</history>

Current difficulty level (1=easiest, 5=hardest): {difficulty}
Topic to cover now: "{topic}"
{follow_up_instruction}

Write ONE question appropriate for this topic and difficulty level. Keep it concise and specific
(not generic). Set `question_type` to a short label (e.g. "technical", "behavioral",
"follow_up", "resume_based").
"""

_EVAL_PROMPT = """You are evaluating a candidate's answer in a live mock interview. You must ground
your evaluation ONLY in the exact answer text below — quote or closely reference specific phrases
from it rather than making generic statements.

Question asked (topic: {topic}, difficulty: {difficulty}): {question}

Candidate's exact answer:
<answer>
{answer}
</answer>

Provide: correctness (is the technical/factual content right, referencing specifics from the
answer), depth (how thorough vs superficial, citing what was or wasn't covered), communication_notes
(clarity/structure of the answer), missing_points (concrete gaps, grounded in what's absent from
the answer), better_answer (a brief example of a stronger answer), strengths (specific things done
well, quoting the answer where useful), and follow_up_topic (a specific sub-topic worth probing
further, or null if none).
"""

_FOLLOWUP_PROMPT = """Based on the candidate's last answer and its evaluation, decide whether a
follow-up question on the SAME topic ("{topic}") would meaningfully deepen the assessment, or
whether the interview should move on to a new topic.

Evaluation of the last answer:
{evaluation}

Return `needs_follow_up` (true/false) and a one-sentence `reason` grounded in the evaluation above.
"""


def _evaluation_strength(evaluation: dict[str, Any]) -> int:
    """Deterministic heuristic used by `difficulty_adjuster`: +1 strong, -1 weak, 0 neutral."""
    strengths = len(evaluation.get("strengths") or [])
    missing = len(evaluation.get("missing_points") or [])
    correctness = (evaluation.get("correctness") or "").lower()
    if any(term in correctness for term in ("incorrect", "wrong", "inaccurate")):
        return -1
    if strengths > missing:
        return 1
    if missing > strengths:
        return -1
    return 0


def build_interview_graph(*, db: AsyncSession, user_id: str | None):
    async def router(state: InterviewState) -> dict[str, Any]:
        # Pure routing node (see `route_decision` below) — this LangGraph version requires
        # every node to write at least one channel, so write back a value unchanged as a
        # harmless no-op rather than returning an empty update.
        return {"finished": state.get("finished", False)}

    def route_decision(state: InterviewState) -> str:
        return "evaluate" if state.get("pending_answer") is not None else "generate"

    async def question_generator(state: InterviewState) -> dict[str, Any]:
        topic = state.get("current_topic") or (state["coverage_plan"][0] if state["coverage_plan"] else "general")
        follow_up_instruction = (
            "This is a FOLLOW-UP question on the same topic — probe deeper based on the candidate's "
            "previous answer instead of introducing a new subject."
            if state.get("is_follow_up")
            else ""
        )
        prompt = _QUESTION_PROMPT.format(
            mode=state.get("mode", "mixed"),
            resume_context=state.get("resume_context"),
            job_context=state.get("job_context"),
            history=state.get("history", []),
            difficulty=state.get("current_difficulty", 3),
            topic=topic,
            follow_up_instruction=follow_up_instruction,
        )
        draft = await run_structured(
            prompt,
            _QuestionDraft,
            operation="interview_question_generate",
            user_id=user_id,
            db=db,
            prompt_version="v1",
        )
        last_question = {
            "question": draft.question,
            "topic": draft.topic or topic,
            "question_type": draft.question_type,
            "difficulty": state.get("current_difficulty", 3),
        }
        topics_asked = list(state.get("topics_asked", []))
        if last_question["topic"] not in topics_asked:
            topics_asked.append(last_question["topic"])
        return {
            "last_question": last_question,
            "current_topic": last_question["topic"],
            "topics_asked": topics_asked,
            "questions_asked": state.get("questions_asked", 0) + 1,
        }

    async def answer_evaluator(state: InterviewState) -> dict[str, Any]:
        question = state.get("last_question") or {}
        answer_text = state.get("pending_answer") or ""
        prompt = _EVAL_PROMPT.format(
            topic=question.get("topic", "general"),
            difficulty=question.get("difficulty", 3),
            question=question.get("question", ""),
            answer=answer_text,
        )
        evaluation = await run_structured(
            prompt,
            AnswerEvaluationOut,
            operation="interview_answer_evaluate",
            user_id=user_id,
            db=db,
            prompt_version="v1",
        )
        evaluation_dict = evaluation.model_dump()
        history_entry = {
            "question": question.get("question"),
            "topic": question.get("topic"),
            "question_type": question.get("question_type"),
            "difficulty": question.get("difficulty"),
            "answer": answer_text,
            "evaluation": evaluation_dict,
        }
        new_history = list(state.get("history", [])) + [history_entry]
        return {"history": new_history, "last_evaluation": evaluation_dict, "pending_answer": None}

    async def difficulty_adjuster(state: InterviewState) -> dict[str, Any]:
        history = state.get("history", [])
        last_two = history[-2:]
        if len(last_two) == 2:
            strengths = [_evaluation_strength(h["evaluation"]) for h in last_two]
            current = state.get("current_difficulty", 3)
            if all(s == 1 for s in strengths):
                new_difficulty = min(5, current + 1)
            elif all(s == -1 for s in strengths):
                new_difficulty = max(1, current - 1)
            else:
                new_difficulty = current
            return {"current_difficulty": new_difficulty}
        return {"current_difficulty": state.get("current_difficulty", 3)}

    async def follow_up_decider(state: InterviewState) -> dict[str, Any]:
        current_topic = state.get("current_topic")
        followed_up_topics = list(state.get("followed_up_topics", []))
        questions_asked = state.get("questions_asked", 0)
        max_questions = state.get("max_questions", 6)

        guard_topic_already_followed = current_topic in followed_up_topics
        reached_question_cap = questions_asked >= max_questions

        needs_follow_up = False
        if not guard_topic_already_followed and not reached_question_cap:
            decision = await run_structured(
                _FOLLOWUP_PROMPT.format(topic=current_topic, evaluation=state.get("last_evaluation")),
                _FollowUpDecision,
                operation="interview_follow_up_decide",
                user_id=user_id,
                db=db,
                prompt_version="v1",
                fast=True,
            )
            needs_follow_up = decision.needs_follow_up

        topics_asked = state.get("topics_asked", [])
        coverage_plan = state.get("coverage_plan", [])
        remaining_topics = [t for t in coverage_plan if t not in topics_asked]

        if reached_question_cap:
            return {"finished": True}

        if needs_follow_up:
            return {
                "finished": False,
                "current_topic": current_topic,
                "is_follow_up": True,
                "followed_up_topics": followed_up_topics + [current_topic],
            }

        if not remaining_topics:
            return {"finished": True}

        return {"finished": False, "current_topic": remaining_topics[0], "is_follow_up": False}

    def follow_up_route(state: InterviewState) -> str:
        return "end" if state.get("finished") else "next_question"

    graph = StateGraph(InterviewState)
    graph.add_node("router", router)
    graph.add_node("question_generator", question_generator)
    graph.add_node("answer_evaluator", answer_evaluator)
    graph.add_node("difficulty_adjuster", difficulty_adjuster)
    graph.add_node("follow_up_decider", follow_up_decider)

    graph.set_entry_point("router")
    graph.add_conditional_edges(
        "router", route_decision, {"generate": "question_generator", "evaluate": "answer_evaluator"}
    )
    graph.add_edge("question_generator", END)
    graph.add_edge("answer_evaluator", "difficulty_adjuster")
    graph.add_edge("difficulty_adjuster", "follow_up_decider")
    graph.add_conditional_edges(
        "follow_up_decider", follow_up_route, {"next_question": "question_generator", "end": END}
    )

    checkpointer = get_checkpointer()
    return graph.compile(checkpointer=checkpointer) if checkpointer else graph.compile()


def get_checkpointer():
    """Best-effort Postgres-backed checkpointer using the sync DB URL. Returns None (and logs a
    warning) if the required driver/backing store isn't available, so the graph still runs
    correctly using DB-row-reconstructed state as the actual source of truth (see module
    docstring).
    """
    settings = get_settings()
    try:
        from langgraph.checkpoint.postgres import PostgresSaver

        cm = PostgresSaver.from_conn_string(settings.SYNC_DATABASE_URL)
        saver = cm.__enter__()  # kept open for process lifetime; acceptable for this app's scale
        saver.setup()
        return saver
    except Exception as exc:  # noqa: BLE001
        logger.warning("interview_checkpointer_unavailable", error=str(exc))
        return None


# ---------------------------------------------------------------------------
# State reconstruction from durable DB rows
# ---------------------------------------------------------------------------


def _build_initial_state(
    interview: Interview,
    *,
    resume_context: dict[str, Any] | None,
    job_context: dict[str, Any] | None,
    max_questions: int | None = None,
) -> InterviewState:
    coverage_plan = _coverage_plan_for_mode(interview.mode, resume_context, job_context)
    return InterviewState(
        interview_id=str(interview.id),
        mode=interview.mode.value,
        resume_context=resume_context,
        job_context=job_context,
        history=[],
        current_difficulty=interview.difficulty_level,
        current_topic=coverage_plan[0] if coverage_plan else "general",
        is_follow_up=False,
        questions_asked=0,
        max_questions=max_questions or (len(coverage_plan) + 3),
        coverage_plan=coverage_plan,
        topics_asked=[],
        followed_up_topics=[],
        last_question=None,
        pending_answer=None,
        last_evaluation=None,
        finished=False,
    )


def _reconstruct_state(
    interview: Interview,
    questions: list[InterviewQuestion],
    *,
    resume_context: dict[str, Any] | None,
    job_context: dict[str, Any] | None,
    pending_answer: str | None,
) -> InterviewState:
    coverage_plan = _coverage_plan_for_mode(interview.mode, resume_context, job_context)
    history: list[dict[str, Any]] = []
    topics_asked: list[str] = []
    followed_up_topics: list[str] = []
    topic_counts: dict[str, int] = {}
    last_question_dict: dict[str, Any] | None = None
    current_difficulty = interview.difficulty_level

    # Count topic occurrences across ALL questions asked so far (answered or still
    # pending an answer) — a follow-up already asked (even if not yet answered) must
    # still block a second follow-up on the same topic once its answer comes back.
    for q in questions:
        topic_counts[q.topic] = topic_counts.get(q.topic, 0) + 1
        if topic_counts[q.topic] > 1 and q.topic not in followed_up_topics:
            followed_up_topics.append(q.topic)

    answered_questions = [q for q in questions if q.answer is not None]
    for q in answered_questions:
        current_difficulty = q.difficulty
        if q.topic not in topics_asked:
            topics_asked.append(q.topic)
        history.append(
            {
                "question": q.question,
                "topic": q.topic,
                "question_type": q.question_type,
                "difficulty": q.difficulty,
                "answer": q.answer.answer_text,
                "evaluation": q.answer.evaluation_json or {},
            }
        )

    pending_question = next((q for q in questions if q.answer is None), None)
    if pending_question is not None:
        current_difficulty = pending_question.difficulty
        last_question_dict = {
            "question": pending_question.question,
            "topic": pending_question.topic,
            "question_type": pending_question.question_type,
            "difficulty": pending_question.difficulty,
        }
        if pending_question.topic not in topics_asked:
            topics_asked.append(pending_question.topic)

    return InterviewState(
        interview_id=str(interview.id),
        mode=interview.mode.value,
        resume_context=resume_context,
        job_context=job_context,
        history=history,
        current_difficulty=current_difficulty,
        current_topic=(pending_question.topic if pending_question else (coverage_plan[0] if coverage_plan else "general")),
        is_follow_up=False,
        questions_asked=len(questions),
        max_questions=len(coverage_plan) + 3,
        coverage_plan=coverage_plan,
        topics_asked=topics_asked,
        followed_up_topics=followed_up_topics,
        last_question=last_question_dict,
        pending_answer=pending_answer,
        last_evaluation=None,
        finished=False,
    )


def _question_out_from_state(state: dict[str, Any], *, interview_id: uuid.UUID, question_row: InterviewQuestion) -> QuestionOut:
    return QuestionOut(
        id=question_row.id,
        interview_id=interview_id,
        sequence=question_row.sequence,
        question=question_row.question,
        topic=question_row.topic,
        question_type=question_row.question_type,
        difficulty=question_row.difficulty,
    )


# ---------------------------------------------------------------------------
# Public service-facing API
# ---------------------------------------------------------------------------


async def start_interview(
    db: AsyncSession,
    interview: Interview,
    *,
    resume_context: dict[str, Any] | None,
    job_context: dict[str, Any] | None,
    user_id: str | None,
) -> QuestionEvent:
    """Runs the graph until it produces the first question (a single 'generate' turn)."""
    state = _build_initial_state(interview, resume_context=resume_context, job_context=job_context)
    compiled = build_interview_graph(db=db, user_id=user_id)
    config = {"configurable": {"thread_id": interview.langgraph_thread_id}}
    result = await compiled.ainvoke(state, config=config)

    last_question = result["last_question"]
    question_row = InterviewQuestion(
        interview_id=interview.id,
        sequence=1,
        question=last_question["question"],
        topic=last_question["topic"],
        question_type=last_question["question_type"],
        difficulty=last_question["difficulty"],
    )
    db.add(question_row)
    await db.commit()
    await db.refresh(question_row)

    return QuestionEvent(question=_question_out_from_state(result, interview_id=interview.id, question_row=question_row))


async def submit_answer(
    db: AsyncSession,
    interview: Interview,
    questions: list[InterviewQuestion],
    answer_text: str,
    *,
    resume_context: dict[str, Any] | None,
    job_context: dict[str, Any] | None,
    user_id: str | None,
) -> QuestionEvent | CompletionEvent:
    """Reconstructs state from durable DB rows, resumes the graph with the submitted answer,
    persists the answer + evaluation, and returns either the next question or a completion signal.
    """
    pending_question = next((q for q in questions if q.answer is None), None)
    if pending_question is None:
        raise ValueError("No pending question awaiting an answer for this interview.")

    state = _reconstruct_state(
        interview, questions, resume_context=resume_context, job_context=job_context, pending_answer=answer_text
    )
    compiled = build_interview_graph(db=db, user_id=user_id)
    config = {"configurable": {"thread_id": interview.langgraph_thread_id}}
    result = await compiled.ainvoke(state, config=config)

    evaluation_dict = result["history"][-1]["evaluation"]
    from datetime import datetime, timezone

    answer_row = InterviewAnswer(
        question_id=pending_question.id,
        answer_text=answer_text,
        submitted_at=datetime.now(timezone.utc),
        evaluation_json=evaluation_dict,
    )
    db.add(answer_row)
    interview.difficulty_level = result.get("current_difficulty", interview.difficulty_level)
    await db.commit()

    if result.get("finished"):
        return CompletionEvent(finished=True)

    last_question = result["last_question"]
    next_sequence = max((q.sequence for q in questions), default=0) + 1
    question_row = InterviewQuestion(
        interview_id=interview.id,
        sequence=next_sequence,
        question=last_question["question"],
        topic=last_question["topic"],
        question_type=last_question["question_type"],
        difficulty=last_question["difficulty"],
    )
    db.add(question_row)
    await db.commit()
    await db.refresh(question_row)

    return QuestionEvent(question=_question_out_from_state(result, interview_id=interview.id, question_row=question_row))
