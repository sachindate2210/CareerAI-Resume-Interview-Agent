// Types for the resume optimizer + admin panel. Snake_case mirrors the FastAPI responses.

export type ResumeStatus = "pending" | "parsed" | "failed";

export interface ExperienceItem {
  company?: string | null;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  bullets?: string[];
}

export interface EducationItem {
  institution?: string | null;
  degree?: string | null;
  field?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface ProjectItem {
  name?: string | null;
  description?: string | null;
  technologies?: string[];
  bullets?: string[];
}

export interface ParsedResume {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  summary?: string | null;
  skills?: string[];
  experience?: ExperienceItem[];
  education?: EducationItem[];
  projects?: ProjectItem[];
  certifications?: string[];
  achievements?: string[];
  links?: string[];
}

export interface ScoreBreakdown {
  content: number;
  impact: number;
  ats: number;
  formatting: number;
  skills: number;
}

export interface JobMatch {
  score: number;
  matched: string[];
  missing: string[];
}

export interface BulletRewrite {
  original: string;
  improved: string;
  reason?: string | null;
}

export interface ResumeAnalysis {
  score: number;
  score_breakdown?: ScoreBreakdown | null;
  job_match?: JobMatch | null;
  bullet_rewrites?: BulletRewrite[] | null;
  strengths: string[];
  weaknesses: string[];
  suggestions?: string[];
  missing_keywords?: string[];
  content_feedback: { clarity?: string | null; impact?: string | null; relevance?: string | null };
  quality_feedback: { grammar?: string | null; formatting?: string | null; conciseness?: string | null };
  ats_feedback: {
    keyword_coverage?: string | null;
    formatting_compatibility?: string | null;
    parseable_sections?: boolean | null;
  };
}

export interface ResumeVersion {
  id: string;
  version_number: number;
  parsed_content: ParsedResume;
  created_at: string;
}

export interface Resume {
  id: string;
  owner_id: string;
  title: string;
  filename: string;
  file_type: string;
  status: ResumeStatus;
  created_at: string;
  analysis?: ResumeAnalysis | null;
  analyzed_at?: string | null;
  latest_version?: ResumeVersion | null;
}

export interface UploadResponse {
  resume: Resume;
  version: ResumeVersion | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ---------- Admin ----------

export interface OwnerInfo {
  id: string;
  email: string;
  full_name?: string | null;
}

export interface AdminResumeRow {
  id: string;
  title: string;
  filename: string;
  file_type: string;
  status: ResumeStatus;
  score: number | null;
  analyzed_at: string | null;
  created_at: string;
  owner: OwnerInfo;
}

export interface AdminResumeDetail extends Resume {
  owner: OwnerInfo;
}

export interface AdminStats {
  total_resumes: number;
  total_users: number;
  parsed: number;
  failed: number;
  analyzed: number;
  average_score: number | null;
  last_7_days: number;
  uploads_per_day: { date: string; count: number }[];
  score_distribution: { label: string; count: number }[];
  recent: AdminResumeRow[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
  resume_count: number;
}

// ---------- Public (guest) tools ----------

export type PublicRequestStatus = "pending" | "processing" | "completed" | "failed";

export interface ResumeOptimizerInput {
  source: "file" | "text";
  filename?: string | null;
  file_type?: string | null;
  job_title?: string | null;
  job_description?: string | null;
}

export interface PublicResumeResult {
  id: string;
  access_token: string;
  status: PublicRequestStatus;
  created_at: string;
  completed_at?: string | null;
  input: ResumeOptimizerInput;
  parsed?: ParsedResume | null;
  analysis?: ResumeAnalysis | null;
  error_message?: string | null;
  deduplicated: boolean;
}

export interface PublicRequestRow {
  id: string;
  tool: string;
  status: PublicRequestStatus;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  score: number | null;
  source: "file" | "text" | null;
  filename: string | null;
  job_title: string | null;
  candidate_name: string | null;
  candidate_email: string | null;
  visitor_key: string | null;
  visitor_request_count: number;
  error_message: string | null;
}

export interface PublicRequestDetail extends PublicRequestRow {
  input: ResumeOptimizerInput;
  input_text: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  visitor_id: string | null;
  has_file: boolean;
  parsed: ParsedResume | null;
  analysis: ResumeAnalysis | null;
  visitor_history: { id: string; status: PublicRequestStatus; created_at: string; score: number | null; filename: string | null }[];
}

export interface UsageBucket {
  period: string;
  total: number;
  completed: number;
  failed: number;
}

export interface PublicAnalytics {
  total: number;
  completed: number;
  failed: number;
  in_progress: number;
  success_rate: number | null;
  average_score: number | null;
  average_duration_ms: number | null;
  unique_visitors: number;
  repeat_visitors: number;
  today: number;
  last_7_days: number;
  last_30_days: number;
  daily: UsageBucket[];
  weekly: UsageBucket[];
  monthly: UsageBucket[];
}

// ---------- Users, roles & permissions ----------

export interface AdminUser {
  id: string;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  is_admin: boolean;
  role: { id: string; name: string } | null;
  created_at: string;
  resume_count: number;
}

export interface AdminRole {
  id: string;
  name: string;
  description: string | null;
  permissions: Record<string, string[]>;
  user_count: number;
  created_at: string;
  is_active: boolean;
}

export interface PermissionCatalog {
  actions: string[];
  modules: { key: string; label: string; actions: string[] }[];
}
