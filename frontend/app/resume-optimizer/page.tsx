"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ClipboardPaste,
  Mic,
  Download,
  FileText,
  FileUp,
  Link2,
  Loader2,
  Lock,
  RotateCcw,
  ShieldCheck,
  Wand2,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { BrandLogo, ThemeToggle } from "@/components/brand";
import { type InterviewLevel, type InterviewState, type InterviewType, InterviewSession } from "@/components/mock-interview";
import { type ImprovedResume, ImprovedResumeDialog, saveBlob } from "@/components/improved-resume-dialog";
import { AnalysisPanel, ParsedResumePanel } from "@/components/resume-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { useAppSettings } from "@/lib/app-settings";
import { cn } from "@/lib/utils";
import { getVisitorId } from "@/lib/visitor";
import type { BulletRewrite, PublicResumeResult } from "@/types/optimizer";

const MIN_TEXT = 200;
const MAX_TEXT = 30_000;
const POLL_MS = 3000;
const POLL_LIMIT_MS = 3 * 60 * 1000;

const STEPS = ["Reading your resume", "Reviewing content & ATS fit", "Preparing your report"];

type Mode = "file" | "text";
type Tool = "optimizer" | "interview";
type FromSource = { id: string; token: string; label: string };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return "You've reached the free limit for now. Please try again in a little while.";
    if (err.status >= 500) return "Our servers are having a moment. Please try again shortly.";
    return err.detail;
  }
  return "We couldn't reach the server. Check your connection and try again.";
}

function PublicHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <BrandLogo />
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
          <Zap className="h-3.5 w-3.5" /> Free · No signup
        </span>
        </div>
      </div>
    </header>
  );
}

const INTERVIEW_STEPS = ["Reading your resume", "Writing questions about your experience", "Getting your interviewer ready"];

function ProgressSteps({ startedAt, interview = false }: { startedAt: number; interview?: boolean }) {
  const steps = interview ? INTERVIEW_STEPS : STEPS;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(t);
  }, [startedAt]);
  // Steps advance on a timer; the backend does the work in one request.
  const active = elapsed < 4000 ? 0 : elapsed < 12000 ? 1 : 2;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-6 py-12">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <div className="text-center">
          <h2 className="text-lg font-semibold">{interview ? "Preparing your interview" : "Analyzing your resume"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">This usually takes 10–30 seconds. Please keep this tab open.</p>
        </div>
        <ol className="w-full max-w-sm space-y-3">
          {steps.map((label, i) => (
            <li key={label} className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                  i < active && "border-success bg-success text-success-foreground",
                  i === active && "border-primary text-primary",
                  i > active && "border-border text-muted-foreground"
                )}
              >
                {i < active ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn(i > active && "text-muted-foreground", i === active && "font-medium")}>{label}</span>
              {i === active && <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ResumeOptimizerTool() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);
  const MAX_MB = useAppSettings((s) => s.settings.max_upload_mb);
  const submitting = useRef(false);

  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [showJob, setShowJob] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [busySince, setBusySince] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicResumeResult | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [improveOpen, setImproveOpen] = useState(false);
  const [tool, setTool] = useState<Tool>(searchParams?.get("mode") === "interview" ? "interview" : "optimizer");
  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [fromSource, setFromSource] = useState<FromSource | null>(null);
  const [ivCount, setIvCount] = useState<5 | 8 | 10>(5);
  const [ivType, setIvType] = useState<InterviewType>("mixed");
  const [ivLevel, setIvLevel] = useState<InterviewLevel>("mid");

  const fetchResult = useCallback(
    (id: string, token: string) =>
      api.get<PublicResumeResult>(`/api/public/requests/${id}`, { token }, { skipAuth: true }),
    []
  );

  // A duplicate submission can come back while the first run is still in progress: poll it.
  const settle = useCallback(
    async (res: PublicResumeResult) => {
      const started = Date.now();
      let current = res;
      while ((current.status === "pending" || current.status === "processing") && Date.now() - started < POLL_LIMIT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        current = await fetchResult(current.id, current.access_token);
      }
      return current;
    },
    [fetchResult]
  );

  // Re-open a result from the URL (refresh / shared link).
  useEffect(() => {
    const ivId = searchParams?.get("interview");
    const ivToken = searchParams?.get("it");
    if (ivId && ivToken) {
      setLoadingSaved(true);
      api
        .get<InterviewState>(`/api/public/interviews/${ivId}`, { token: ivToken }, { skipAuth: true })
        .then(setInterview)
        .catch((err) => setError(err instanceof ApiError && err.status === 404 ? "That interview link is invalid or has expired." : errorMessage(err)))
        .finally(() => setLoadingSaved(false));
      return;
    }
    const fromId = searchParams?.get("from");
    const fromToken = searchParams?.get("ft");
    if (fromId && fromToken) setFromSource({ id: fromId, token: fromToken, label: "the resume from your report" });
    const id = searchParams?.get("id");
    const token = searchParams?.get("t");
    if (!id || !token) return;
    setLoadingSaved(true);
    fetchResult(id, token)
      .then(settle)
      .then(setResult)
      .catch((err) => setError(err instanceof ApiError && err.status === 404 ? "That result link is invalid or has expired." : errorMessage(err)))
      .finally(() => setLoadingSaved(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickFile(f: File | undefined | null) {
    setError(null);
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") return setError("Please upload a PDF or DOCX file.");
    if (f.size === 0) return setError("That file is empty.");
    if (f.size > MAX_MB * 1024 * 1024) return setError(`File is larger than ${MAX_MB}MB.`);
    setFile(f);
  }

  const textLength = text.trim().length;
  const canSubmit = (tool === "interview" && !!fromSource) || (mode === "file" ? !!file : textLength >= MIN_TEXT && textLength <= MAX_TEXT);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setError(null);
    setBusySince(Date.now());
    if (tool === "interview") {
      try {
        const form = new FormData();
        if (fromSource) {
          form.append("from_request_id", fromSource.id);
          form.append("from_token", fromSource.token);
        } else if (mode === "file" && file) form.append("file", file);
        else form.append("resume_text", text.trim());
        if (jobTitle.trim()) form.append("job_title", jobTitle.trim());
        if (jobDescription.trim()) form.append("job_description", jobDescription.trim());
        form.append("count", String(ivCount));
        form.append("interview_type", ivType);
        form.append("level", ivLevel);
        const visitor = getVisitorId();
        if (visitor) form.append("visitor_id", visitor);
        const res = await api.post<InterviewState>("/api/public/interviews", form, { isFormData: true, skipAuth: true });
        if (res.status === "failed") {
          setError(res.error_message || "We couldn't prepare your interview. Please try again.");
        } else {
          setInterview(res);
          router.replace(`/resume-optimizer?interview=${res.id}&it=${encodeURIComponent(res.access_token)}`, { scroll: false });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusySince(null);
        submitting.current = false;
      }
      return;
    }
    try {
      const form = new FormData();
      if (mode === "file" && file) form.append("file", file);
      else form.append("resume_text", text.trim());
      if (jobTitle.trim()) form.append("job_title", jobTitle.trim());
      if (jobDescription.trim()) form.append("job_description", jobDescription.trim());
      const visitor = getVisitorId();
      if (visitor) form.append("visitor_id", visitor);

      const res = await settle(
        await api.post<PublicResumeResult>("/api/public/resume-optimizer", form, { isFormData: true, skipAuth: true })
      );
      if (res.status === "failed") {
        setError(res.error_message || "We couldn't analyze this resume. Please try again.");
      } else if (res.status !== "completed") {
        setError("This is taking longer than usual. Please try again in a minute.");
      } else {
        setResult(res);
        router.replace(`/resume-optimizer?id=${res.id}&t=${encodeURIComponent(res.access_token)}`, { scroll: false });
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusySince(null);
      submitting.current = false;
    }
  }

  function reset() {
    setResult(null);
    setInterview(null);
    setFromSource(null);
    setFile(null);
    setText("");
    setError(null);
    setTool("optimizer");
    router.replace("/resume-optimizer", { scroll: false });
  }

  /** Practice an interview using a resume the visitor already submitted (report or past interview). */
  function practiceFrom(source: FromSource) {
    setResult(null);
    setInterview(null);
    setError(null);
    setTool("interview");
    setFromSource(source);
    router.replace(`/resume-optimizer?mode=interview&from=${source.id}&ft=${encodeURIComponent(source.token)}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function answerInterview(index: number, answer: string, skip: boolean) {
    if (!interview) throw new Error("No interview");
    try {
      const next = await api.post<InterviewState>(
        `/api/public/interviews/${interview.id}/answer?token=${encodeURIComponent(interview.access_token)}`,
        { question_index: index, answer, skip },
        { skipAuth: true }
      );
      setInterview(next);
      return next;
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked; ignore */
    }
  }

  // ---------- Interview view ----------
  if (interview) {
    return (
      <InterviewSession
        key={interview.id}
        state={interview}
        onAnswer={answerInterview}
        onExit={reset}
        onRestart={() =>
          practiceFrom({ id: interview.id, token: interview.access_token, label: interview.candidate_name ? `${interview.candidate_name}'s resume` : "your resume" })
        }
      />
    );
  }

  // ---------- Result view ----------
  if (result?.analysis) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Resume Optimizer
        </button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Your resume report</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
              {result.parsed?.name ? `${result.parsed.name}'s resume` : result.input.filename || "Your resume"}
            </h1>
            {result.input.job_title && (
              <p className="mt-1 text-sm text-muted-foreground">Reviewed for: {result.input.job_title}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                practiceFrom({ id: result.id, token: result.access_token, label: result.parsed?.name ? `${result.parsed.name}'s resume` : "your resume" })
              }
              className="border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-500/40 dark:text-violet-300 dark:hover:bg-violet-500/10"
            >
              <Mic className="mr-2 h-4 w-4" /> Practice interview
            </Button>
            <Button
              onClick={() => setImproveOpen(true)}
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm hover:from-violet-500 hover:to-fuchsia-500"
            >
              <Wand2 className="mr-2 h-4 w-4" /> Update my resume
            </Button>
            <Button variant="outline" asChild>
              <a href={`${api.base}/api/public/requests/${result.id}/report.pdf?token=${encodeURIComponent(result.access_token)}`}>
                <Download className="mr-2 h-4 w-4" /> Download PDF
              </a>
            </Button>
            <Button variant="outline" onClick={copyLink}>
              <Link2 className="mr-2 h-4 w-4" /> {copied ? "Link copied" : "Copy link"}
            </Button>
            <Button onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" /> Analyze another
            </Button>
          </div>
        </div>
        <ImprovedResumeDialog
          open={improveOpen}
          onOpenChange={setImproveOpen}
          load={async () => {
            try {
              return await api.post<ImprovedResume>(
                `/api/public/requests/${result.id}/improved-resume?token=${encodeURIComponent(result.access_token)}`,
                undefined,
                { skipAuth: true }
              );
            } catch (err) {
              throw new Error(errorMessage(err));
            }
          }}
          onExport={async (resume, format) => {
            try {
              const blob = await api.post<Blob>(
                `/api/public/requests/${result.id}/export?token=${encodeURIComponent(result.access_token)}&format=${format}`,
                resume,
                { skipAuth: true }
              );
              saveBlob(blob, `${(resume.name || "resume").replace(/\s+/g, "-").toLowerCase()}-resume.${format}`);
            } catch (err) {
              throw new Error(errorMessage(err));
            }
          }}
        />
        <AnalysisPanel
          analysis={result.analysis}
          jobTitle={result.input.job_title}
          onRewrite={async () => {
            try {
              return await api.post<BulletRewrite[]>(
                `/api/public/requests/${result.id}/rewrites?token=${encodeURIComponent(result.access_token)}`,
                undefined,
                { skipAuth: true }
              );
            } catch (err) {
              throw new Error(errorMessage(err));
            }
          }}
        />
        {result.parsed && <ParsedResumePanel parsed={result.parsed} />}
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> Only people with this page&apos;s link can see this report.
        </p>
      </div>
    );
  }

  // ---------- Input view ----------
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:py-16">
      <section className="space-y-6 lg:pt-6">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
            tool === "interview" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "bg-primary/10 text-primary"
          )}
        >
          {tool === "interview" ? <Mic className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          {tool === "interview" ? "AI Mock Interview" : "AI Resume Optimizer"}
        </span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {tool === "interview" ? "Practice a real interview, built from your own resume." : "Find out what's holding your resume back, in under a minute."}
        </h1>
        <p className="text-base text-muted-foreground sm:text-lg">
          {tool === "interview"
            ? "Our AI interviewer asks questions about your actual projects, skills and target role. Answer by typing or speaking, and get instant feedback on every answer."
            : "Upload or paste your resume. You'll get a score, the exact issues to fix, what to add, and the ATS keywords you're missing, free and without creating an account."}
        </p>
        <ul className="space-y-3 text-sm">
          {(tool === "interview"
            ? [
                "Questions tailored to your resume, role and level",
                "Type or speak your answers (voice in Chrome & Edge)",
                "Score and feedback on every answer, plus a final report",
              ]
            : [
                "Resume score out of 100 with clear reasoning",
                "Issues found + concrete “what to add / fix” list",
                "Missing ATS keywords, optionally tailored to a job",
              ]
          ).map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4" /> Your resume is used only to generate your report.
        </p>
      </section>

      <section>
        {busySince || loadingSaved ? (
          <ProgressSteps startedAt={busySince ?? Date.now()} interview={tool === "interview"} />
        ) : (
          <Card className="shadow-sm">
            <CardContent className="p-5 sm:p-6">
              <form onSubmit={submit} className="space-y-6" noValidate>
                <div className="-mx-5 -mt-5 mb-1 grid grid-cols-2 border-b border-border sm:-mx-6 sm:-mt-6" role="tablist" aria-label="Free tools">
                  {(
                    [
                      { id: "optimizer", label: "Resume Optimizer", icon: Sparkles },
                      { id: "interview", label: "AI Mock Interview", icon: Mic },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tool === id}
                      onClick={() => {
                        setTool(id);
                        setError(null);
                        if (id === "optimizer") setFromSource(null);
                      }}
                      className={cn(
                        "-mb-px flex items-center justify-center gap-2 border-b-2 px-4 py-3.5 text-sm font-semibold transition-colors",
                        tool === id
                          ? id === "interview"
                            ? "border-violet-500 text-violet-700 dark:text-violet-300"
                            : "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  ))}
                </div>

                {tool === "interview" && fromSource ? (
                  <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm dark:border-violet-500/30 dark:bg-violet-500/10">
                    <FileText className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" />
                    <span className="flex-1">
                      Using <span className="font-medium">{fromSource.label}</span>, no need to upload again.
                    </span>
                    <button type="button" onClick={() => setFromSource(null)} className="text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
                      Use another
                    </button>
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1" role="tablist">
                  {(
                    [
                      { id: "file", label: "Upload file", icon: FileUp },
                      { id: "text", label: "Paste text", icon: ClipboardPaste },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={mode === id}
                      onClick={() => {
                        setMode(id);
                        setError(null);
                      }}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        mode === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" /> {label}
                    </button>
                  ))}
                </div>

                {mode === "file" ? (
                  file ? (
                    <div className="flex items-center gap-3 rounded-lg border border-border p-4">
                      <FileText className="h-8 w-8 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{file.name}</div>
                        <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</div>
                      </div>
                      <Button type="button" variant="ghost" size="icon" onClick={() => setFile(null)} aria-label="Remove file">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        pickFile(e.dataTransfer.files?.[0]);
                      }}
                      onClick={() => fileInput.current?.click()}
                      className={cn(
                        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                        dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-accent/40"
                      )}
                    >
                      <FileUp className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Drop your resume here or click to browse</p>
                        <p className="mt-1 text-xs text-muted-foreground">PDF or DOCX · up to {MAX_MB}MB</p>
                      </div>
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".pdf,.docx"
                        className="hidden"
                        onChange={(e) => {
                          pickFile(e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  )
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="resume-text">Resume text</Label>
                    <Textarea
                      id="resume-text"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Paste the full text of your resume here…"
                      className="min-h-[220px] resize-y"
                      maxLength={MAX_TEXT}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{textLength > 0 && textLength < MIN_TEXT ? `At least ${MIN_TEXT} characters needed` : " "}</span>
                      <span>
                        {textLength.toLocaleString()} / {MAX_TEXT.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                </>
                )}

                {tool === "interview" && (
                  <div className="space-y-4 rounded-lg border border-border p-4">
                    {(
                      [
                        { label: "Questions", value: ivCount, set: (v: string) => setIvCount(Number(v) as 5 | 8 | 10), options: [["5", "5"], ["8", "8"], ["10", "10"]] },
                        { label: "Type", value: ivType, set: (v: string) => setIvType(v as InterviewType), options: [["technical", "Technical"], ["behavioral", "HR / Behavioral"], ["mixed", "Mixed"]] },
                        { label: "Level", value: ivLevel, set: (v: string) => setIvLevel(v as InterviewLevel), options: [["junior", "Junior"], ["mid", "Mid"], ["senior", "Senior"]] },
                      ] as const
                    ).map(({ label, value, set, options }) => (
                      <div key={label} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        <div className="inline-flex rounded-md border border-input bg-secondary/60 p-0.5" role="radiogroup" aria-label={label}>
                          {options.map(([v, text]) => (
                            <button
                              key={v}
                              type="button"
                              role="radio"
                              aria-checked={String(value) === v}
                              onClick={() => set(v)}
                              className={cn(
                                "rounded px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                                String(value) === v ? "bg-violet-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {text}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setShowJob((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                    aria-expanded={showJob}
                  >
                    <span>
                      <span className="text-sm font-medium">Target a specific job</span>
                      <span className="ml-2 text-xs text-muted-foreground">Optional</span>
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showJob && "rotate-180")} />
                  </button>
                  {showJob && (
                    <div className="space-y-4 border-t border-border px-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="job-title">Job title</Label>
                        <Input
                          id="job-title"
                          value={jobTitle}
                          onChange={(e) => setJobTitle(e.target.value)}
                          placeholder="e.g. Senior Frontend Engineer"
                          maxLength={200}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="job-description">Job description</Label>
                        <Textarea
                          id="job-description"
                          value={jobDescription}
                          onChange={(e) => setJobDescription(e.target.value)}
                          placeholder="Paste the job description to get tailored keyword suggestions"
                          className="min-h-[120px]"
                          maxLength={10_000}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {error && (
                  <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {tool === "interview" ? (
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
                    disabled={!canSubmit}
                  >
                    <Mic className="mr-2 h-4 w-4" /> Start interview, free
                  </Button>
                ) : (
                  <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
                    <Sparkles className="mr-2 h-4 w-4" /> Analyze my resume, free
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

export default function PublicResumeOptimizerPage() {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader />
      <Suspense>
        <ResumeOptimizerTool />
      </Suspense>
    </div>
  );
}
