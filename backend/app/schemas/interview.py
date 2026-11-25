from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

from app.models.interview import InterviewMode, InterviewStatus


class InterviewCreate(BaseModel):
    mode: InterviewMode
    resume_version_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None


class InterviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_id: uuid.UUID
    resume_version_id: uuid.UUID | None
    job_id: uuid.UUID | None
    mode: InterviewMode
    status: InterviewStatus
    difficulty_level: int
    langgraph_thread_id: str
    created_at: datetime


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    interview_id: uuid.UUID
    sequence: int
    question: str
    topic: str
    question_type: str
    difficulty: int


class AnswerSubmit(BaseModel):
    question_id: uuid.UUID
    answer_text: str


class AnswerEvaluationOut(BaseModel):
    """Grounded only in the exact answer text submitted for this question — the evaluator
    is instructed to quote the answer rather than infer beyond it.
    """

    correctness: str | None = None
    depth: str | None = None
    communication_notes: str | None = None
    missing_points: list[str] = Field(default_factory=list)
    better_answer: str | None = None
    strengths: list[str] = Field(default_factory=list)
    follow_up_topic: str | None = None


class QuestionFeedbackOut(BaseModel):
    """Per-question feedback in the final evaluation. `question_id`/`question`/`answer_text`
    are always populated deterministically from the actual transcript (never LLM-authored, so
    they can't be misquoted); `what_went_well`/`what_was_missing`/`better_answer`/
    `follow_up_topic` are the LLM's grounded judgment of that specific answer.
    """

    question_id: uuid.UUID
    question: str
    answer_text: str | None = None
    what_went_well: list[str] = Field(default_factory=list)
    what_was_missing: list[str] = Field(default_factory=list)
    better_answer: str | None = None
    follow_up_topic: str | None = None


class InterviewEvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    interview_id: uuid.UUID
    overall_score: float
    technical_score: float
    communication_score: float
    problem_solving_score: float
    confidence_score: float
    resume_knowledge_score: float
    summary: str
    question_feedback: list[QuestionFeedbackOut]


# --- WebSocket message envelopes -------------------------------------------------


class WSQuestionMessage(BaseModel):
    type: Literal["question"] = "question"
    question: QuestionOut


class WSEvaluatingMessage(BaseModel):
    type: Literal["evaluating"] = "evaluating"
    question_id: uuid.UUID


class WSEvaluationMessage(BaseModel):
    type: Literal["evaluation"] = "evaluation"
    question_id: uuid.UUID
    evaluation: AnswerEvaluationOut


class WSCompleteMessage(BaseModel):
    type: Literal["complete"] = "complete"
    evaluation: InterviewEvaluationOut


class WSErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    detail: str


WSServerMessage = Annotated[
    Union[WSQuestionMessage, WSEvaluatingMessage, WSEvaluationMessage, WSCompleteMessage, WSErrorMessage],
    Field(discriminator="type"),
]
