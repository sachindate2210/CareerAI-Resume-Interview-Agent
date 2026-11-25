"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import type {
  CreateInterviewRequest,
  InterviewMode,
  InterviewRead,
  JobRead,
  Paginated,
  ResumeRead,
} from "@/types/api";

const MODE_OPTIONS: { value: InterviewMode; label: string }[] = [
  { value: "technical", label: "Technical" },
  { value: "behavioral", label: "Behavioral" },
  { value: "resume_based", label: "Resume-based" },
  { value: "mixed", label: "Mixed" },
];

const NONE_VALUE = "__none__";

export default function InterviewStartPage() {
  const router = useRouter();

  const [resumes, setResumes] = useState<ResumeRead[] | null>(null);
  const [jobs, setJobs] = useState<JobRead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [resumeVersionId, setResumeVersionId] = useState<string>(NONE_VALUE);
  const [jobId, setJobId] = useState<string>(NONE_VALUE);
  const [mode, setMode] = useState<InterviewMode>("mixed");
  const [numQuestions, setNumQuestions] = useState<number>(5);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [resumeRes, jobRes] = await Promise.all([
        api.get<Paginated<ResumeRead>>("/api/resumes"),
        api.get<Paginated<JobRead>>("/api/jobs"),
      ]);
      setResumes(resumeRes.items);
      setJobs(jobRes.items);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.detail : "Failed to load resumes and jobs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const resumesWithVersion = (resumes ?? []).filter((r) => r.latest_version?.id);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: CreateInterviewRequest = {
        mode,
        num_questions: numQuestions,
      };
      if (resumeVersionId !== NONE_VALUE) body.resume_version_id = resumeVersionId;
      if (jobId !== NONE_VALUE) body.job_id = jobId;

      const result = await api.post<InterviewRead>("/api/interviews", body);
      router.push(`/interview/${result.id}`);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.detail : "Failed to start interview.");
    } finally {
      setSubmitting(false);
    }
  }, [mode, numQuestions, resumeVersionId, jobId, router]);

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Practice Interview</h1>
          <p className="text-sm text-muted-foreground">
            Configure your mock interview and start practicing.
          </p>
        </div>

        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Interview Setup</CardTitle>
            <CardDescription>
              Optionally tie the interview to a resume version and/or job description for
              more relevant questions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : loadError ? (
              <p className="text-sm text-destructive">{loadError}</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Resume version (optional)</Label>
                  <Select value={resumeVersionId} onValueChange={setResumeVersionId}>
                    <SelectTrigger>
                      <SelectValue placeholder="No resume selected" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>None</SelectItem>
                      {resumesWithVersion.map((resume) => (
                        <SelectItem key={resume.id} value={resume.latest_version!.id}>
                          {resume.filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Job (optional)</Label>
                  <Select value={jobId} onValueChange={setJobId}>
                    <SelectTrigger>
                      <SelectValue placeholder="No job selected" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>None</SelectItem>
                      {(jobs ?? []).map((job) => (
                        <SelectItem key={job.id} value={job.id}>
                          {job.title ?? job.company ?? job.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select value={mode} onValueChange={(v) => setMode(v as InterviewMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MODE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="num_questions">Number of questions</Label>
                  <Input
                    id="num_questions"
                    type="number"
                    min={1}
                    max={20}
                    value={numQuestions}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setNumQuestions(Number.isNaN(v) ? 1 : Math.min(20, Math.max(1, v)));
                    }}
                  />
                </div>

                {submitError && <p className="text-sm text-destructive">{submitError}</p>}

                <Button onClick={handleSubmit} disabled={submitting} className="w-full">
                  {submitting ? "Starting…" : "Start Interview"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
