"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ResumeView } from "@/components/resume-view";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/lib/store";
import type { AdminResumeDetail } from "@/types/optimizer";

export default function AdminResumeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;
  const [resume, setResume] = useState<AdminResumeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canDelete = can(useAuthStore((s) => s.user), "resumes", "delete");

  useEffect(() => {
    if (!id) return;
    api
      .get<AdminResumeDetail>(`/api/admin/resumes/${id}`)
      .then(setResume)
      .catch((err) => setError(err instanceof ApiError ? err.detail : "Failed to load resume."));
  }, [id]);

  async function openOriginal() {
    try {
      const blob = await api.get<Blob>(`/api/admin/resumes/${id}/file`);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Could not open the original file.");
    }
  }

  async function remove() {
    if (!window.confirm("Delete this resume permanently?")) return;
    setBusy(true);
    try {
      await api.del(`/api/admin/resumes/${id}`);
      router.replace("/admin/resumes");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Delete failed.");
      setBusy(false);
    }
  }

  return (
    <AppShell require={{ module: "resumes", action: "view" }}>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/admin/resumes"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All resumes
          </Link>
          {resume && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={openOriginal}>
                <Download className="mr-2 h-4 w-4" /> Original file
              </Button>
              {canDelete && (
                <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              )}
            </div>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!resume && !error && <div className="h-40 animate-pulse rounded-lg bg-muted" />}
        {resume && (
          <ResumeView
            resume={resume}
            headerExtra={
              <p className="text-sm text-muted-foreground">
                Submitted by <span className="font-medium text-foreground">{resume.owner.full_name || "—"}</span> (
                {resume.owner.email})
              </p>
            }
          />
        )}
      </div>
    </AppShell>
  );
}
