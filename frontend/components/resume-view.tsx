"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, Lightbulb, Loader2, Sparkles, Target, Wand2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import type { BulletRewrite, JobMatch, ParsedResume, Resume, ResumeAnalysis, ScoreBreakdown } from "@/types/optimizer";

export function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-primary";
  if (score >= 40) return "text-warning";
  return "text-destructive";
}

export function StatusBadge({ status }: { status: Resume["status"] }) {
  const variant = status === "parsed" ? "success" : status === "failed" ? "destructive" : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="currentColor"
          className={scoreTone(clamped)}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-semibold tracking-tight">{Math.round(clamped)}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function ChipList({ items, variant = "secondary" }: { items?: string[]; variant?: "secondary" | "outline" }) {
  if (!items || items.length === 0) return <p className="text-sm text-muted-foreground">None listed.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item} variant={variant}>
          {item}
        </Badge>
      ))}
    </div>
  );
}

function BulletList({ items, icon, tone }: { items?: string[]; icon: React.ReactNode; tone: string }) {
  if (!items || items.length === 0) return <p className="text-sm text-muted-foreground">Nothing here.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className={cn("mt-0.5 shrink-0", tone)}>{icon}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FeedbackRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <p className="text-sm">{value || "Not enough information available."}</p>
    </div>
  );
}

const BREAKDOWN: { key: keyof ScoreBreakdown; label: string; hint: string }[] = [
  { key: "content", label: "Content", hint: "Substance & relevance" },
  { key: "impact", label: "Impact", hint: "Quantified results" },
  { key: "ats", label: "ATS", hint: "Keywords & parsing" },
  { key: "formatting", label: "Formatting", hint: "Structure & readability" },
  { key: "skills", label: "Skills", hint: "Breadth & relevance" },
];

function barTone(v: number) {
  return v >= 80 ? "bg-emerald-500" : v >= 60 ? "bg-blue-500" : v >= 40 ? "bg-amber-500" : "bg-rose-500";
}

function ScoreBreakdownBars({ breakdown }: { breakdown: ScoreBreakdown }) {
  const weakest = BREAKDOWN.reduce((a, b) => (breakdown[b.key] < breakdown[a.key] ? b : a));
  return (
    <div className="w-full space-y-3">
      {BREAKDOWN.map(({ key, label, hint }) => {
        const v = breakdown[key];
        return (
          <div key={key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {label} <span className="text-xs font-normal text-muted-foreground">· {hint}</span>
              </span>
              <span className={cn("font-semibold tabular-nums", scoreTone(v))}>{v}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className={cn("h-full rounded-full transition-all duration-700", barTone(v))} style={{ width: `${v}%` }} />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-muted-foreground">
        Biggest opportunity: <span className="font-medium text-foreground">{weakest.label}</span>
      </p>
    </div>
  );
}

function JobMatchCard({ match, jobTitle }: { match: JobMatch; jobTitle?: string | null }) {
  const radius = 34;
  const c = 2 * Math.PI * radius;
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" /> Job match{jobTitle ? ` · ${jobTitle}` : ""}
        </CardTitle>
        <CardDescription>How many of the job&apos;s key requirements your resume mentions.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-[auto_1fr]">
        <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
          <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
            <circle cx="40" cy="40" r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth="8" />
            <circle
              cx="40"
              cy="40"
              r={radius}
              fill="none"
              stroke="currentColor"
              className={scoreTone(match.score)}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - match.score / 100)}
            />
          </svg>
          <div className="absolute text-center">
            <div className="text-xl font-bold tabular-nums">{match.score}%</div>
            <div className="text-[10px] text-muted-foreground">match</div>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Found in your resume ({match.matched.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {match.matched.length === 0 && <span className="text-sm text-muted-foreground">None yet.</span>}
              {match.matched.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <Check className="h-3 w-3" /> {k}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Missing ({match.missing.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {match.missing.length === 0 && <span className="text-sm text-muted-foreground">Nothing missing. Great fit!</span>}
              {match.missing.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
                  <X className="h-3 w-3" /> {k}
                </span>
              ))}
            </div>
            {match.missing.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Add the missing ones only if you genuinely have that experience.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** AI rewrites of weak bullets; generated on demand, then cached on the report. */
function BulletRewritesCard({
  initial,
  onGenerate,
}: {
  initial?: BulletRewrite[] | null;
  onGenerate: () => Promise<BulletRewrite[]>;
}) {
  const [items, setItems] = useState<BulletRewrite[] | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setItems(await onGenerate());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't generate rewrites. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4 text-violet-500" /> AI bullet rewrites
            </CardTitle>
            <CardDescription>Your weakest bullet points, rewritten to be stronger. Facts stay the same.</CardDescription>
          </div>
          {items === null && (
            <Button onClick={run} disabled={loading} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {loading ? "Rewriting…" : "Improve my bullets"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
        {items === null && !loading && !error && (
          <p className="text-sm text-muted-foreground">
            We&apos;ll pick up to 5 bullets that need the most work. Where a number would help, you&apos;ll see a placeholder like
            <span className="mx-1 rounded bg-amber-500/15 px-1 font-mono text-xs text-amber-700 dark:text-amber-300">[X%]</span>
            to fill in yourself; we never make numbers up.
          </p>
        )}
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        )}
        {items?.length === 0 && <p className="text-sm text-muted-foreground">Your bullets already look strong. Nothing to rewrite.</p>}
        {items?.map((r, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border">
            <div className="flex gap-3 bg-rose-500/5 px-4 py-2.5 text-sm">
              <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-300">Before</span>
              <span className="text-muted-foreground line-through decoration-rose-400/50">{r.original}</span>
            </div>
            <div className="flex items-start gap-3 bg-emerald-500/5 px-4 py-2.5 text-sm">
              <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">After</span>
              <span className="flex-1 font-medium">
                {r.improved.split(/(\[[^\]]+\])/g).map((part, j) =>
                  /^\[[^\]]+\]$/.test(part) ? (
                    <span key={j} className="rounded bg-amber-500/15 px-1 font-mono text-xs text-amber-700 dark:text-amber-300">
                      {part}
                    </span>
                  ) : (
                    <span key={j}>{part}</span>
                  )
                )}
              </span>
              <CopyButton text={r.improved} />
            </div>
            {r.reason && <div className="border-t border-border px-4 py-1.5 text-xs text-muted-foreground">{r.reason}</div>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AnalysisPanel({
  analysis,
  jobTitle,
  onRewrite,
}: {
  analysis: ResumeAnalysis;
  jobTitle?: string | null;
  /** When provided, shows the AI bullet rewrites card. */
  onRewrite?: () => Promise<BulletRewrite[]>;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className={cn("flex flex-col items-center gap-6 pt-6", analysis.score_breakdown ? "lg:flex-row lg:items-center" : "sm:flex-row")}>
          <div className={cn("flex flex-col items-center gap-4 sm:flex-row", analysis.score_breakdown && "lg:w-[460px] lg:shrink-0")}>
            <ScoreGauge score={analysis.score} />
            <div className="space-y-2 text-center sm:text-left">
              <h3 className="text-lg font-semibold">Resume score</h3>
              <p className="text-sm text-muted-foreground">Content, clarity, impact and ATS-friendliness.</p>
              <div className="flex flex-wrap justify-center gap-2 pt-1 sm:flex-nowrap sm:justify-start [&>*]:whitespace-nowrap">
                <Badge variant="destructive">{analysis.weaknesses.length} issues</Badge>
                <Badge variant="default">{analysis.suggestions?.length ?? 0} suggestions</Badge>
                <Badge variant="success">{analysis.strengths.length} strengths</Badge>
              </div>
            </div>
          </div>
          {analysis.score_breakdown && (
            <div className="w-full border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <ScoreBreakdownBars breakdown={analysis.score_breakdown} />
            </div>
          )}
        </CardContent>
      </Card>

      {analysis.job_match && <JobMatchCard match={analysis.job_match} jobTitle={jobTitle} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issues found</CardTitle>
            <CardDescription>What is hurting this resume right now.</CardDescription>
          </CardHeader>
          <CardContent>
            <BulletList items={analysis.weaknesses} icon={<AlertTriangle className="h-4 w-4" />} tone="text-destructive" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What to add / fix</CardTitle>
            <CardDescription>Concrete next steps to improve it.</CardDescription>
          </CardHeader>
          <CardContent>
            <BulletList items={analysis.suggestions} icon={<Lightbulb className="h-4 w-4" />} tone="text-primary" />
          </CardContent>
        </Card>
        {onRewrite && (
          <div className="lg:col-span-2">
            <BulletRewritesCard initial={analysis.bullet_rewrites} onGenerate={onRewrite} />
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Strengths</CardTitle>
          </CardHeader>
          <CardContent>
            <BulletList items={analysis.strengths} icon={<Check className="h-4 w-4" />} tone="text-success" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Missing ATS keywords
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChipList items={analysis.missing_keywords} variant="outline" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FeedbackRow label="Clarity" value={analysis.content_feedback?.clarity} />
            <FeedbackRow label="Impact" value={analysis.content_feedback?.impact} />
            <FeedbackRow label="Relevance" value={analysis.content_feedback?.relevance} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FeedbackRow label="Grammar" value={analysis.quality_feedback?.grammar} />
            <FeedbackRow label="Formatting" value={analysis.quality_feedback?.formatting} />
            <FeedbackRow label="Conciseness" value={analysis.quality_feedback?.conciseness} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ATS</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FeedbackRow label="Keyword coverage" value={analysis.ats_feedback?.keyword_coverage} />
            <FeedbackRow label="Formatting compatibility" value={analysis.ats_feedback?.formatting_compatibility} />
            <FeedbackRow
              label="Parseable sections"
              value={
                analysis.ats_feedback?.parseable_sections == null
                  ? null
                  : analysis.ats_feedback.parseable_sections
                  ? "Yes — standard sections were detected."
                  : "No — some sections may not be read correctly by ATS."
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ParsedResumePanel({ parsed }: { parsed: ParsedResume }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Extracted resume content</CardTitle>
        <CardDescription>What we read from the uploaded file.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <FeedbackRow label="Name" value={parsed.name} />
          <FeedbackRow label="Email" value={parsed.email} />
          <FeedbackRow label="Phone" value={parsed.phone} />
        </div>
        {parsed.summary && <FeedbackRow label="Summary" value={parsed.summary} />}
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Skills</div>
          <ChipList items={parsed.skills} />
        </div>

        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Experience</div>
          {(parsed.experience ?? []).length === 0 && <p className="text-sm text-muted-foreground">None listed.</p>}
          {(parsed.experience ?? []).map((exp, i) => (
            <div key={i} className="rounded-md border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium">
                  {exp.title || "Untitled role"}
                  {exp.company && <span className="text-muted-foreground"> · {exp.company}</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {[exp.start_date, exp.end_date].filter(Boolean).join(" – ")}
                </div>
              </div>
              {exp.bullets && exp.bullets.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {exp.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {(parsed.projects ?? []).length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Projects</div>
            {parsed.projects!.map((p, i) => (
              <div key={i} className="rounded-md border border-border p-4">
                <div className="font-medium">{p.name || "Untitled project"}</div>
                {p.description && <p className="mt-1 text-sm">{p.description}</p>}
                {p.technologies && p.technologies.length > 0 && (
                  <div className="mt-2">
                    <ChipList items={p.technologies} variant="outline" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Education</div>
          {(parsed.education ?? []).length === 0 && <p className="text-sm text-muted-foreground">None listed.</p>}
          {(parsed.education ?? []).map((ed, i) => (
            <div key={i} className="text-sm">
              <span className="font-medium">{[ed.degree, ed.field].filter(Boolean).join(", ") || "Degree"}</span>
              {ed.institution && <span className="text-muted-foreground"> · {ed.institution}</span>}
            </div>
          ))}
        </div>

        {(parsed.certifications ?? []).length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Certifications</div>
            <ChipList items={parsed.certifications} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The full resume view. Used by the user's optimizer page and the admin resume page so both
 * see exactly the same thing. `onAnalyze` is omitted for admins (read-only).
 */
export function ResumeView({
  resume,
  onAnalyze,
  analyzing,
  analyzeError,
  headerExtra,
  onRewrite,
  actions,
}: {
  resume: Resume;
  onAnalyze?: () => void;
  analyzing?: boolean;
  analyzeError?: string | null;
  headerExtra?: React.ReactNode;
  onRewrite?: () => Promise<BulletRewrite[]>;
  /** Extra header buttons (e.g. Download PDF). */
  actions?: React.ReactNode;
}) {
  const parsed = resume.latest_version?.parsed_content;
  const analysis = resume.analysis;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{resume.filename}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={resume.status} />
            <span>Uploaded {formatDate(resume.created_at)}</span>
            {resume.analyzed_at && <span>· Analyzed {formatDate(resume.analyzed_at)}</span>}
          </div>
          {headerExtra}
        </div>
        <div className="flex flex-wrap gap-2">
        {analysis && actions}
        {onAnalyze && resume.status === "parsed" && (
          <Button onClick={onAnalyze} disabled={analyzing}>
            <Sparkles className="mr-2 h-4 w-4" />
            {analyzing ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze resume"}
          </Button>
        )}
        </div>
      </div>

      {analyzeError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {analyzeError}
        </div>
      )}

      {resume.status === "failed" && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            We couldn&apos;t read this file. Try uploading a text-based PDF or DOCX (not a scanned image).
          </CardContent>
        </Card>
      )}

      {analysis ? (
        <AnalysisPanel analysis={analysis} onRewrite={onRewrite} />
      ) : (
        resume.status === "parsed" && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              {onAnalyze
                ? analyzing
                  ? "Reviewing your resume — this usually takes 10–30 seconds…"
                  : "Click “Analyze resume” to see issues, what to add, and your score."
                : "This resume hasn't been analyzed yet."}
            </CardContent>
          </Card>
        )
      )}

      {parsed && <ParsedResumePanel parsed={parsed} />}
    </div>
  );
}
