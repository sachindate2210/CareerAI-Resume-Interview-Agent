"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { api, ApiError } from "@/lib/api";
import type { LearningPlan, LearningPlanWeek, SkillPriority } from "@/types/api";

const PRIORITY_SECTIONS: { key: SkillPriority; label: string; variant: "destructive" | "warning" | "secondary" }[] = [
  { key: "critical", label: "Critical", variant: "destructive" },
  { key: "important", label: "Important", variant: "warning" },
  { key: "nice_to_have", label: "Nice-to-have", variant: "secondary" },
];

// Local-only checked-task state, persisted to localStorage keyed by plan id.
type CheckedState = Record<string, boolean>;

function taskKey(week: number, taskIdx: number): string {
  return `${week}:${taskIdx}`;
}

function loadChecked(planId: string): CheckedState {
  try {
    const raw = localStorage.getItem(`learning_plan_progress_${planId}`);
    if (!raw) return {};
    return JSON.parse(raw) as CheckedState;
  } catch {
    return {};
  }
}

function saveChecked(planId: string, state: CheckedState): void {
  try {
    localStorage.setItem(`learning_plan_progress_${planId}`, JSON.stringify(state));
  } catch {
    // ignore — localStorage unavailable (private mode, quota, etc.)
  }
}

export default function LearningPlanPage() {
  const searchParams = useSearchParams();
  const planId = searchParams.get("id");

  const [plan, setPlan] = useState<LearningPlan | null>(null);
  const [loading, setLoading] = useState(!!planId);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<CheckedState>({});

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<LearningPlan>(`/api/learning-plan/${planId}`);
        if (!cancelled) {
          setPlan(res);
          setChecked(loadChecked(planId as string));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.detail : "Failed to load learning plan.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const toggleTask = (week: number, taskIdx: number) => {
    setChecked((prev) => {
      const next = { ...prev, [taskKey(week, taskIdx)]: !prev[taskKey(week, taskIdx)] };
      if (planId) saveChecked(planId, next);
      return next;
    });
  };

  const grouped = useMemo(() => {
    if (!plan) return null;
    const map: Record<SkillPriority, LearningPlanWeek[]> = {
      critical: [],
      important: [],
      nice_to_have: [],
    };
    for (const week of plan.weeks) {
      map[week.priority]?.push(week);
    }
    return map;
  }, [plan]);

  const overallProgress = useMemo(() => {
    if (!plan) return { done: 0, total: 0 };
    let done = 0;
    let total = 0;
    for (const week of plan.weeks) {
      total += week.tasks.length;
      week.tasks.forEach((_, idx) => {
        if (checked[taskKey(week.week, idx)]) done += 1;
      });
    }
    return { done, total };
  }, [plan, checked]);

  if (!planId) {
    return (
      <AppShell>
        <Card>
          <CardContent className="p-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              No learning plan selected. Run a Match and Skill Gap analysis first to
              generate a personalized learning plan.
            </p>
            <Link href="/match" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Go to Match &amp; Skill Gap
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
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

  if (!plan || !grouped) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">No learning plan available.</p>
      </AppShell>
    );
  }

  const overallPct = overallProgress.total > 0 ? (overallProgress.done / overallProgress.total) * 100 : 0;

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Learning Plan</h1>
          <p className="text-sm text-muted-foreground">
            Your week-by-week roadmap to close skill gaps.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Overall Progress</CardTitle>
            <CardDescription>
              {overallProgress.done} of {overallProgress.total} tasks complete
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={overallPct} />
          </CardContent>
        </Card>

        {PRIORITY_SECTIONS.map((section) => {
          const weeks = grouped[section.key];
          if (!weeks || weeks.length === 0) return null;
          return (
            <div key={section.key} className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight">{section.label}</h2>
                <Badge variant={section.variant}>{weeks.length} week{weeks.length === 1 ? "" : "s"}</Badge>
              </div>
              <div className="space-y-4">
                {weeks.map((week) => {
                  const total = week.tasks.length;
                  const done = week.tasks.reduce(
                    (acc, _, idx) => acc + (checked[taskKey(week.week, idx)] ? 1 : 0),
                    0
                  );
                  const pct = total > 0 ? (done / total) * 100 : 0;
                  return (
                    <Card key={week.week}>
                      <CardHeader>
                        <CardTitle className="text-base">
                          Week {week.week}: {week.focus}
                        </CardTitle>
                        {week.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {week.skills.map((skill) => (
                              <Badge key={skill} variant="outline">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <Progress value={pct} />
                        <div className="space-y-2">
                          {week.tasks.map((task, idx) => (
                            <label
                              key={idx}
                              className="flex items-start gap-2 text-sm cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 rounded border-input"
                                checked={!!checked[taskKey(week.week, idx)]}
                                onChange={() => toggleTask(week.week, idx)}
                              />
                              <span
                                className={
                                  checked[taskKey(week.week, idx)]
                                    ? "text-muted-foreground line-through"
                                    : ""
                                }
                              >
                                {task}
                              </span>
                            </label>
                          ))}
                        </div>
                        {week.resources && week.resources.length > 0 && (
                          <div>
                            <p className="text-xs font-medium uppercase text-muted-foreground">
                              Resources
                            </p>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                              {week.resources.map((resource, idx) => (
                                <li key={idx}>{resource}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
