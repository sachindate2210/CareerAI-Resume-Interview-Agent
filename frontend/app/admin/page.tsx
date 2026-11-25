"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  CalendarClock,
  ChevronRight,
  Clock,
  Coins,
  ExternalLink,
  FileText,
  Palette,
  PieChart as PieIcon,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UploadCloud,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge, scoreTone } from "@/components/resume-view";
import { api, ApiError } from "@/lib/api";
import { formatDateWith, useAppSettings } from "@/lib/app-settings";
import { can, isSuperAdmin } from "@/lib/permissions";
import { useAuthStore } from "@/lib/store";
import { cn, formatDate } from "@/lib/utils";
import type { AdminStats } from "@/types/optimizer";

type DayCount = { date: string; count: number };
type Stats = AdminStats & {
  pending: number;
  active_users: number;
  new_users_7_days: number;
  roles: number;
  guest_runs: number;
  guest_runs_7_days: number;
  interviews: number;
  interviews_7_days: number;
  users_per_day: DayCount[];
  guest_per_day: DayCount[];
  analyzed_per_day: DayCount[];
  prev_7_days: number;
  prev_new_users_7_days: number;
  prev_guest_runs_7_days: number;
  ai: {
    calls_7_days: number;
    success_rate: number | null;
    avg_latency_ms: number | null;
    tokens_7_days: number;
    failed_7_days: number;
    calls_per_day: { date: string; success: number; failed: number }[];
    top_operations: { operation: string; count: number }[];
  } | null;
};

const axis = { fontSize: 12, fill: "hsl(var(--muted-foreground))" };
const tooltipStyle = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    color: "hsl(var(--foreground))",
    fontSize: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,.08)",
  },
  labelStyle: { color: "hsl(var(--muted-foreground))" },
};

const SCORE_COLORS = ["#f43f5e", "#f59e0b", "#3b82f6", "#10b981"];
const STATUS_COLORS = { parsed: "#10b981", failed: "#f43f5e", pending: "#f59e0b" };
const OPERATION_LABELS: Record<string, string> = {
  resume_parse: "Resume parsing",
  resume_analyze: "Resume analysis",
};

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** This week vs the 7 days before, as a small up/down pill. */
function Delta({ current, previous }: { current: number; previous: number }) {
  if (current === 0 && previous === 0) return <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-medium">No change</span>;
  const up = current >= previous;
  const pct = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">
      <Icon className="h-3 w-3" />
      {pct === null ? `+${current}` : `${up ? "+" : ""}${pct}%`}
      <span className="font-normal opacity-80">&nbsp;vs last week</span>
    </span>
  );
}

function Sparkline({ data, id }: { data: DayCount[]; id: string }) {
  return (
    <div className="pointer-events-none h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="count" stroke="#fff" strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  gradient,
  href,
  trend,
  delta,
  id,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: typeof Users;
  gradient: string;
  href?: string;
  trend: DayCount[];
  delta?: { current: number; previous: number };
  id: string;
}) {
  const body = (
    <div className={cn("group relative h-full overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg", gradient)}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white/85">{label}</div>
          <div className="mt-1 text-4xl font-bold tracking-tight tabular-nums">{value}</div>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/25 backdrop-blur">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="relative mt-2 flex flex-wrap items-center gap-2 text-xs text-white/80">
        {delta && <Delta current={delta.current} previous={delta.previous} />}
        <span className="truncate">{hint}</span>
      </div>
      <div className="relative -mx-5 -mb-5 mt-3">
        <Sparkline data={trend} id={id} />
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

function Panel({
  title,
  icon: Icon,
  iconTone,
  action,
  children,
  className,
}: {
  title: string;
  icon: typeof Users;
  iconTone: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-base font-semibold">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", iconTone)}>
            <Icon className="h-4 w-4" />
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function MiniKpi({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: React.ReactNode; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border p-3">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-lg font-semibold leading-tight tabular-nums">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const settings = useAppSettings((s) => s.settings);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Stats>("/api/admin/stats")
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.detail : "Failed to load stats."));
  }, []);

  const greeting = useMemo(() => {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: settings.timezone }).format(new Date()));
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  }, [settings.timezone]);
  const firstName = (user?.full_name || user?.email || "").split(/[\s@]/)[0];
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: settings.timezone }).format(new Date());

  const statusData = stats
    ? [
        { name: "Parsed", value: stats.parsed, color: STATUS_COLORS.parsed },
        { name: "Failed", value: stats.failed, color: STATUS_COLORS.failed },
        { name: "Pending", value: stats.pending, color: STATUS_COLORS.pending },
      ]
    : [];
  const statusTotal = statusData.reduce((a, b) => a + b.value, 0);
  const sum7 = (series: DayCount[]) => series.slice(-7).reduce((a, b) => a + b.count, 0);

  const actions = [
    { show: can(user, "resumes", "view"), href: "/admin/resumes", label: "Review resumes", icon: FileText, tone: "text-blue-600 bg-blue-500/10 dark:text-blue-300" },
    { show: can(user, "users", "create"), href: "/admin/users", label: "Add a user", icon: UserPlus, tone: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-300" },
    { show: isSuperAdmin(user), href: "/admin/roles", label: "Manage roles", icon: ShieldCheck, tone: "text-violet-600 bg-violet-500/10 dark:text-violet-300" },
    { show: isSuperAdmin(user), href: "/admin/settings", label: "Theme configuration", icon: Palette, tone: "text-amber-600 bg-amber-500/10 dark:text-amber-300" },
    { show: true, href: "/resume-optimizer", label: "Open free optimizer", icon: ExternalLink, tone: "text-rose-600 bg-rose-500/10 dark:text-rose-300", external: true },
  ].filter((a) => a.show);

  return (
    <AppShell require={{ module: "dashboard", action: "view" }}>
      <div className="space-y-6">
        {/* Welcome */}
        <section className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-violet-50 p-6 shadow-sm dark:border-indigo-500/20 dark:from-indigo-500/10 dark:via-card dark:to-violet-500/10">
          <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-violet-300/30 blur-3xl dark:bg-violet-500/20" />
          <div className="pointer-events-none absolute right-40 top-6 h-24 w-24 rounded-full bg-sky-300/30 blur-2xl dark:bg-sky-500/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {greeting}, {firstName || "there"} <span className="inline-block origin-bottom-right animate-[wave_2s_ease-in-out_1]">👋</span>
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {weekday}, {formatDateWith(new Date(), settings)} · Here&apos;s what&apos;s happening with {settings.app_name}.
              </p>
            </div>
            {stats && (
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm ring-1 ring-indigo-100 dark:bg-white/5 dark:text-indigo-300 dark:ring-indigo-500/20">
                  <TrendingUp className="h-3.5 w-3.5" /> {stats.last_7_days} uploads this week
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-emerald-700 shadow-sm ring-1 ring-emerald-100 dark:bg-white/5 dark:text-emerald-300 dark:ring-emerald-500/20">
                  <UserPlus className="h-3.5 w-3.5" /> {stats.new_users_7_days} new users
                </span>
              </div>
            )}
          </div>
        </section>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Main KPIs */}
        {!stats && !error ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[168px] animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              id="sp-resumes"
              label="Total Resumes"
              value={stats.total_resumes}
              hint={`${stats.last_7_days} this week`}
              icon={FileText}
              gradient="from-blue-600 to-sky-500"
              href="/admin/resumes"
              trend={stats.uploads_per_day}
              delta={{ current: stats.last_7_days, previous: stats.prev_7_days }}
            />
            <StatCard
              id="sp-users"
              label="Users"
              value={stats.total_users}
              hint={`${stats.active_users} active`}
              icon={Users}
              gradient="from-indigo-500 to-violet-500"
              href="/admin/users"
              trend={stats.users_per_day}
              delta={{ current: stats.new_users_7_days, previous: stats.prev_new_users_7_days }}
            />
            <StatCard
              id="sp-analyzed"
              label="Analyzed"
              value={stats.analyzed}
              hint={stats.average_score != null ? `Avg score ${stats.average_score}` : "No scores yet"}
              icon={Sparkles}
              gradient="from-emerald-600 to-teal-500"
              trend={stats.analyzed_per_day}
              delta={{ current: sum7(stats.analyzed_per_day), previous: stats.analyzed_per_day.slice(0, 7).reduce((a, b) => a + b.count, 0) }}
            />
            <StatCard
              id="sp-guest"
              label="Free Optimizer Runs"
              value={stats.guest_runs}
              hint={`${stats.interviews} mock interviews`}
              icon={Zap}
              gradient="from-fuchsia-600 to-pink-500"
              trend={stats.guest_per_day}
              delta={{ current: stats.guest_runs_7_days, previous: stats.prev_guest_runs_7_days }}
            />
          </div>
        ) : null}

        {stats && (
          <>
            {/* Activity */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Panel title="Uploads — last 14 days" icon={UploadCloud} iconTone="bg-blue-500/10 text-blue-600 dark:text-blue-300" className="lg:col-span-2">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.uploads_per_day.map((d) => ({ ...d, label: d.date.slice(5) }))} margin={{ left: -16, right: 8 }}>
                      <defs>
                        <linearGradient id="uploadsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                      <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                      <Tooltip {...tooltipStyle} />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Uploads"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.5}
                        fill="url(#uploadsFill)"
                        dot={{ r: 3, strokeWidth: 2, fill: "hsl(var(--card))" }}
                        activeDot={{ r: 5 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel title="Resume status" icon={PieIcon} iconTone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                <div className="relative h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusTotal ? statusData : [{ name: "None", value: 1, color: "hsl(var(--muted))" }]}
                        dataKey="value"
                        innerRadius={58}
                        outerRadius={80}
                        paddingAngle={statusTotal ? 3 : 0}
                        stroke="none"
                      >
                        {(statusTotal ? statusData : [{ color: "hsl(var(--muted))" }]).map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      {statusTotal > 0 && <Tooltip {...tooltipStyle} />}
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold tabular-nums">{statusTotal}</span>
                    <span className="text-xs text-muted-foreground">resumes</span>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {statusData.map((d) => (
                    <div key={d.name} className="rounded-lg bg-secondary/60 px-2 py-2">
                      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} /> {d.name}
                      </div>
                      <div className="mt-0.5 text-base font-semibold tabular-nums">{d.value}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* AI usage + quick actions */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Panel
                title="AI usage — last 7 days"
                icon={Bot}
                iconTone="bg-violet-500/10 text-violet-600 dark:text-violet-300"
                className="lg:col-span-2"
                action={
                  isSuperAdmin(user) ? (
                    <Link href="/admin/settings" className="text-sm font-medium text-primary hover:underline">
                      AI settings
                    </Link>
                  ) : undefined
                }
              >
                {stats.ai ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      <MiniKpi icon={Zap} label="AI calls" value={stats.ai.calls_7_days} tone="bg-violet-500/10 text-violet-600 dark:text-violet-300" />
                      <MiniKpi
                        icon={ShieldCheck}
                        label={`Success rate${stats.ai.failed_7_days ? ` · ${stats.ai.failed_7_days} failed` : ""}`}
                        value={stats.ai.success_rate != null ? `${stats.ai.success_rate}%` : "—"}
                        tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                      />
                      <MiniKpi
                        icon={Clock}
                        label="Avg response time"
                        value={stats.ai.avg_latency_ms != null ? `${(stats.ai.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
                        tone="bg-sky-500/10 text-sky-600 dark:text-sky-300"
                      />
                      <MiniKpi icon={Coins} label="Tokens used" value={compact(stats.ai.tokens_7_days)} tone="bg-amber-500/10 text-amber-600 dark:text-amber-300" />
                    </div>
                    <div className="mt-5 grid gap-5 md:grid-cols-[1fr_220px]">
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={stats.ai.calls_per_day.map((d) => ({ ...d, label: d.date.slice(5) }))} margin={{ left: -20, right: 4 }}>
                            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={1} />
                            <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                            <Tooltip {...tooltipStyle} cursor={{ fill: "hsl(var(--accent))" }} />
                            <Bar dataKey="success" name="Successful" stackId="a" fill="#8b5cf6" radius={[0, 0, 0, 0]} maxBarSize={28} />
                            <Bar dataKey="failed" name="Failed" stackId="a" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={28} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Top operations</div>
                        {stats.ai.top_operations.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No AI calls yet.</p>
                        ) : (
                          <ul className="space-y-3">
                            {stats.ai.top_operations.map((op) => {
                              const pct = Math.round((op.count / Math.max(1, stats.ai!.calls_7_days)) * 100);
                              return (
                                <li key={op.operation}>
                                  <div className="mb-1 flex justify-between text-sm">
                                    <span className="truncate">{OPERATION_LABELS[op.operation] ?? op.operation.replace(/_/g, " ")}</span>
                                    <span className="font-medium tabular-nums">{op.count}</span>
                                  </div>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                                    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${pct}%` }} />
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">No AI usage recorded yet.</p>
                )}
              </Panel>

              <Panel title="Quick actions" icon={Zap} iconTone="bg-amber-500/10 text-amber-600 dark:text-amber-300">
                <div className="space-y-2">
                  {actions.map(({ href, label, icon: Icon, tone, external }) => (
                    <Link
                      key={href}
                      href={href}
                      target={external ? "_blank" : undefined}
                      className="group flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/50"
                    >
                      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", tone)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 text-sm font-medium">{label}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>

            {/* Recent + score distribution */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Panel
                title="Recent resumes"
                icon={CalendarClock}
                iconTone="bg-sky-500/10 text-sky-600 dark:text-sky-300"
                className="lg:col-span-2"
                action={
                  <Link href="/admin/resumes" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                    View all <ArrowRight className="h-4 w-4" />
                  </Link>
                }
              >
                {stats.recent.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No resumes yet.</p>
                ) : (
                  <ul className="-mx-2 divide-y divide-border">
                    {stats.recent.map((r) => (
                      <li key={r.id}>
                        <Link href={`/admin/resumes/${r.id}`} className="flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-accent/50">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-semibold text-white">
                            {(r.owner.full_name || r.owner.email).slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{r.filename}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {r.owner.full_name || r.owner.email} · {formatDate(r.created_at)}
                            </div>
                          </div>
                          <StatusBadge status={r.status} />
                          <div className={cn("w-12 text-right text-sm font-semibold tabular-nums", scoreTone(r.score))}>{r.score ?? "—"}</div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Score distribution" icon={BarChart3} iconTone="bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300">
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.score_distribution} margin={{ left: -20, right: 4 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
                      <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                      <Tooltip {...tooltipStyle} cursor={{ fill: "hsl(var(--accent))" }} />
                      <Bar dataKey="count" name="Resumes" radius={[8, 8, 0, 0]} maxBarSize={44}>
                        {stats.score_distribution.map((_, i) => (
                          <Cell key={i} fill={SCORE_COLORS[i % SCORE_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {stats.analyzed === 0 && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">Scores appear once users run the optimizer.</p>
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
