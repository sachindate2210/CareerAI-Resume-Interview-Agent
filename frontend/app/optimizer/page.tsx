"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, FileUp, Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge, scoreTone } from "@/components/resume-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError } from "@/lib/api";
import { useAppSettings } from "@/lib/app-settings";
import { cn, formatDate } from "@/lib/utils";
import type { Page, Resume, UploadResponse } from "@/types/optimizer";


export default function OptimizerPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const MAX_MB = useAppSettings((s) => s.settings.max_upload_mb);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Page<Resume>>("/api/resumes", { page_size: 50 });
      setResumes(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load your resumes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") {
      setError("Please upload a PDF or DOCX file.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File is larger than ${MAX_MB}MB.`);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post<UploadResponse>("/api/resumes/upload", form, { isFormData: true });
      router.push(`/optimizer/${res.resume.id}${res.resume.status === "parsed" ? "?analyze=1" : ""}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Upload failed.");
      setUploading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resume Optimizer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your resume to see what&apos;s wrong with it, what to add, and how ATS-friendly it is.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) upload(file);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Uploading and reading your resume…</p>
            </>
          ) : (
            <>
              <FileUp className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Drag &amp; drop your resume here</p>
                <p className="text-xs text-muted-foreground">PDF or DOCX, up to {MAX_MB}MB</p>
              </div>
              <Button onClick={() => inputRef.current?.click()}>Choose file</Button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your resumes</CardTitle>
            <CardDescription>Open one to see its analysis.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="space-y-2 p-6">
                <div className="h-10 animate-pulse rounded bg-muted" />
                <div className="h-10 animate-pulse rounded bg-muted" />
              </div>
            ) : resumes.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No resumes yet — upload one above.</p>
            ) : (
              <ul className="divide-y divide-border">
                {resumes.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/optimizer/${r.id}`}
                      className="flex items-center gap-4 px-6 py-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.filename}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(r.created_at)}</div>
                      </div>
                      <StatusBadge status={r.status} />
                      <div className={cn("w-12 text-right text-sm font-semibold", scoreTone(r.analysis?.score))}>
                        {r.analysis ? r.analysis.score : "—"}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
