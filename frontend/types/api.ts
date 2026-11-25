// Types mirror docs/API.md exactly. Field names use snake_case to match the
// FastAPI/Pydantic backend responses verbatim (no camelCase remapping).

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ApiError {
  detail: string;
}

// ---------- Auth ----------

export interface UserRead {
  id: string;
  email: string;
  full_name?: string | null;
  is_active?: boolean;
  /** Super admin: every permission plus role management. */
  is_admin?: boolean;
  role?: { id: string; name: string } | null;
  /** Effective permissions `{module: [action]}` from /api/auth/me. UI hint only; the API enforces. */
  permissions?: Record<string, string[]>;
  impersonator?: { id: string; email: string; full_name?: string | null } | null;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type?: string;
}

export interface RegisterResponse extends AuthTokens {
  user: UserRead;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name?: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

// ---------- Resumes ----------

export type ResumeStatus = "processing" | "parsed" | "failed";

export interface ResumeUploadResponse {
  resume_id: string;
  status: ResumeStatus;
}

export interface ResumeExperienceEntry {
  title?: string | null;
  company?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description?: string | null;
  bullets?: string[];
}

export interface ResumeEducationEntry {
  institution?: string | null;
  degree?: string | null;
  field_of_study?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface ResumeProjectEntry {
  name?: string | null;
  description?: string | null;
  technologies?: string[];
}

export interface ResumeCertificationEntry {
  name?: string | null;
  issuer?: string | null;
  date?: string | null;
}

export interface ParsedResumeContent {
  summary?: string | null;
  skills?: string[];
  experience?: ResumeExperienceEntry[];
  education?: ResumeEducationEntry[];
  projects?: ResumeProjectEntry[];
  certifications?: ResumeCertificationEntry[];
}

export interface ResumeVersion {
  id: string;
  resume_id: string;
  source: "uploaded" | "ai_optimized";
  parsed_content: ParsedResumeContent;
  created_at: string;
}

export interface ResumeRead {
  id: string;
  user_id: string;
  filename: string;
  status: ResumeStatus;
  created_at: string;
  latest_version?: ResumeVersion | null;
}

export interface ResumeAnalysis {
  score: number;
  strengths: string[];
  weaknesses: string[];
  content_feedback?: Record<string, string>;
  quality_feedback?: Record<string, string>;
  ats_feedback?: Record<string, string | boolean>;
}

// ---------- Jobs ----------

export interface JobAnalysis {
  job_title?: string | null;
  company?: string | null;
  required_skills: string[];
  preferred_skills: string[];
  responsibilities: string[];
  technologies: string[];
  keywords: string[];
}

export interface JobRead {
  id: string;
  raw_description: string;
  title?: string | null;
  company?: string | null;
  source_url?: string | null;
  created_at: string;
  analysis: JobAnalysis | null;
}

export interface JobAnalyzeRequest {
  raw_description: string;
  title?: string;
  company?: string;
  source_url?: string;
}

// ---------- Matching ----------

export interface MatchSubscore {
  name: string;
  score: number;
  reasoning: string;
}

export interface MatchResult {
  id: string;
  resume_version_id: string;
  job_id: string;
  overall_score: number;
  subscores: MatchSubscore[];
  matched_skills: string[];
  missing_skills: string[];
  created_at: string;
}

export interface MatchRequest {
  resume_version_id: string;
  job_id: string;
}

// ---------- Skill gap / learning plan ----------

export type SkillPriority = "critical" | "important" | "nice_to_have";

export interface SkillGapItem {
  skill: string;
  priority: SkillPriority;
}

export interface SkillGapResult {
  id?: string;
  match_id: string;
  have_skills: string[];
  missing_skills: SkillGapItem[];
  learning_plan: LearningPlan;
}

export interface LearningPlanWeek {
  week: number;
  focus: string;
  tasks: string[];
  resources?: string[];
  skills: string[];
  priority: SkillPriority;
}

export interface LearningPlan {
  id: string;
  match_id?: string;
  weeks: LearningPlanWeek[];
  created_at?: string;
}

// ---------- Optimizer ----------

export type OptimizerSection =
  | "summary"
  | "experience"
  | "projects"
  | "skills";

export interface OptimizeSectionResult {
  section: OptimizerSection;
  before: string;
  after: string;
  rationale?: string;
}

export interface OptimizeResumeRequest {
  resume_version_id: string;
  job_id: string;
  sections?: OptimizerSection[];
}

export interface OptimizeResumeResponse {
  resume_version_id: string;
  job_id: string;
  sections: OptimizeSectionResult[];
}

export interface OptimizeSectionRequest {
  resume_version_id: string;
  job_id: string;
  section: OptimizerSection;
}

export interface OptimizeCommitRequest {
  resume_version_id: string;
  job_id: string;
  accepted_sections: OptimizerSection[];
}

export interface OptimizeCommitResponse {
  new_resume_version: ResumeVersion;
}

// ---------- Interviews ----------

export type InterviewMode =
  | "technical"
  | "behavioral"
  | "resume_based"
  | "mixed";

export type InterviewStatus = "in_progress" | "completed";

export interface InterviewQuestion {
  id: string;
  index: number;
  question: string;
  topic?: string | null;
  type?: string | null;
}

export interface InterviewAnswer {
  question_id: string;
  answer_text: string;
}

export interface InterviewRead {
  id: string;
  user_id: string;
  mode: InterviewMode;
  status: InterviewStatus;
  resume_version_id?: string | null;
  job_id?: string | null;
  num_questions: number;
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  current_question?: InterviewQuestion | null;
  created_at: string;
}

export interface CreateInterviewRequest {
  resume_version_id?: string;
  job_id?: string;
  mode: InterviewMode;
  num_questions?: number;
}

export interface AnswerRequest {
  answer_text: string;
}

export interface SubScore {
  name: string;
  score: number;
}

export interface QuestionFeedback {
  question_id: string;
  question: string;
  answer_text: string;
  what_went_well: string[];
  what_was_missing: string[];
  better_answer?: string | null;
  follow_up_topic?: string | null;
}

export interface InterviewEvaluationOut {
  interview_id: string;
  overall_score: number;
  technical_score: number;
  communication_score: number;
  problem_solving_score: number;
  confidence_score: number;
  resume_knowledge_score: number;
  question_feedback: QuestionFeedback[];
  created_at?: string;
}

// WebSocket protocol — /api/interviews/{id}/ws
export type WsClientMessage = { type: "answer"; text: string };

export type WsServerMessage =
  | { type: "question"; question: InterviewQuestion; index: number; total: number }
  | { type: "evaluating" }
  | { type: "evaluation"; evaluation: Partial<InterviewEvaluationOut> }
  | { type: "complete"; evaluation: InterviewEvaluationOut }
  | { type: "error"; detail: string };

// ---------- RAG ----------

export interface RagCitation {
  document_id: string;
  title: string;
  chunk_index: number;
  snippet: string;
}

export interface RagAskRequest {
  question: string;
  resume_id?: string;
  job_id?: string;
}

export interface RagAskResponse {
  answer: string;
  citations: RagCitation[];
}

// ---------- Analytics / dashboard ----------

export interface RecentAnalysis {
  id: string;
  resume_id: string;
  filename?: string;
  score: number;
  created_at: string;
}

export interface RecentInterview {
  id: string;
  mode: InterviewMode;
  overall_score?: number | null;
  status: InterviewStatus;
  created_at: string;
}

export interface DashboardData {
  resume_score: number;
  ats_score: number;
  job_match_score: number;
  interview_readiness: number;
  skills_detected: string[];
  missing_skills: string[];
  recent_analyses: RecentAnalysis[];
  recent_interviews: RecentInterview[];
  recommended_improvements: string[];
}
