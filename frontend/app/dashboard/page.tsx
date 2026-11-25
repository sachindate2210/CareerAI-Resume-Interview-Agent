"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatPercent } from "@/lib/utils";
import type { DashboardData } from "@/types/api";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 text-3xl font-semibold tracking-tight">
          {formatPercent(value)}
        </div>
        <Progress value={Math.max(0, Math.min(100, value ?? 0))} />
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get<DashboardData>("/api/analytics/dashboard");
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.detail : "Failed to load dashboard."
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
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-6">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
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

  if (!data) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">No data available.</p>
      </AppShell>
    );
  }

  const chartData = [
    { metric: "Resume", value: data.resume_score },
    { metric: "ATS", value: data.ats_score },
    { metric: "Job Match", value: data.job_match_score },
    { metric: "Interview", value: data.interview_readiness },
  ];

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            A snapshot of your resume, job match, and interview performance.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Resume Score" value={data.resume_score} />
          <StatCard label="ATS Score" value={data.ats_score} />
          <StatCard label="Job Match" value={data.job_match_score} />
          <StatCard label="Interview Readiness" value={data.interview_readiness} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Score Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80 w-full">
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Skills Detected</CardTitle>
            </CardHeader>
            <CardContent>
              {data.skills_detected.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No skills detected yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.skills_detected.map((skill) => (
                    <Badge key={skill} variant="secondary">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Missing Skills</CardTitle>
            </CardHeader>
            <CardContent>
              {data.missing_skills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No missing skills identified.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.missing_skills.map((skill) => (
                    <Badge key={skill} variant="outline">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Analyses</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent_analyses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No analyses yet —{" "}
                <Link href="/resume" className="text-primary underline-offset-4 hover:underline">
                  upload a resume
                </Link>{" "}
                to get started.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent_analyses.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link
                          href={`/resume/${a.resume_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {a.filename ?? "Untitled resume"}
                        </Link>
                      </TableCell>
                      <TableCell>{formatPercent(a.score)}</TableCell>
                      <TableCell>{formatDate(a.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Interviews</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent_interviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No interviews yet —{" "}
                <Link href="/interview" className="text-primary underline-offset-4 hover:underline">
                  start a practice interview
                </Link>
                .
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent_interviews.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Link
                          href={
                            i.status === "in_progress"
                              ? `/interview/${i.id}`
                              : `/results?interview=${i.id}`
                          }
                          className="font-medium text-primary hover:underline capitalize"
                        >
                          {i.mode.replace("_", " ")}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={i.status === "completed" ? "success" : "secondary"}>
                          {i.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatPercent(i.overall_score)}</TableCell>
                      <TableCell>{formatDate(i.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recommended Improvements</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recommended_improvements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recommendations right now — nice work.
              </p>
            ) : (
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {data.recommended_improvements.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
