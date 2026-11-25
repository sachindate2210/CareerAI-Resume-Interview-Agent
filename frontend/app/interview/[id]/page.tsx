"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { InterviewSocket } from "@/lib/ws";
import { api, ApiError } from "@/lib/api";
import type { InterviewQuestion, InterviewRead, WsServerMessage } from "@/types/api";

type WsStatus = "connecting" | "open" | "closed" | "error";

function statusVariant(status: WsStatus): "success" | "secondary" | "destructive" {
  if (status === "open") return "success";
  if (status === "error") return "destructive";
  return "secondary";
}

export default function InterviewSessionPage() {
  const params = useParams<{ id: string }>();
  const interviewId = params.id;
  const router = useRouter();

  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);

  const [question, setQuestion] = useState<InterviewQuestion | null>(null);
  const [questionIndex, setQuestionIndex] = useState<number | null>(null);
  const [totalQuestions, setTotalQuestions] = useState<number | null>(null);

  const [answer, setAnswer] = useState("");
  const [awaitingResponse, setAwaitingResponse] = useState(false);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [wsError, setWsError] = useState<string | null>(null);

  const socketRef = useRef<InterviewSocket | null>(null);

  // Initial REST fetch for interview state (resume mid-interview, get total counts).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setInitialLoading(true);
      setInitialError(null);
      try {
        const interview = await api.get<InterviewRead>(`/api/interviews/${interviewId}`);
        if (cancelled) return;
        setTotalQuestions(interview.num_questions);
        if (interview.current_question) {
          setQuestion(interview.current_question);
          setQuestionIndex(interview.current_question.index);
        }
      } catch (err) {
        if (!cancelled) {
          setInitialError(
            err instanceof ApiError ? err.detail : "Failed to load interview."
          );
        }
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  // WebSocket connection.
  useEffect(() => {
    const socket = new InterviewSocket(interviewId);
    socketRef.current = socket;

    const unsubMessage = socket.onMessage((msg: WsServerMessage) => {
      switch (msg.type) {
        case "question":
          setQuestion(msg.question);
          setQuestionIndex(msg.index);
          setTotalQuestions(msg.total);
          setAnswer("");
          setAwaitingResponse(false);
          setWsError(null);
          break;
        case "evaluating":
          setAwaitingResponse(true);
          break;
        case "evaluation":
          // Partial mid-interview feedback; keep waiting for the next question
          // or the final "complete" message.
          break;
        case "complete":
          try {
            sessionStorage.setItem(
              `interview_eval_${interviewId}`,
              JSON.stringify(msg.evaluation)
            );
          } catch {
            // sessionStorage unavailable — /results will fetch independently.
          }
          router.push(`/results?interview=${interviewId}`);
          break;
        case "error":
          setWsError(msg.detail);
          setAwaitingResponse(false);
          break;
      }
    });

    const unsubStatus = socket.onStatus((status) => {
      setWsStatus(status);
    });

    socket.connect();

    return () => {
      unsubMessage();
      unsubStatus();
      socket.close();
    };
  }, [interviewId, router]);

  const handleSubmitAnswer = useCallback(() => {
    if (!answer.trim() || awaitingResponse) return;
    socketRef.current?.send({ type: "answer", text: answer });
    setAwaitingResponse(true);
  }, [answer, awaitingResponse]);

  if (initialLoading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-lg bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (initialError) {
    return (
      <AppShell>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive">{initialError}</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const progressPct =
    totalQuestions && questionIndex !== null
      ? ((questionIndex + 1) / totalQuestions) * 100
      : 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Interview in Progress</h1>
            {questionIndex !== null && totalQuestions !== null && (
              <p className="text-sm text-muted-foreground">
                Question {questionIndex + 1} / {totalQuestions}
              </p>
            )}
          </div>
          <Badge variant={statusVariant(wsStatus)} className="capitalize">
            {wsStatus}
          </Badge>
        </div>

        {totalQuestions !== null && questionIndex !== null && (
          <Progress value={progressPct} />
        )}

        {wsError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {wsError}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {question ? question.question : "Waiting for question…"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {awaitingResponse ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                Analyzing answer…
              </div>
            ) : (
              <>
                <Textarea
                  placeholder="Type your answer here…"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  disabled={!question || awaitingResponse}
                  rows={8}
                />
                <Button
                  onClick={handleSubmitAnswer}
                  disabled={!answer.trim() || awaitingResponse || !question}
                >
                  Submit Answer
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
