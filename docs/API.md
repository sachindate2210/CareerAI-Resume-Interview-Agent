# CareerAI API contract

Base URL: `/api`. All routes except `/auth/*` and `/health` require `Authorization: Bearer <access_token>`.
Errors: `{"detail": "<message>"}` with appropriate HTTP status (400/401/403/404/422/500). Paginated
list endpoints accept `?page=1&page_size=20` and return `{"items": [...], "total": int, "page": int, "page_size": int}`.

## Auth
- `POST /api/auth/register` `{email, password, full_name?}` → `{user, access_token, refresh_token}`
- `POST /api/auth/login` `{email, password}` → `{access_token, refresh_token, token_type:"bearer"}`
- `POST /api/auth/refresh` `{refresh_token}` → `{access_token, refresh_token}`
- `GET /api/auth/me` → `UserRead`

## Resumes
- `POST /api/resumes/upload` multipart file (`.pdf`/`.docx`, ≤10MB) → `{resume_id, status:"processing"}` (parsing runs as a background task; client polls or the response can return parsed result directly for small files — implement synchronously with a background-task fallback is acceptable, but MUST actually parse, not stub)
- `GET /api/resumes` → paginated list of `ResumeRead`
- `GET /api/resumes/{id}` → `ResumeRead` incl. latest `ResumeVersion` parsed JSON
- `POST /api/resumes/{id}/analyze` → `ResumeAnalysis` (score, strengths, weaknesses, content/quality/ats feedback)

## Jobs
- `POST /api/jobs/analyze` `{raw_description, title?, company?, source_url?}` → creates `Job`+`JobAnalysis`, returns `JobRead` with nested analysis
- `GET /api/jobs` → paginated list
- `GET /api/jobs/{id}` → `JobRead`

## Matching
- `POST /api/match` `{resume_version_id, job_id}` → `MatchResult` (overall + 5 subscores + reasoning + matched/missing skills)
- `GET /api/match/{id}` → stored `MatchResult`

## Skill gap
- `GET /api/match/{id}/skill-gap` → `SkillGapResult` + generated `LearningPlan` (weekly roadmap)

## Optimizer
- `POST /api/resume/optimize` `{resume_version_id, job_id, sections?: ["summary","experience","projects","skills"]}` → per-section before/after, creates a new `ResumeVersion` (source="ai_optimized") only when the caller confirms via `POST /api/resume/optimize/commit {resume_version_id, job_id, accepted_sections}`
- `POST /api/resume/optimize/section` `{resume_version_id, job_id, section}` → regenerate a single section

## Resume export
- `GET /api/resumes/versions/{version_id}/export?format=pdf|docx` → file download

## Interviews
- `POST /api/interviews` `{resume_version_id?, job_id?, mode: "technical"|"behavioral"|"resume_based"|"mixed", num_questions?}` → `InterviewRead` (status in_progress) + first question
- `GET /api/interviews/{id}` → `InterviewRead` with question/answer history
- `POST /api/interviews/{id}/answer` `{answer_text}` → next question or completion signal (also available over WebSocket, see below)
- `POST /api/interviews/{id}/complete` → forces evaluation now, returns `InterviewEvaluationOut`
- `WS /api/interviews/{id}/ws` — messages `{"type":"answer","text":...}` from client; server sends `{"type":"question",...}`, `{"type":"evaluating"}`, `{"type":"evaluation", ...}`, `{"type":"complete", evaluation}`, `{"type":"error", detail}`

## RAG / Career Q&A
- `POST /api/rag/ask` `{question, resume_id?, job_id?}` → `{answer, citations: [{document_id, title, chunk_index, snippet}]}`

## Analytics / dashboard
- `GET /api/analytics/dashboard` → `{resume_score, ats_score, job_match_score, interview_readiness, skills_detected, missing_skills, recent_analyses, recent_interviews, recommended_improvements}`

## Learning plan
- `GET /api/learning-plan/{id}` → `LearningPlan`
