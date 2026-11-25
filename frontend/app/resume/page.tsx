"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UploadCloud, FileText, CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn, formatDate } from "@/lib/utils";
import type { Paginated, ResumeRead, ResumeUploadResponse, ResumeStatus } from "@/types/api";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".docx"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function statusVariant(status: ResumeStatus): "secondary" | "success" | "destructive" {
  if (status === "parsed") return "success";
  if (status === "failed") return "destructive";
  return "secondary";
}

function validateFile(file: File): string | null {
  const lowerName = file.name.toLowerCase();
  const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const hasValidMime = file.type === "" || ALLOWED_MIME_TYPES.includes(file.type);
  if (!hasValidExtension || !hasValidMime) {
    return "Only .pdf and .docx files are supported.";
  }
  if (file.size > MAX_SIZE_BYTES) {
    return "File is too large. Maximum size is 10MB.";
  }
  return null;
}

export default function ResumeListPage() {
  const [resumes, setResumes] = useState<ResumeRead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadResumes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Paginated<ResumeRead>>("/api/resumes");
      setResumes(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Failed to load resumes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResumes();
  }, [loadResumes]);

  const handleFile = useCallback(
    async (file: File) => {
      setUploadError(null);
      setUploadSuccess(null);

      const validationError = validateFile(file);
      if (validationError) {
        setUploadError(validationError);
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await api.post<ResumeUploadResponse>(
          "/api/resumes/upload",
          formData,
          { isFormData: true }
        );
        setUploadSuccess(`"${file.name}" uploaded — processing started.`);
        // Optimistically add a processing row, then refetch for accurate data.
        setResumes((prev) => [
          {
            id: res.resume_id,
            user_id: "",
            filename: file.name,
            status: res.status,
            created_at: new Date().toISOString(),
          },
          ...(prev ?? []),
        ]);
        await loadResumes();
      } catch (err) {
        setUploadError(err instanceof ApiError ? err.detail : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [loadResumes]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resumes</h1>
          <p className="text-sm text-muted-foreground">
            Upload and manage your resumes.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
                isDragging ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50"
              )}
            >
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  Drag and drop your resume here, or click to browse
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF or DOCX, up to 10MB
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = "";
                }}
              />
            </div>

            {uploading && (
              <p className="mt-3 text-sm text-muted-foreground">Uploading…</p>
            )}
            {uploadError && (
              <p className="mt-3 text-sm text-destructive">{uploadError}</p>
            )}
            {uploadSuccess && (
              <p className="mt-3 flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                {uploadSuccess}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your Resumes</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : !resumes || resumes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No resumes yet. Upload one above to get started.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumes.map((resume) => (
                    <TableRow key={resume.id}>
                      <TableCell>
                        <Link
                          href={`/resume/${resume.id}`}
                          className="flex items-center gap-2 font-medium text-primary hover:underline"
                        >
                          <FileText className="h-4 w-4" />
                          {resume.filename}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(resume.status)}>
                          {resume.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(resume.created_at)}</TableCell>
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
