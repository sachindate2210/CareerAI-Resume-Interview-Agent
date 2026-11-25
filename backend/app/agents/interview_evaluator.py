from __future__ import annotations

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm import run_structured
from app.models.interview import Interview, InterviewQuestion
from app.schemas.interview import InterviewEvaluationOut, QuestionFeedbackOut

_EVALUATION_PROMPT = """You are producing a final evaluation for a completed mock interview.
Ground every score and every piece of per-question feedback in the ACTUAL transcript below —
reference real content from each answer, never generic boilerplate ("good job", "could be
better" with no specifics are not acceptable).

Full transcript (sequence number, question, topic, difficulty, candidate's exact answer, and the
per-answer evaluation already computed during the session):
<transcript>
{transcript}
</transcript>

Produce:
- overall_score, technical_score, communication_score, problem_solving_score, confidence_score,
  resume_knowledge_score: each 0-100, grounded in the transcript (resume_knowledge_score should
  reflect how well answers demonstrated genuine familiarity with the candidate's own resume/
  background when relevant questions were asked; if no resume-based questions were asked, base it
  on general self-knowledge shown, and do not simply default to 50).
- summary: a few sentences summarizing overall performance, referencing specific themes from the
  transcript.
- question_judgments: one entry per question in the transcript (including unanswered ones),
  each tagged with its `sequence` number so it can be matched back to the right question. For
  an unanswered question, leave what_went_well/what_was_missing reflecting that it was skipped.
  Do NOT restate the question or answer text yourself — only the judgment fields.
"""


class _QuestionJudgment(BaseModel):
    sequence: int
    what_went_well: list[str] = Field(default_factory=list)
    what_was_missing: list[str] = Field(default_factory=list)
    better_answer: str | None = None
    follow_up_topic: str | None = None


class _EvaluationLLMOutput(BaseModel):
    overall_score: float
    technical_score: float
    communication_score: float
    problem_solving_score: float
    confidence_score: float
    resume_knowledge_score: float
    summary: str
    question_judgments: list[_QuestionJudgment] = Field(default_factory=list)


def _format_transcript(interview: Interview, questions: list[InterviewQuestion]) -> str:
    lines: list[str] = []
    for q in sorted(questions, key=lambda x: x.sequence):
        lines.append(f"Q{q.sequence} [{q.topic} | difficulty {q.difficulty} | {q.question_type}]: {q.question}")
        if q.answer is not None:
            lines.append(f"Answer: {q.answer.answer_text}")
            if q.answer.evaluation_json:
                lines.append(f"Per-answer evaluation: {q.answer.evaluation_json}")
        else:
            lines.append("Answer: (not answered)")
        lines.append("")
    return "\n".join(lines)


async def evaluate_interview(
    db: AsyncSession,
    interview: Interview,
    questions: list[InterviewQuestion],
    *,
    user_id: str | None,
) -> InterviewEvaluationOut:
    """One structured LLM call producing the final interview evaluation, grounded in the full
    transcript (all Q/A pairs plus their per-answer evaluations already computed during the
    session).

    `question_id`/`question`/`answer_text` in the returned per-question feedback are always
    populated deterministically from the actual `InterviewQuestion`/`InterviewAnswer` rows
    (never LLM-authored) — only the judgment fields (what_went_well, what_was_missing,
    better_answer, follow_up_topic) come from the model, matched back by `sequence`.
    """
    transcript = _format_transcript(interview, questions)
    prompt = _EVALUATION_PROMPT.format(transcript=transcript)

    llm_result = await run_structured(
        prompt,
        _EvaluationLLMOutput,
        operation="interview_final_evaluate",
        user_id=user_id,
        db=db,
        prompt_version="v1",
    )

    judgments_by_sequence = {j.sequence: j for j in llm_result.question_judgments}
    question_feedback: list[QuestionFeedbackOut] = []
    for q in sorted(questions, key=lambda x: x.sequence):
        judgment = judgments_by_sequence.get(q.sequence)
        question_feedback.append(
            QuestionFeedbackOut(
                question_id=q.id,
                question=q.question,
                answer_text=q.answer.answer_text if q.answer else None,
                what_went_well=judgment.what_went_well if judgment else [],
                what_was_missing=judgment.what_was_missing if judgment else (["Not answered"] if not q.answer else []),
                better_answer=judgment.better_answer if judgment else None,
                follow_up_topic=judgment.follow_up_topic if judgment else None,
            )
        )

    return InterviewEvaluationOut(
        interview_id=interview.id,
        overall_score=llm_result.overall_score,
        technical_score=llm_result.technical_score,
        communication_score=llm_result.communication_score,
        problem_solving_score=llm_result.problem_solving_score,
        confidence_score=llm_result.confidence_score,
        resume_knowledge_score=llm_result.resume_knowledge_score,
        summary=llm_result.summary,
        question_feedback=question_feedback,
    )
