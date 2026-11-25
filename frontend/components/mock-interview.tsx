"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  SkipForward,
  Sparkles,
  Target,
  ThumbsUp,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type InterviewType = "technical" | "behavioral" | "mixed";
export type InterviewLevel = "junior" | "mid" | "senior";

export interface AnswerEvaluation {
  score: number;
  verdict: string;
  strengths: string[];
  improvements: string[];
  better_answer: string;
}

export interface InterviewQuestion {
  index: number;
  question: string;
  topic: string;
  kind: "technical" | "behavioral" | "resume" | string;
  answer?: string | null;
  skipped?: boolean;
  evaluation?: AnswerEvaluation | null;
}

export interface InterviewState {
  id: string;
  access_token: string;
  status: "pending" | "processing" | "completed" | "failed";
  settings: { count: 5 | 8 | 10; type: InterviewType; level: InterviewLevel };
  candidate_name?: string | null;
  job_title?: string | null;
  total: number;
  current_index: number;
  questions: InterviewQuestion[];
  overall_score?: number | null;
  summary?: { headline: string; strengths: string[]; focus_areas: string[]; next_steps: string[] } | null;
  error_message?: string | null;
}

const KIND_LABEL: Record<string, { label: string; tone: string }> = {
  technical: { label: "Technical", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  behavioral: { label: "Behavioral", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  resume: { label: "About your resume", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
};

function scoreColor(score10: number) {
  return score10 >= 8 ? "text-emerald-600 dark:text-emerald-400" : score10 >= 6 ? "text-blue-600 dark:text-blue-400" : score10 >= 4 ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400";
}
function scoreBg(score10: number) {
  return score10 >= 8 ? "bg-emerald-500" : score10 >= 6 ? "bg-blue-500" : score10 >= 4 ? "bg-amber-500" : "bg-rose-500";
}

// ---------------------------------------------------------------- speech-to-text

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
    .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Mic button that appends what the user says to the answer (Chrome/Edge). */
function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => setSupported(!!getRecognition()), []);
  useEffect(() => () => rec.current?.stop(), []);

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = getRecognition();
    if (!r) return;
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (finalText) onText(finalText.trim());
      setInterim(interimText);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    r.onerror = (e) => {
      setMicError(e.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser to speak your answer." : "Couldn't hear you. Try again or type your answer.");
      setListening(false);
    };
    rec.current = r;
    setMicError(null);
    r.start();
    setListening(true);
  }

  return { listening, supported, interim, micError, toggle, stop: () => rec.current?.stop() };
}

// ---------------------------------------------------------------- pieces

function FeedbackCard({ q }: { q: InterviewQuestion }) {
  const [showBetter, setShowBetter] = useState(false);
  const e = q.evaluation!;
  return (
    <Card className="overflow-hidden">
      <div className={cn("h-1", scoreBg(e.score))} />
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-secondary">
            <span className={cn("text-2xl font-bold tabular-nums", scoreColor(e.score))}>{e.score}</span>
            <span className="text-[10px] text-muted-foreground">/ 10</span>
          </div>
          <div>
            <div className="text-sm font-semibold">{q.skipped ? "Skipped" : "Feedback on your answer"}</div>
            <p className="text-sm text-muted-foreground">{e.verdict}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {e.strengths.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                <ThumbsUp className="h-3.5 w-3.5" /> What worked
              </div>
              <ul className="space-y-1.5 text-sm">
                {e.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {e.improvements.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                <TrendingUp className="h-3.5 w-3.5" /> How to improve
              </div>
              <ul className="space-y-1.5 text-sm">
                {e.improvements.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {e.better_answer && (
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setShowBetter((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" /> How a strong answer would look
              </span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", showBetter && "rotate-180")} />
            </button>
            {showBetter && <p className="border-t border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">{e.better_answer}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Summary({ state, onRestart, onExit }: { state: InterviewState; onRestart: () => void; onExit: () => void }) {
  const score = state.overall_score ?? 0;
  const radius = 54;
  const c = 2 * Math.PI * radius;
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-5 text-white">
          <div className="flex items-center gap-2 text-sm font-medium text-white/85">
            <Trophy className="h-4 w-4" /> Interview complete
          </div>
          <h2 className="mt-1 text-2xl font-semibold">{state.summary?.headline ?? "Here's how you did."}</h2>
        </div>
        <CardContent className="flex flex-col items-center gap-6 pt-6 sm:flex-row">
          <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
            <svg viewBox="0 0 120 120" className="h-36 w-36 -rotate-90">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth="10" />
              <circle cx="60" cy="60" r={radius} fill="none" stroke="currentColor" className={scoreColor(score / 10)} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
            </svg>
            <div className="absolute text-center">
              <div className="text-3xl font-bold tabular-nums">{score}</div>
              <div className="text-xs text-muted-foreground">/ 100</div>
            </div>
          </div>
          <div className="grid w-full gap-4 sm:grid-cols-3">
            {[
              { title: "Strengths", items: state.summary?.strengths ?? [], icon: ThumbsUp, tone: "text-emerald-600 dark:text-emerald-400" },
              { title: "Focus areas", items: state.summary?.focus_areas ?? [], icon: Target, tone: "text-amber-600 dark:text-amber-400" },
              { title: "Next steps", items: state.summary?.next_steps ?? [], icon: TrendingUp, tone: "text-violet-600 dark:text-violet-400" },
            ].map(({ title, items, icon: Icon, tone }) => (
              <div key={title}>
                <div className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", tone)}>
                  <Icon className="h-3.5 w-3.5" /> {title}
                </div>
                {items.length ? (
                  <ul className="space-y-1.5 text-sm">
                    {items.map((s, i) => (
                      <li key={i}>• {s}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-5">
          <div className="mb-2 text-sm font-semibold">Question by question</div>
          {state.questions.map((q) => (
            <div key={q.index} className="rounded-lg border border-border">
              <button type="button" onClick={() => setOpen(open === q.index ? null : q.index)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white", scoreBg(q.evaluation?.score ?? 0))}>
                  {q.evaluation?.score ?? 0}
                </span>
                <span className="flex-1 text-sm">{q.question}</span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open === q.index && "rotate-180")} />
              </button>
              {open === q.index && (
                <div className="space-y-3 border-t border-border px-4 py-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your answer</div>
                    <p className="whitespace-pre-wrap text-sm">{q.skipped ? "(skipped)" : q.answer}</p>
                  </div>
                  <FeedbackCard q={q} />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={onExit}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Resume Optimizer
        </Button>
        <Button onClick={onRestart} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500">
          <RotateCcw className="mr-2 h-4 w-4" /> Practice again
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- session

export function InterviewSession({
  state,
  onAnswer,
  onRestart,
  onExit,
}: {
  state: InterviewState;
  onAnswer: (index: number, answer: string, skip: boolean) => Promise<InterviewState>;
  onRestart: () => void;
  onExit: () => void;
}) {
  const [view, setView] = useState(() => Math.min(state.current_index, Math.max(0, state.total - 1)));
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<"submit" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dictation = useDictation((t) => setAnswer((a) => (a ? `${a} ${t}` : t)));

  const finished = state.status === "completed";
  const q = state.questions.find((x) => x.index === view);
  const answered = !!q?.evaluation;

  async function submit(skip: boolean) {
    if (!q || busy) return;
    dictation.stop();
    setBusy(skip ? "skip" : "submit");
    setError(null);
    try {
      await onAnswer(q.index, skip ? "" : answer.trim(), skip);
      setAnswer("");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't submit your answer. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
      <button type="button" onClick={onExit} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Resume Optimizer
      </button>

      <div>
        <p className="text-sm font-medium text-primary">AI mock interview</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {state.job_title ? `${state.job_title} interview` : state.candidate_name ? `${state.candidate_name}'s interview` : "Your interview"}
        </h1>
        <p className="mt-1 text-sm capitalize text-muted-foreground">
          {state.settings.count} questions · {state.settings.type} · {state.settings.level} level
        </p>
      </div>

      {state.status === "failed" ? (
        <Card>
          <CardContent className="space-y-4 pt-6 text-center">
            <p className="text-sm text-destructive">{state.error_message || "This interview couldn't be started."}</p>
            <Button onClick={onRestart}>
              <RotateCcw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </CardContent>
        </Card>
      ) : finished && view >= state.total ? (
        <Summary state={state} onRestart={onRestart} onExit={onExit} />
      ) : (
        <>
          {/* Progress */}
          <div>
            <div className="mb-2 flex justify-between text-xs font-medium text-muted-foreground">
              <span>
                Question {Math.min(view + 1, state.total)} of {state.total}
              </span>
              <span>{Math.round((state.current_index / Math.max(1, state.total)) * 100)}% done</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: state.total }).map((_, i) => {
                const ev = state.questions.find((x) => x.index === i)?.evaluation;
                return <div key={i} className={cn("h-1.5 flex-1 rounded-full", ev ? scoreBg(ev.score) : i === view ? "bg-primary/60" : "bg-secondary")} />;
              })}
            </div>
          </div>

          {q && (
            <Card className="overflow-hidden">
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", (KIND_LABEL[q.kind] ?? KIND_LABEL.technical).tone)}>
                    {(KIND_LABEL[q.kind] ?? { label: q.kind }).label}
                  </span>
                  <span className="text-xs text-muted-foreground">{q.topic}</span>
                </div>
                <h2 className="text-lg font-semibold leading-snug sm:text-xl">{q.question}</h2>

                {!answered ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <textarea
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Type your answer, or press the mic and speak…"
                        maxLength={5000}
                        disabled={busy !== null}
                        className={cn(
                          "min-h-[160px] w-full resize-y rounded-lg border bg-background px-4 py-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          dictation.listening ? "border-rose-400 ring-2 ring-rose-400/30" : "border-input"
                        )}
                      />
                      {dictation.interim && <p className="mt-1 text-sm italic text-muted-foreground">{dictation.interim}…</p>}
                    </div>
                    {dictation.micError && <p className="text-xs text-destructive">{dictation.micError}</p>}
                    {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {dictation.supported ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={dictation.toggle}
                            disabled={busy !== null}
                            className={cn(dictation.listening && "border-rose-400 text-rose-600 hover:text-rose-700")}
                          >
                            {dictation.listening ? (
                              <>
                                <span className="relative mr-2 flex h-2.5 w-2.5">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                                </span>
                                Stop
                              </>
                            ) : (
                              <>
                                <Mic className="mr-2 h-4 w-4" /> Speak
                              </>
                            )}
                          </Button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <MicOff className="h-3.5 w-3.5" /> Voice works in Chrome or Edge
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground tabular-nums">{answer.length}/5000</span>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="ghost" onClick={() => submit(true)} disabled={busy !== null}>
                          {busy === "skip" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SkipForward className="mr-2 h-4 w-4" />}
                          Skip
                        </Button>
                        <Button type="button" onClick={() => submit(false)} disabled={busy !== null || answer.trim().length < 5}>
                          {busy === "submit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                          {busy === "submit" ? "Evaluating…" : "Submit answer"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-secondary/60 px-4 py-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your answer</div>
                    <p className="whitespace-pre-wrap text-sm">{q.skipped ? "(skipped)" : q.answer}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {answered && q && (
            <>
              <FeedbackCard q={q} />
              <div className="flex justify-end">
                <Button onClick={() => setView((v) => v + 1)} className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500">
                  {view + 1 >= state.total ? (
                    <>
                      <Trophy className="mr-2 h-4 w-4" /> See my results
                    </>
                  ) : (
                    <>
                      Next question <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
