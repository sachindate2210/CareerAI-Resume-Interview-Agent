import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo, ThemeToggle } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top nav */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <BrandLogo />
          <nav className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/resume-optimizer"
              className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:inline"
            >
              Free Resume Optimizer
            </Link>
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Log in
            </Link>
            <Button asChild size="sm">
              <Link href="/register">Sign up</Link>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-32">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Turn your resume into your career advantage.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Upload your resume and instantly see what&apos;s wrong with it, what to
          add, and how well it will get through ATS filters.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button asChild size="lg">
            <Link href="/resume-optimizer">Analyze my resume, free</Link>
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">No signup required.</p>
      </section>

      {/* Features */}
      <section className="mx-auto flex max-w-6xl flex-col gap-24 px-6 pb-24">
        {/* Resume Analysis */}
        <FeatureRow
          eyebrow="Resume Analysis"
          title="Know exactly where your resume stands"
          description="Get an instant, objective score across content, structure and quality, with clear strengths and weaknesses called out line by line — no guesswork before you send it off."
          visual={<ResumeAnalysisMock />}
        />

        {/* ATS Optimization */}
        <FeatureRow
          reverse
          eyebrow="ATS Optimization"
          title="Get past the filters, not just the recruiter"
          description="See exactly which keywords applicant tracking systems expect for a role, which ones your resume already covers, and which ones are quietly costing you interviews."
          visual={<AtsOptimizationMock />}
        />
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} CareerAI. All rights reserved.</span>
          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
            <Link href="/register" className="hover:text-foreground">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureRow({
  eyebrow,
  title,
  description,
  visual,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  visual: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={`grid items-center gap-10 sm:grid-cols-2 sm:gap-16 ${
        reverse ? "sm:[&>*:first-child]:order-2" : ""
      }`}
    >
      <div>
        <p className="text-sm font-medium text-primary">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex justify-center">{visual}</div>
    </div>
  );
}

/* ---------------- Mock visuals (pure divs, no images/libraries) ---------------- */

function ResumeAnalysisMock() {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div
          className="relative flex h-20 w-20 items-center justify-center rounded-full"
          style={{
            background:
              "conic-gradient(hsl(var(--primary)) 0% 82%, hsl(var(--muted)) 82% 100%)",
          }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-sm font-semibold">
            82
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Overall Score</p>
          <p className="text-xs text-muted-foreground">Strong, needs polish</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <span className="chip border-success/30 bg-success/10 text-success">
          Clear structure
        </span>
        <span className="chip border-success/30 bg-success/10 text-success">
          Quantified impact
        </span>
        <span className="chip border-warning/30 bg-warning/10 text-warning">
          Summary too long
        </span>
      </div>
    </div>
  );
}

function AtsOptimizationMock() {
  const rows = [
    { keyword: "Python", matched: true },
    { keyword: "REST APIs", matched: true },
    { keyword: "Kubernetes", matched: false },
    { keyword: "CI/CD", matched: true },
  ];
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
      <p className="text-sm font-medium">Keyword match</p>
      <div className="mt-4 space-y-2.5">
        {rows.map((row) => (
          <div key={row.keyword} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{row.keyword}</span>
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                row.matched
                  ? "bg-success/15 text-success"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {row.matched ? "✓" : "✕"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-3/4 rounded-full bg-primary" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">75% keyword coverage</p>
    </div>
  );
}



