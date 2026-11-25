"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, AlertTriangle, Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { ResumeAnalysis, ResumeRead } from "@/types/api";

function ScoreGauge({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      <svg viewBox="0 0 120 120" className="h-40 w-40 -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
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

function ChipList({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">None listed.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item} variant="secondary">
          {item}
        </Badge>
      ))}
    </div>
  );
}

export default function ResumeDetailPage() {
  const params = useParams<{ id: string }>();
  const resumeId = params?.id as string;

  const [resume, setResume] = useState<ResumeRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  useEffect(() => {
    if (!resumeId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<ResumeRead>(`/api/resumes/${resumeId}`);
        if (!cancelled) setResume(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.detail : "Failed to load resume.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await api.post<ResumeAnalysis>(`/api/resumes/${resumeId}/analyze`);
      setAnalysis(res);
    } catch (err) {
      setAnalyzeError(err instanceof ApiError ? err.detail : "Analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }, [resumeId]);

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-6">
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (!resume) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Resume not found.</p>
      </AppShell>
    );
  }

  const content = resume.latest_version?.parsed_content;

  return (
    <AppShell>
      <div className="space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{resume.filename}</h1>
            <p className="text-sm text-muted-foreground">
              Uploaded {formatDate(resume.created_at)} · Status:{" "}
              <span className="capitalize">{resume.status}</span>
            </p>
          </div>
        </div>

        {!content ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                This resume has not finished parsing yet. Check back shortly.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {content.summary || "No summary available."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Skills</CardTitle>
              </CardHeader>
              <CardContent>
                <ChipList items={content.skills} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Experience</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!content.experience || content.experience.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No experience listed.</p>
                ) : (
                  content.experience.map((exp, idx) => (
                    <div key={idx} className="border-b border-border pb-3 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium">
                          {exp.title || "Untitled role"}
                          {exp.company ? ` · ${exp.company}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {exp.start_date || "—"} – {exp.end_date || "Present"}
                        </p>
                      </div>
                      {exp.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{exp.description}</p>
                      )}
                      {exp.bullets && exp.bullets.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                          {exp.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Education</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!content.education || content.education.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No education listed.</p>
                ) : (
                  content.education.map((edu, idx) => (
                    <div key={idx} className="border-b border-border pb-3 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium">
                          {edu.degree || "Degree"}
                          {edu.field_of_study ? `, ${edu.field_of_study}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {edu.start_date || "—"} – {edu.end_date || "Present"}
                        </p>
                      </div>
                      {edu.institution && (
                        <p className="text-sm text-muted-foreground">{edu.institution}</p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Projects</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!content.projects || content.projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects listed.</p>
                ) : (
                  content.projects.map((proj, idx) => (
                    <div key={idx} className="border-b border-border pb-3 last:border-0 last:pb-0">
                      <p className="font-medium">{proj.name || "Untitled project"}</p>
                      {proj.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{proj.description}</p>
                      )}
                      {proj.technologies && proj.technologies.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {proj.technologies.map((t) => (
                            <Badge key={t} variant="outline">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Certifications</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!content.certifications || content.certifications.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No certifications listed.</p>
                ) : (
                  content.certifications.map((cert, idx) => (
                    <div key={idx} className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">
                        {cert.name || "Certification"}
                        {cert.issuer ? ` · ${cert.issuer}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{cert.date || "—"}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Resume Analysis</CardTitle>
            <CardDescription>
              Run an AI analysis to see a score, strengths, weaknesses, and ATS feedback.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!analysis ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No analysis yet for this resume.
                </p>
                <Button onClick={handleAnalyze} disabled={analyzing}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {analyzing ? "Analyzing…" : "Analyze Resume"}
                </Button>
                {analyzeError && (
                  <p className="text-sm text-destructive">{analyzeError}</p>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-start sm:gap-8">
                  <ScoreGauge score={analysis.score} />
                  <div className="flex-1 space-y-4">
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <Check className="h-4 w-4 text-success" /> Strengths
                      </h3>
                      {analysis.strengths.length === 0 ? (
                        <p className="text-sm text-muted-foreground">None listed.</p>
                      ) : (
                        <ul className="space-y-1 text-sm">
                          {analysis.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                        <AlertTriangle className="h-4 w-4 text-warning" /> Weaknesses
                      </h3>
                      {analysis.weaknesses.length === 0 ? (
                        <p className="text-sm text-muted-foreground">None listed.</p>
                      ) : (
                        <ul className="space-y-1 text-sm">
                          {analysis.weaknesses.map((w, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                              <span>{w}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                {analysis.ats_feedback && Object.keys(analysis.ats_feedback).length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">ATS Feedback</h3>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {Object.entries(analysis.ats_feedback).map(([key, value]) => (
                        <li key={key}>
                          <span className="font-medium capitalize">{key.replace(/_/g, " ")}:</span>{" "}
                          {String(value)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button variant="outline" onClick={handleAnalyze} disabled={analyzing}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {analyzing ? "Re-analyzing…" : "Re-run Analysis"}
                </Button>
                {analyzeError && (
                  <p className="text-sm text-destructive">{analyzeError}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
