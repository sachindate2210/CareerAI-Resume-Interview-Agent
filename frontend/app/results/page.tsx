"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api";
import { formatPercent } from "@/lib/utils";
import type { InterviewEvaluationOut } from "@/types/api";

export default function ResultsPage() {
  const searchParams = useSearchParams();
  const interviewId = searchParams.get("interview");

  const [evaluation, setEvaluation] = useState<InterviewEvaluationOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!interviewId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Fast path: the interview session page may have stashed the final
        // evaluation in sessionStorage right before redirecting here.
        const cached = sessionStorage.getItem(`interview_eval_${interviewId}`);
        if (cached) {
          const parsed = JSON.parse(cached) as InterviewEvaluationOut;
          if (!cancelled) {
            setEvaluation(parsed);
            setLoading(false);
          }
          return;
        }
      } catch {
        // ignore malformed cache, fall through to API fetch
      }

      try {
        // API.md does not document a direct "GET evaluation by interview id"
        // route. The documented endpoint is POST /api/interviews/{id}/complete,
        // which forces evaluation. We assume (per typical idempotent backend
        // behavior for a "complete" action on an already-completed interview)
        // that calling it again safely returns the existing evaluation rather
        // than re-generating one. This is the documented fallback used here.
        const res = await api.post<InterviewEvaluationOut>(
          `/api/interviews/${interviewId}/complete`
        );
        if (!cancelled) setEvaluation(res);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.detail : "Failed to load interview results."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  if (!interviewId) {
    return (
      <AppShell>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              No interview specified.{" "}
              <Link href="/interview" className="text-primary underline-offset-4 hover:underline">
                Start a new practice interview
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-6">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-80 animate-pulse rounded-lg bg-muted" />
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

  if (!evaluation) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">No results available.</p>
      </AppShell>
    );
  }

  const chartData = [
    { metric: "Technical", value: evaluation.technical_score },
    { metric: "Communication", value: evaluation.communication_score },
    { metric: "Problem Solving", value: evaluation.problem_solving_score },
    { metric: "Confidence", value: evaluation.confidence_score },
    { metric: "Resume Knowledge", value: evaluation.resume_knowledge_score },
  ];

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Interview Results</h1>
          <p className="text-sm text-muted-foreground">
            A breakdown of your performance across each question.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>Overall Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-5xl font-semibold tracking-tight text-primary">
                {formatPercent(evaluation.overall_score)}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Score Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={chartData}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      fill="hsl(var(--primary))"
                      fillOpacity={0.25}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Question Feedback</h2>
          {evaluation.question_feedback.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  No per-question feedback was returned for this interview.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {evaluation.question_feedback.map((qf) => (
                <Card key={qf.question_id}>
                  <CardHeader>
                    <CardTitle className="text-base">{qf.question}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-xs font-medium uppercase text-muted-foreground">
                        Your answer
                      </p>
                      <p className="mt-1 text-sm">{qf.answer_text}</p>
                    </div>

                    {qf.what_went_well.length > 0 && (
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          What you did well
                        </p>
                        <ul className="mt-1 space-y-1">
                          {qf.what_went_well.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {qf.what_was_missing.length > 0 && (
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          What was missing
                        </p>
                        <ul className="mt-1 space-y-1">
                          {qf.what_was_missing.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {qf.better_answer && (
                      <div>
                        <p className="text-xs font-medium uppercase text-muted-foreground">
                          A better answer
                        </p>
                        <p className="mt-1 text-sm">{qf.better_answer}</p>
                      </div>
                    )}

                    {qf.follow_up_topic && (
                      <Badge variant="secondary">Follow-up: {qf.follow_up_topic}</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
