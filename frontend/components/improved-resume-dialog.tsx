"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Save, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ParsedResume } from "@/types/optimizer";

export interface ImprovedResume {
  resume: ParsedResume;
  changes: { section: string; before: string | null; after: string }[];
  placeholders: number;
}

const PLACEHOLDER = /\[[^\]]{1,40}\]/g;

function countPlaceholders(resume: ParsedResume): number {
  return (JSON.stringify(resume).match(PLACEHOLDER) ?? []).length;
}

function AutoTextarea({
  value,
  onChange,
  improved,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  improved?: boolean;
  className?: string;
}) {
  const hasPlaceholder = PLACEHOLDER.test(value);
  PLACEHOLDER.lastIndex = 0;
  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.max(1, Math.ceil(value.length / 95))}
        className={cn(
          "w-full resize-none rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          hasPlaceholder ? "border-amber-400 bg-amber-500/5" : improved ? "border-emerald-400/70 bg-emerald-500/5" : "border-input",
          className
        )}
      />
      {(improved || hasPlaceholder) && (
        <span
          className={cn(
            "pointer-events-none absolute -top-2 right-2 rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide",
            hasPlaceholder ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
          )}
        >
          {hasPlaceholder ? "Fill in" : "AI improved"}
        </span>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

/**
 * Applies the AI suggestions to a copy of the resume, lets the candidate review and edit every
 * line (and fill placeholders), then download it as PDF/DOCX or save it as a new version.
 */
export function ImprovedResumeDialog({
  open,
  onOpenChange,
  load,
  onExport,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  load: () => Promise<ImprovedResume>;
  onExport: (resume: ParsedResume, format: "pdf" | "docx") => Promise<void>;
  /** Signed-in flow only: store the edited resume as a new version. */
  onSave?: (resume: ParsedResume) => Promise<void>;
}) {
  const [data, setData] = useState<ImprovedResume | null>(null);
  const [resume, setResume] = useState<ParsedResume | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"pdf" | "docx" | "save" | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    setError(null);
    load()
      .then((res) => {
        setData(res);
        setResume(res.resume);
      })
      .catch((err) => setError(err instanceof Error && err.message ? err.message : "Couldn't prepare your updated resume."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const improvedTexts = useMemo(() => new Set((data?.changes ?? []).map((c) => c.after.trim())), [data]);
  const placeholdersLeft = resume ? countPlaceholders(resume) : 0;
  const isImproved = (text?: string | null) => !!text && improvedTexts.has(text.trim());

  function update(fn: (r: ParsedResume) => void) {
    setResume((r) => {
      if (!r) return r;
      const copy = structuredClone(r);
      fn(copy);
      return copy;
    });
    setSaved(false);
  }

  async function run(kind: "pdf" | "docx" | "save") {
    if (!resume) return;
    if (placeholdersLeft > 0 && !window.confirm(`${placeholdersLeft} placeholder(s) like [X%] still need real values. Continue anyway?`)) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") {
        await onSave?.(resume);
        setSaved(true);
      } else {
        await onExport(resume, kind);
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="mb-0 border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-500" /> Your updated resume
          </DialogTitle>
          <DialogDescription>
            We applied the AI improvements to a copy of your resume. Review every line, fill in the highlighted placeholders, then download.
          </DialogDescription>
          {data && (
            <div className="flex flex-wrap gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" /> {data.changes.length} improvement{data.changes.length === 1 ? "" : "s"} applied
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  placeholdersLeft ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-secondary text-muted-foreground"
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" /> {placeholdersLeft ? `${placeholdersLeft} placeholder${placeholdersLeft === 1 ? "" : "s"} to fill` : "No placeholders left"}
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Applying AI improvements…</p>
              <p className="text-xs text-muted-foreground">Rewriting weak bullets and polishing your summary. This takes a few seconds.</p>
            </div>
          )}
          {error && <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

          {resume && !loading && (
            <div className="space-y-6">
              <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3">
                <div className="text-lg font-semibold">{resume.name || "Your name"}</div>
                <div className="text-sm text-muted-foreground">{[resume.email, resume.phone].filter(Boolean).join(" · ")}</div>
              </div>

              <section>
                <SectionTitle>Summary</SectionTitle>
                <AutoTextarea value={resume.summary ?? ""} improved={isImproved(resume.summary)} onChange={(v) => update((r) => void (r.summary = v))} />
              </section>

              <section>
                <SectionTitle>Skills (comma-separated)</SectionTitle>
                <AutoTextarea
                  value={(resume.skills ?? []).join(", ")}
                  onChange={(v) => update((r) => void (r.skills = v.split(",").map((s) => s.trim()).filter(Boolean)))}
                />
              </section>

              {(resume.experience ?? []).length > 0 && (
                <section>
                  <SectionTitle>Experience</SectionTitle>
                  <div className="space-y-4">
                    {resume.experience!.map((exp, i) => (
                      <div key={i} className="rounded-lg border border-border p-4">
                        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                          <div className="font-medium">
                            {exp.title || "Role"}
                            {exp.company && <span className="text-muted-foreground"> · {exp.company}</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{[exp.start_date, exp.end_date].filter(Boolean).join(" – ")}</div>
                        </div>
                        <div className="space-y-2.5">
                          {(exp.bullets ?? []).map((b, j) => (
                            <AutoTextarea
                              key={j}
                              value={b}
                              improved={isImproved(b)}
                              onChange={(v) => update((r) => void (r.experience![i].bullets![j] = v))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {(resume.projects ?? []).some((p) => (p.bullets ?? []).length > 0) && (
                <section>
                  <SectionTitle>Projects</SectionTitle>
                  <div className="space-y-4">
                    {resume.projects!.map((proj, i) =>
                      (proj.bullets ?? []).length ? (
                        <div key={i} className="rounded-lg border border-border p-4">
                          <div className="mb-3 font-medium">{proj.name || "Project"}</div>
                          <div className="space-y-2.5">
                            {proj.bullets!.map((b, j) => (
                              <AutoTextarea
                                key={j}
                                value={b}
                                improved={isImproved(b)}
                                onChange={(v) => update((r) => void (r.projects![i].bullets![j] = v))}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null
                    )}
                  </div>
                </section>
              )}

              {(resume.education ?? []).length > 0 && (
                <section>
                  <SectionTitle>Education (unchanged)</SectionTitle>
                  <ul className="space-y-1 text-sm">
                    {resume.education!.map((ed, i) => (
                      <li key={i}>
                        <span className="font-medium">{[ed.degree, ed.field].filter(Boolean).join(", ")}</span>
                        {ed.institution && <span className="text-muted-foreground"> · {ed.institution}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Your original file is never changed.
          </p>
          <div className="flex flex-wrap gap-2">
            {onSave && (
              <Button variant="outline" disabled={!resume || busy !== null} onClick={() => run("save")}>
                {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : saved ? <CheckCircle2 className="mr-2 h-4 w-4 text-success" /> : <Save className="mr-2 h-4 w-4" />}
                {saved ? "Saved as new version" : "Save as new version"}
              </Button>
            )}
            <Button variant="outline" disabled={!resume || busy !== null} onClick={() => run("docx")}>
              {busy === "docx" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Word (.docx)
            </Button>
            <Button
              disabled={!resume || busy !== null}
              onClick={() => run("pdf")}
              className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
            >
              {busy === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download PDF
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Save a Blob as a file. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
