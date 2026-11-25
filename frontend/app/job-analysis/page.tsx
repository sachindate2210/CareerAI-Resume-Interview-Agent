"use client";

import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { formatDate } from "@/lib/utils";
import type { JobRead, Paginated } from "@/types/api";

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">None identified.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, idx) => (
        <Badge key={`${item}-${idx}`} variant="secondary">
          {item}
        </Badge>
      ))}
    </div>
  );
}

export default function JobAnalysisPage() {
  const [rawDescription, setRawDescription] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<JobRead | null>(null);

  const [jobs, setJobs] = useState<JobRead[] | null>(null);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  async function loadJobs() {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await api.get<Paginated<JobRead>>("/api/jobs");
      setJobs(res.items);
    } catch (err) {
      setJobsError(err instanceof ApiError ? err.detail : "Failed to load jobs.");
    } finally {
      setJobsLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileNote(null);
    const isTxt = file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt");
    if (isTxt) {
      try {
        const text = await file.text();
        setRawDescription(text);
        setFileNote(`Loaded text from ${file.name}.`);
      } catch {
        setFileNote(`Could not read ${file.name}. Please paste the text instead.`);
      }
    } else {
      setFileNote(
        `Client-side text extraction for "${file.name}" isn't attempted here (only .txt is supported). Please paste the job description text directly.`
      );
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const job = await api.post<JobRead>("/api/jobs/analyze", {
        raw_description: rawDescription,
        title: title || undefined,
        company: company || undefined,
        source_url: sourceUrl || undefined,
      });
      setResult(job);
      loadJobs();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.detail : "Failed to analyze job description.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Job Analysis</h1>
          <p className="text-sm text-muted-foreground">
            Paste a job description to extract required skills, responsibilities, and keywords.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Analyze a job description</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {submitError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="title">Title (optional)</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Backend Engineer" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company">Company (optional)</Label>
                  <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc." />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source_url">Source URL (optional)</Label>
                  <Input id="source_url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="raw_description">Job description</Label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.pdf,text/plain,application/pdf"
                      className="hidden"
                      id="job-file-input"
                      onChange={handleFileChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload .txt/.pdf
                    </Button>
                  </div>
                </div>
                <Textarea
                  id="raw_description"
                  required
                  className="min-h-[220px]"
                  value={rawDescription}
                  onChange={(e) => setRawDescription(e.target.value)}
                  placeholder="Paste the full job description here..."
                />
                {fileNote && <p className="text-xs text-muted-foreground">{fileNote}</p>}
              </div>

              <Button type="submit" disabled={submitting || rawDescription.trim().length === 0}>
                {submitting ? "Analyzing..." : "Analyze job description"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle>
                {result.analysis.job_title || result.title || "Analysis result"}
                {result.analysis.company || result.company
                  ? ` — ${result.analysis.company || result.company}`
                  : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h3 className="mb-2 text-sm font-medium">Required skills</h3>
                <ChipList items={result.analysis.required_skills} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Preferred skills</h3>
                <ChipList items={result.analysis.preferred_skills} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Technologies</h3>
                <ChipList items={result.analysis.technologies} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Keywords</h3>
                <ChipList items={result.analysis.keywords} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-medium">Responsibilities</h3>
                {result.analysis.responsibilities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None identified.</p>
                ) : (
                  <ul className="list-disc space-y-1.5 pl-5 text-sm">
                    {result.analysis.responsibilities.map((r, idx) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Previously analyzed jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {jobsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : jobsError ? (
              <p className="text-sm text-destructive">{jobsError}</p>
            ) : !jobs || jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs analyzed yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Job ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium">
                        {job.analysis?.job_title || job.title || "Untitled"}
                      </TableCell>
                      <TableCell>{job.analysis?.company || job.company || "—"}</TableCell>
                      <TableCell>{formatDate(job.created_at)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {job.id}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
