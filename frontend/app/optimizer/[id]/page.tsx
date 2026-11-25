"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Loader2, Wand2 } from "lucide-react";
import { type ImprovedResume, ImprovedResumeDialog, saveBlob } from "@/components/improved-resume-dialog";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { ResumeView } from "@/components/resume-view";
import { api, ApiError } from "@/lib/api";
import type { BulletRewrite, Resume, ResumeAnalysis, ResumeVersion } from "@/types/optimizer";

function ResumeDetail() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params?.id as string;

  const [resume, setResume] = useState<Resume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const autoStarted = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [improveOpen, setImproveOpen] = useState(false);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const blob = await api.get<Blob>(`/api/resumes/${id}/report.pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resume-report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setAnalyzeError(err instanceof ApiError ? err.detail : "Couldn't download the report.");
    } finally {
      setDownloading(false);
    }
  }

  const analyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const analysis = await api.post<ResumeAnalysis>(`/api/resumes/${id}/analyze`);
      setResume((r) => (r ? { ...r, analysis, analyzed_at: new Date().toISOString() } : r));
    } catch (err) {
      setAnalyzeError(err instanceof ApiError ? err.detail : "Analysis failed. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api
      .get<Resume>(`/api/resumes/${id}`)
      .then((r) => {
        setResume(r);
        // Fresh upload: kick off analysis automatically, then drop the flag from the URL.
        if (searchParams?.get("analyze") && r.status === "parsed" && !r.analysis && !autoStarted.current) {
          autoStarted.current = true;
          router.replace(`/optimizer/${id}`);
          analyze();
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.detail : "Failed to load resume."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/optimizer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All resumes
      </Link>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!resume && !error && <div className="h-40 animate-pulse rounded-lg bg-muted" />}
      {resume && (
        <ResumeView
          resume={resume}
          onAnalyze={analyze}
          analyzing={analyzing}
          analyzeError={analyzeError}
          onRewrite={async () => {
            try {
              return await api.post<BulletRewrite[]>(`/api/resumes/${id}/rewrites`);
            } catch (err) {
              throw new Error(err instanceof ApiError ? err.detail : "Couldn't generate rewrites.");
            }
          }}
          actions={
            <>
            <Button
              onClick={() => setImproveOpen(true)}
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm hover:from-violet-500 hover:to-fuchsia-500"
            >
              <Wand2 className="mr-2 h-4 w-4" /> Update my resume
            </Button>
            <Button variant="outline" onClick={downloadPdf} disabled={downloading}>
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download PDF
            </Button>
            </>
          }
        />
      )}
      {resume && (
        <ImprovedResumeDialog
          open={improveOpen}
          onOpenChange={setImproveOpen}
          load={async () => {
            try {
              return await api.post<ImprovedResume>(`/api/resumes/${id}/improved-resume`);
            } catch (err) {
              throw new Error(err instanceof ApiError ? err.detail : "Couldn't prepare your updated resume.");
            }
          }}
          onExport={async (updated, format) => {
            try {
              const blob = await api.post<Blob>(`/api/resumes/${id}/export?format=${format}`, updated);
              saveBlob(blob, `${(updated.name || "resume").replace(/\s+/g, "-").toLowerCase()}-resume.${format}`);
            } catch (err) {
              throw new Error(err instanceof ApiError ? err.detail : "Download failed.");
            }
          }}
          onSave={async (updated) => {
            try {
              const version = await api.post<ResumeVersion>(`/api/resumes/${id}/apply`, updated);
              setResume((r) => (r ? { ...r, latest_version: version } : r));
            } catch (err) {
              throw new Error(err instanceof ApiError ? err.detail : "Couldn't save the new version.");
            }
          }}
        />
      )}
    </div>
  );
}

export default function OptimizerResumePage() {
  return (
    <AppShell>
      <Suspense>
        <ResumeDetail />
      </Suspense>
    </AppShell>
  );
}
