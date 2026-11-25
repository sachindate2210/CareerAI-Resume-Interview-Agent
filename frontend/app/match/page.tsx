"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import type {
  JobRead,
  MatchResult,
  Paginated,
  ResumeRead,
  SkillGapResult,
  SkillPriority,
} from "@/types/api";

function ChipList({ items, variant }: { items: string[]; variant: "secondary" | "outline" }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">None.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, idx) => (
        <Badge key={`${item}-${idx}`} variant={variant}>
          {item}
        </Badge>
      ))}
    </div>
  );
}

const PRIORITY_LABEL: Record<SkillPriority, string> = {
  critical: "Critical",
  important: "Important",
  nice_to_have: "Nice to have",
};

const PRIORITY_BADGE_VARIANT: Record<SkillPriority, "destructive" | "warning" | "secondary"> = {
  critical: "destructive",
  important: "warning",
  nice_to_have: "secondary",
};

export default function MatchPage() {
  const [resumes, setResumes] = useState<ResumeRead[] | null>(null);
  const [jobs, setJobs] = useState<JobRead[] | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const [resumeVersionId, setResumeVersionId] = useState<string>("");
  const [jobId, setJobId] = useState<string>("");

  const [activeTab, setActiveTab] = useState("match");

  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchResult | null>(null);

  const [skillGapLoading, setSkillGapLoading] = useState(false);
  const [skillGapError, setSkillGapError] = useState<string | null>(null);
  const [skillGap, setSkillGap] = useState<SkillGapResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setOptionsLoading(true);
      setOptionsError(null);
      try {
        const [resumesRes, jobsRes] = await Promise.all([
          api.get<Paginated<ResumeRead>>("/api/resumes"),
          api.get<Paginated<JobRead>>("/api/jobs"),
        ]);
        if (cancelled) return;
        setResumes(resumesRes.items);
        setJobs(jobsRes.items);
      } catch (err) {
        if (!cancelled) {
          setOptionsError(err instanceof ApiError ? err.detail : "Failed to load resumes/jobs.");
        }
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const resumeOptions = (resumes ?? []).filter((r) => r.latest_version);

  async function runMatch() {
    if (!resumeVersionId || !jobId) return;
    setMatching(true);
    setMatchError(null);
    try {
      const res = await api.post<MatchResult>("/api/match", {
        resume_version_id: resumeVersionId,
        job_id: jobId,
      });
      setMatch(res);
      setSkillGap(null);
      setSkillGapError(null);
    } catch (err) {
      setMatchError(err instanceof ApiError ? err.detail : "Failed to run match.");
    } finally {
      setMatching(false);
    }
  }

  async function loadSkillGap() {
    if (!match) return;
    setSkillGapLoading(true);
    setSkillGapError(null);
    try {
      const res = await api.get<SkillGapResult>(`/api/match/${match.id}/skill-gap`);
      setSkillGap(res);
    } catch (err) {
      setSkillGapError(err instanceof ApiError ? err.detail : "Failed to load skill gap.");
    } finally {
      setSkillGapLoading(false);
    }
  }

  const grouped: Record<SkillPriority, { skill: string }[]> = {
    critical: [],
    important: [],
    nice_to_have: [],
  };
  skillGap?.missing_skills.forEach((item) => {
    grouped[item.priority].push({ skill: item.skill });
  });

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Match & Skill Gap</h1>
          <p className="text-sm text-muted-foreground">
            Score a resume against a job description and see the roadmap to close the gap.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Select resume and job</CardTitle>
          </CardHeader>
          <CardContent>
            {optionsLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="h-10 animate-pulse rounded bg-muted" />
                <div className="h-10 animate-pulse rounded bg-muted" />
              </div>
            ) : optionsError ? (
              <p className="text-sm text-destructive">{optionsError}</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Resume version</label>
                  <Select value={resumeVersionId} onValueChange={setResumeVersionId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a resume" />
                    </SelectTrigger>
                    <SelectContent>
                      {resumeOptions.length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No parsed resumes available.
                        </div>
                      )}
                      {resumeOptions.map((r) => (
                        <SelectItem key={r.latest_version!.id} value={r.latest_version!.id}>
                          {r.filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Job</label>
                  <Select value={jobId} onValueChange={setJobId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a job" />
                    </SelectTrigger>
                    <SelectContent>
                      {(jobs ?? []).length === 0 && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No jobs analyzed yet.
                        </div>
                      )}
                      {(jobs ?? []).map((j) => (
                        <SelectItem key={j.id} value={j.id}>
                          {j.analysis?.job_title ||
                            j.title ||
                            `${j.raw_description.slice(0, 60)}${j.raw_description.length > 60 ? "…" : ""}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="match">Match</TabsTrigger>
            <TabsTrigger value="skill-gap">Skill Gap</TabsTrigger>
          </TabsList>

          <TabsContent value="match">
            <Card>
              <CardHeader>
                <CardTitle>Run match</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {matchError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {matchError}
                  </div>
                )}

                <Button
                  onClick={runMatch}
                  disabled={matching || !resumeVersionId || !jobId}
                >
                  {matching ? "Matching..." : "Run Match"}
                </Button>

                {match && (
                  <div className="space-y-6">
                    <div>
                      <p className="text-sm text-muted-foreground">Overall score</p>
                      <p className="text-4xl font-semibold tracking-tight text-primary">
                        {Math.round(match.overall_score)}
                        <span className="text-lg text-muted-foreground">/100</span>
                      </p>
                    </div>

                    <div className="h-72 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={match.subscores} layout="vertical" margin={{ left: 24 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={140}
                            tick={{ fontSize: 12 }}
                          />
                          <Bar dataKey="score" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="space-y-3">
                      {match.subscores.map((s) => (
                        <div key={s.name}>
                          <p className="text-sm font-medium">
                            {s.name} — {Math.round(s.score)}
                          </p>
                          <p className="text-sm text-muted-foreground">{s.reasoning}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-sm font-medium">Matched skills</h3>
                        <ChipList items={match.matched_skills} variant="secondary" />
                      </div>
                      <div>
                        <h3 className="mb-2 text-sm font-medium">Missing skills</h3>
                        <ChipList items={match.missing_skills} variant="outline" />
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="skill-gap">
            <Card>
              <CardHeader>
                <CardTitle>Skill gap &amp; learning plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {!match ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Run a match first to see the skill gap and learning plan.
                    </p>
                    <Button variant="outline" onClick={() => setActiveTab("match")}>
                      Go to Match
                    </Button>
                  </div>
                ) : (
                  <>
                    {skillGapError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {skillGapError}
                      </div>
                    )}

                    <Button onClick={loadSkillGap} disabled={skillGapLoading}>
                      {skillGapLoading
                        ? "Loading..."
                        : skillGap
                        ? "Reload Skill Gap"
                        : "Load Skill Gap"}
                    </Button>

                    {skillGap && (
                      <div className="space-y-6">
                        <div>
                          <h3 className="mb-2 text-sm font-medium">Skills you have</h3>
                          <ChipList items={skillGap.have_skills} variant="secondary" />
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          {(["critical", "important", "nice_to_have"] as SkillPriority[]).map(
                            (priority) => (
                              <div key={priority}>
                                <h3 className="mb-2 text-sm font-medium">
                                  {PRIORITY_LABEL[priority]}
                                </h3>
                                <ChipList
                                  items={grouped[priority].map((s) => s.skill)}
                                  variant="outline"
                                />
                              </div>
                            )
                          )}
                        </div>

                        <div>
                          <h3 className="mb-3 text-sm font-medium">Learning plan</h3>
                          <div className="space-y-4">
                            {skillGap.learning_plan.weeks
                              .slice()
                              .sort((a, b) => a.week - b.week)
                              .map((week) => (
                                <Card key={week.week}>
                                  <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                      <CardTitle className="text-base">
                                        Week {week.week} — {week.focus}
                                      </CardTitle>
                                      <Badge variant={PRIORITY_BADGE_VARIANT[week.priority]}>
                                        {PRIORITY_LABEL[week.priority]}
                                      </Badge>
                                    </div>
                                  </CardHeader>
                                  <CardContent className="space-y-3">
                                    <div>
                                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                                        Tasks
                                      </p>
                                      <ul className="list-disc space-y-1 pl-5 text-sm">
                                        {week.tasks.map((task, idx) => (
                                          <li key={idx}>{task}</li>
                                        ))}
                                      </ul>
                                    </div>
                                    {week.resources && week.resources.length > 0 && (
                                      <div>
                                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                                          Resources
                                        </p>
                                        <ul className="list-disc space-y-1 pl-5 text-sm">
                                          {week.resources.map((res, idx) => (
                                            <li key={idx}>{res}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </CardContent>
                                </Card>
                              ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
