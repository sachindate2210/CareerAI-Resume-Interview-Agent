"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Layers,
  Check,
  ChevronDown,
  RefreshCw,
  Search,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  Image as ImageIcon,
  Moon,
  Palette,
  Sun,
  Monitor,
  Trash2,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { type Branding, type GeneralSettings, assetUrl, formatDateWith, formatTimeWith, useAppSettings } from "@/lib/app-settings";
import { cn } from "@/lib/utils";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

type Provider = { key: string; label: string; models: string[]; default_model: string; default_model_fast: string };
type Options = { providers: Provider[]; date_formats: string[]; timezones: string[] };
type KeyInfo = { configured: boolean; hint: string | null; source: "database" | "env" | "none"; decrypt_failed: boolean };
type AIView = {
  provider: string;
  model: string;
  model_fast: string;
  temperature: number | null;
  timeout_seconds: number;
  max_output_tokens: number | null;
  keys: Record<string, KeyInfo>;
};
type AIForm = Omit<AIView, "keys" | "temperature" | "max_output_tokens" | "model_fast"> & {
  temperature: string;
  max_output_tokens: string;
};
type ModelCatalog = { provider: string; models: string[]; live: boolean; message?: string | null };
type TestResult = { ok: boolean; message: string; latency_ms: number; model: string };
type Notice = { kind: "success" | "error"; text: string } | null;

// Static class names per tone so Tailwind keeps them.
type Tone = "blue" | "violet" | "emerald" | "amber" | "cyan" | "indigo";
const TONES: Record<Tone, { tile: string; bar: string; active: string }> = {
  blue: { tile: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300", bar: "border-t-blue-500", active: "bg-blue-600 text-white" },
  violet: { tile: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300", bar: "border-t-violet-500", active: "bg-violet-600 text-white" },
  emerald: { tile: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300", bar: "border-t-emerald-500", active: "bg-emerald-600 text-white" },
  amber: { tile: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300", bar: "border-t-amber-500", active: "bg-amber-500 text-white" },
  cyan: { tile: "bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300", bar: "border-t-cyan-500", active: "bg-cyan-600 text-white" },
  indigo: { tile: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300", bar: "border-t-indigo-500", active: "bg-indigo-600 text-white" },
};

const PROVIDER_STYLE: Record<string, { initials: string; tile: string }> = {
  anthropic: { initials: "Cl", tile: "bg-gradient-to-br from-orange-400 to-amber-600" },
  groq: { initials: "Gq", tile: "bg-gradient-to-br from-rose-500 to-fuchsia-600" },
  openai: { initials: "AI", tile: "bg-gradient-to-br from-emerald-500 to-teal-700" },
  openrouter: { initials: "OR", tile: "bg-gradient-to-br from-indigo-500 to-blue-700" },
  gemini: { initials: "Ge", tile: "bg-gradient-to-br from-sky-400 to-violet-600" },
};
const providerStyle = (key: string) => PROVIDER_STYLE[key] ?? PROVIDER_STYLE.anthropic;

const saveBtn = "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm hover:from-indigo-500 hover:to-violet-500";

function apiError(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.detail : fallback;
}

// ---------------- Shared UI ----------------

/** Settings row: title + description on the left, fields in a card on the right. */
/** A settings group: icon + title on top, fields in a full-width card below. */
function Section({ title, icon: Icon, tone, children }: { title: string; icon: typeof Cpu; tone: Tone; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <section className="space-y-3 border-b border-border py-6 first:pt-2 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", t.tile)}>
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className={cn("rounded-xl border border-t-4 border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6", t.bar)}>
        {children}
      </div>
    </section>
  );
}

/** Heading for a block inside a Section card. */
function SubHeading({ title, icon: Icon, tone }: { title: string; icon: typeof Cpu; tone: Tone }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", TONES[tone].tile)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Segmented control for small fixed choices. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  tone = "blue",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  tone?: Tone;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-md border border-input bg-secondary/60 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value ? cn(TONES[tone].active, "shadow-sm") : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-emerald-500" : "bg-input"
      )}
    >
      <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

/** Sticky, right-aligned action buttons for each tab, always reachable without scrolling. */
function ActionBar({ notice, children }: { notice: Notice; children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 bg-background/90 px-4 pb-2 pt-4 backdrop-blur lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap justify-end gap-2">{children}</div>
      {notice && (
        <div
          role={notice.kind === "success" ? "status" : "alert"}
          className={cn(
            "mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            notice.kind === "success"
              ? "border-success/30 bg-success/5 text-success"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          )}
        >
          {notice.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}
    </div>
  );
}

// ---------------- General ----------------

function GeneralTab({ options }: { options: Options | null }) {
  const setGlobal = useAppSettings((s) => s.setSettings);
  const [form, setForm] = useState<GeneralSettings | null>(null);
  const [saved, setSaved] = useState<GeneralSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    api
      .get<GeneralSettings>("/api/admin/settings/general")
      .then((g) => {
        setForm(g);
        setSaved(g);
      })
      .catch((err) => setNotice({ kind: "error", text: apiError(err, "Failed to load settings.") }));
  }, []);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  if (!form) return <div className="mt-6 h-96 animate-pulse rounded-lg bg-muted" />;
  const set = <K extends keyof GeneralSettings>(k: K, v: GeneralSettings[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setNotice(null);
  };

  async function save() {
    if (!form) return;
    setNotice(null);
    if (!form.app_name.trim()) return setNotice({ kind: "error", text: "Application name is required." });
    setSaving(true);
    try {
      const res = await api.put<GeneralSettings>("/api/admin/settings/general", {
        ...form,
        support_email: form.support_email?.trim() || null,
      });
      setForm(res);
      setSaved(res);
      setGlobal(res); // apply across the app immediately
      setNotice({ kind: "success", text: "Settings saved and applied across the application." });
    } catch (err) {
      setNotice({ kind: "error", text: apiError(err, "Could not save settings.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      <ActionBar notice={notice}>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            setForm(saved);
            setNotice(null);
          }}
        >
          Discard
        </Button>
        <Button type="submit" className={saveBtn} disabled={!dirty || saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save changes
        </Button>
      </ActionBar>

      <div className="pt-6">
        <Section icon={Building2} tone="blue" title="Application">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Application name" htmlFor="g-name">
              <Input id="g-name" value={form.app_name} maxLength={60} onChange={(e) => set("app_name", e.target.value)} />
            </Field>
            <Field label="Support email" htmlFor="g-email" hint="Optional.">
              <Input
                id="g-email"
                type="email"
                value={form.support_email ?? ""}
                placeholder="support@company.com"
                onChange={(e) => set("support_email", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section
          icon={CalendarClock}
          tone="violet"
          title="Date & time"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Timezone" htmlFor="g-tz">
              <select id="g-tz" className={selectClass} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {(options?.timezones ?? [form.timezone]).map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date format" htmlFor="g-date">
              <select
                id="g-date"
                className={selectClass}
                value={form.date_format}
                onChange={(e) => set("date_format", e.target.value as GeneralSettings["date_format"])}
              >
                {(options?.date_formats ?? [form.date_format]).map((f) => (
                  <option key={f} value={f}>
                    {formatDateWith(now, { ...form, date_format: f as GeneralSettings["date_format"] })} ({f})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Time format">
              <Segmented
                label="Time format"
                tone="violet"
                value={form.time_format}
                onChange={(v) => set("time_format", v)}
                options={[
                  { value: "12h", label: "12-hour" },
                  { value: "24h", label: "24-hour" },
                ]}
              />
            </Field>
            <Field label="First day of week">
              <Segmented
                label="First day of week"
                tone="violet"
                value={form.week_start}
                onChange={(v) => set("week_start", v)}
                options={[
                  { value: "monday", label: "Monday" },
                  { value: "sunday", label: "Sunday" },
                ]}
              />
            </Field>
          </div>
          <div className="mt-5 flex items-center justify-between rounded-lg bg-violet-50 px-4 py-3 text-sm ring-1 ring-violet-100">
            <span className="flex items-center gap-2 text-violet-700">
              <CalendarClock className="h-4 w-4" /> Preview
            </span>
            <span className="rounded-md bg-card px-2.5 py-1 font-semibold tabular-nums text-violet-900 shadow-sm dark:text-violet-200">
              {formatDateWith(now, form)}, {formatTimeWith(now, form)}
            </span>
          </div>
        </Section>

        <Section icon={SlidersHorizontal} tone="emerald" title="Defaults & limits">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Rows per page" hint="Default page size for admin tables.">
              <Segmented
                label="Rows per page"
                tone="emerald"
                value={form.default_page_size}
                onChange={(v) => set("default_page_size", v)}
                options={[10, 20, 50, 100].map((n) => ({ value: n as GeneralSettings["default_page_size"], label: String(n) }))}
              />
            </Field>
            <Field label="Maximum upload size" htmlFor="g-upload" hint="1–25 MB per resume file.">
              <div className="relative">
                <Input
                  id="g-upload"
                  type="number"
                  min={1}
                  max={25}
                  className="pr-12"
                  value={form.max_upload_mb}
                  onChange={(e) => set("max_upload_mb", Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">MB</span>
              </div>
            </Field>
          </div>
        </Section>

        <Section icon={Globe2} tone="amber" title="Public access">
          <div
            className={cn(
              "flex items-start justify-between gap-6 rounded-lg p-4 ring-1 transition-colors",
              form.public_optimizer_enabled ? "bg-emerald-50 ring-emerald-100 dark:bg-emerald-500/10 dark:ring-emerald-500/20" : "bg-secondary/60 ring-border"
            )}
          >
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  form.public_optimizer_enabled ? "bg-emerald-500 text-white" : "bg-muted-foreground/20 text-muted-foreground"
                )}
              >
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <label htmlFor="g-public" className="text-sm font-medium">
                  Free Resume Optimizer
                  <span
                    className={cn(
                      "ml-2 rounded-full px-2 py-0.5 text-xs font-medium",
                      form.public_optimizer_enabled ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {form.public_optimizer_enabled ? "Live" : "Off"}
                  </span>
                </label>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Allow anyone to analyze a resume at <span className="font-mono text-xs">/resume-optimizer</span> without an account.
                </p>
              </div>
            </div>
            <Switch id="g-public" checked={form.public_optimizer_enabled} onChange={(v) => set("public_optimizer_enabled", v)} />
          </div>
        </Section>
      </div>
    </form>
  );
}

// ---------------- Branding ----------------

type AssetKey = "logo" | "logo_dark" | "favicon" | "loader";

const ASSETS: { key: AssetKey; field: keyof Branding; title: string; hint: string; accept: string; preview: "light" | "dark" | "icon" | "loader" }[] = [
  { key: "logo", field: "logo_url", title: "Logo", hint: "Light backgrounds · PNG, JPG, WEBP or SVG · max 2 MB", accept: ".png,.jpg,.jpeg,.webp,.svg", preview: "light" },
  { key: "logo_dark", field: "logo_dark_url", title: "Dark theme logo", hint: "Shown in dark mode · PNG, JPG, WEBP or SVG", accept: ".png,.jpg,.jpeg,.webp,.svg", preview: "dark" },
  { key: "favicon", field: "favicon_url", title: "Favicon", hint: "Browser tab icon · square PNG, ICO or SVG", accept: ".png,.ico,.svg", preview: "icon" },
  { key: "loader", field: "loader_url", title: "Loader", hint: "Shown while pages load · GIF, SVG, PNG or WEBP", accept: ".gif,.svg,.png,.webp", preview: "loader" },
];

const COLOR_PRESETS = ["#2563eb", "#4f46e5", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#059669", "#0891b2", "#0f172a"];

function AssetCard({
  asset,
  url,
  busy,
  onUpload,
  onRemove,
}: {
  asset: (typeof ASSETS)[number];
  url: string | null;
  busy: boolean;
  onUpload: (f: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const src = assetUrl(url);
  const previewBg =
    asset.preview === "dark"
      ? "bg-slate-900"
      : "bg-[linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%),linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-background";

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onUpload(f);
        }}
        className={cn("relative flex h-36 items-center justify-center border-b border-border transition-colors", previewBg, drag && "ring-2 ring-inset ring-primary")}
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={asset.title}
            className={cn("object-contain", asset.preview === "icon" ? "h-12 w-12" : asset.preview === "loader" ? "h-16 w-16" : "max-h-16 max-w-[80%]")}
          />
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={cn("flex flex-col items-center gap-2 text-sm", asset.preview === "dark" ? "text-slate-400 hover:text-slate-200" : "text-muted-foreground hover:text-foreground")}
          >
            <Upload className="h-6 w-6" />
            <span>Drop image or click to upload</span>
          </button>
        )}
      </div>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{asset.title}</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{asset.hint}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {src ? "Replace" : "Upload"}
          </Button>
          {src && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={onRemove}
              aria-label={`Remove ${asset.title}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept={asset.accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function BrandingTab() {
  const setGlobalBranding = useAppSettings((s) => s.setBranding);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [color, setColor] = useState("#2563eb");
  const [theme, setTheme] = useState<Branding["default_theme"]>("light");
  const [busyAsset, setBusyAsset] = useState<AssetKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  function hydrate(b: Branding) {
    setBranding(b);
    setColor(b.primary_color);
    setTheme(b.default_theme);
    setGlobalBranding(b); // logo, favicon, colour update across the app immediately
  }

  useEffect(() => {
    api
      .get<Branding>("/api/admin/settings/branding")
      .then(hydrate)
      .catch((err) => setNotice({ kind: "error", text: apiError(err, "Failed to load branding.") }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!branding) return <div className="mt-6 h-96 animate-pulse rounded-lg bg-muted" />;
  const validColor = /^#[0-9a-fA-F]{6}$/.test(color);
  const dirty = color.toLowerCase() !== branding.primary_color.toLowerCase() || theme !== branding.default_theme;

  async function upload(asset: AssetKey, file: File) {
    setNotice(null);
    if (file.size > 2 * 1024 * 1024) return setNotice({ kind: "error", text: "Image must be 2 MB or smaller." });
    setBusyAsset(asset);
    try {
      const form = new FormData();
      form.append("file", file);
      hydrate(await api.post<Branding>(`/api/admin/settings/branding/${asset}`, form, { isFormData: true }));
      setNotice({ kind: "success", text: `${ASSETS.find((a) => a.key === asset)?.title} updated.` });
    } catch (err) {
      setNotice({ kind: "error", text: apiError(err, "Upload failed.") });
    } finally {
      setBusyAsset(null);
    }
  }

  async function remove(asset: AssetKey) {
    setNotice(null);
    setBusyAsset(asset);
    try {
      hydrate(await api.del<Branding>(`/api/admin/settings/branding/${asset}`));
      setNotice({ kind: "success", text: `${ASSETS.find((a) => a.key === asset)?.title} removed.` });
    } catch (err) {
      setNotice({ kind: "error", text: apiError(err, "Could not remove the image.") });
    } finally {
      setBusyAsset(null);
    }
  }

  async function save() {
    setNotice(null);
    if (!validColor) return setNotice({ kind: "error", text: "Enter a colour like #2563eb." });
    setSaving(true);
    try {
      hydrate(await api.put<Branding>("/api/admin/settings/branding", { primary_color: color, default_theme: theme }));
      setNotice({ kind: "success", text: "Branding saved and applied across the application." });
    } catch (err) {
      setNotice({ kind: "error", text: apiError(err, "Could not save branding.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
    >
      <ActionBar notice={notice}>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            setColor(branding.primary_color);
            setTheme(branding.default_theme);
            setNotice(null);
          }}
        >
          Discard
        </Button>
        <Button type="submit" className={saveBtn} disabled={!dirty || saving || !validColor}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save changes
        </Button>
      </ActionBar>

      <div className="pt-6">
        <Section icon={ImageIcon} tone="indigo" title="Logos & icons">
          <p className="-mt-1 mb-4 text-sm text-muted-foreground">Images upload and apply immediately.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {ASSETS.map((a) => (
              <AssetCard
                key={a.key}
                asset={a}
                url={branding[a.field] as string | null}
                busy={busyAsset === a.key}
                onUpload={(f) => upload(a.key, f)}
                onRemove={() => remove(a.key)}
              />
            ))}
          </div>
        </Section>

        <Section icon={Palette} tone="violet" title="Brand colour">
          <div className="flex flex-wrap items-center gap-2">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Use ${c}`}
                className={cn(
                  "h-9 w-9 rounded-full border-2 transition-transform hover:scale-110",
                  color.toLowerCase() === c ? "border-foreground ring-2 ring-offset-2 ring-offset-background" : "border-transparent"
                )}
                style={{ backgroundColor: c, ...(color.toLowerCase() === c ? { ["--tw-ring-color" as string]: c } : {}) }}
              />
            ))}
            <label className="ml-1 flex items-center gap-2 rounded-md border border-input px-2 py-1">
              <input
                type="color"
                value={validColor ? color : "#2563eb"}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Custom colour"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value.trim())}
                maxLength={7}
                className="h-7 w-24 border-0 px-1 font-mono text-sm shadow-none focus-visible:ring-0"
              />
            </label>
          </div>
          {!validColor && <p className="mt-2 text-xs text-destructive">Use a hex colour like #2563eb.</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
            <span className="text-sm text-muted-foreground">Preview</span>
            <span className="rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ backgroundColor: validColor ? color : undefined }}>
              Primary button
            </span>
            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ color: validColor ? color : undefined, backgroundColor: validColor ? `${color}1a` : undefined }}>
              Badge
            </span>
            <span className="text-sm font-medium underline underline-offset-4" style={{ color: validColor ? color : undefined }}>
              Link text
            </span>
          </div>
        </Section>

        <Section icon={Sun} tone="amber" title="Default theme">
          <p className="-mt-1 mb-4 text-sm text-muted-foreground">
            Used until a visitor picks light or dark with the header toggle.
          </p>
          <div role="radiogroup" aria-label="Default theme" className="grid gap-3 sm:grid-cols-3">
            {(
              [
                { v: "light", label: "Light", icon: Sun },
                { v: "dark", label: "Dark", icon: Moon },
                { v: "system", label: "System", icon: Monitor },
              ] as const
            ).map(({ v, label, icon: Icon }) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={theme === v}
                onClick={() => setTheme(v)}
                className={cn(
                  "overflow-hidden rounded-xl border text-left transition-all",
                  theme === v ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-muted-foreground/40"
                )}
              >
                <div
                  className={cn(
                    "flex h-20 gap-1.5 p-2.5",
                    v === "light" && "bg-slate-100",
                    v === "dark" && "bg-slate-900",
                    v === "system" && "bg-[linear-gradient(90deg,#f1f5f9_50%,#0f172a_50%)]"
                  )}
                >
                  <div className={cn("w-1/4 rounded", v === "dark" ? "bg-slate-800" : "bg-white")} />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className={cn("h-2.5 w-2/3 rounded", v === "dark" ? "bg-slate-700" : "bg-slate-300")} />
                    <div className={cn("flex-1 rounded", v === "dark" ? "bg-slate-800" : "bg-white")} />
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium">
                  <Icon className="h-4 w-4 text-muted-foreground" /> {label}
                  {theme === v && <Check className="ml-auto h-4 w-4 text-primary" />}
                </div>
              </button>
            ))}
          </div>
        </Section>
      </div>
    </form>
  );
}

// ---------------- AI Model ----------------

function ModelPicker({
  value,
  catalog,
  loading,
  providerLabel,
  onChange,
  onRefresh,
}: {
  value: string;
  catalog: ModelCatalog | null;
  loading: boolean;
  providerLabel: string;
  onChange: (v: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const models = catalog?.models ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
  const custom = query.trim() && !models.includes(query.trim()) ? query.trim() : null;

  function pick(m: string) {
    onChange(m);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="space-y-2">
      <div ref={ref} className="relative">
        <button
          type="button"
          id="ai-model"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("truncate font-mono", !value && "text-muted-foreground")}>{value || "Select a model"}</span>
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          )}
        </button>

        {open && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (filtered[0]) pick(filtered[0]);
                    else if (custom) pick(custom);
                  }
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder={`Search ${models.length} models…`}
                className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
              {filtered.map((m) => (
                <li key={m}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={m === value}
                    onClick={() => pick(m)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-mono text-sm hover:bg-violet-50 dark:hover:bg-violet-500/10",
                      m === value && "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
                    )}
                  >
                    <span className="truncate">{m}</span>
                    {m === value && <Check className="h-4 w-4 shrink-0 text-violet-600" />}
                  </button>
                </li>
              ))}
              {custom && (
                <li>
                  <button
                    type="button"
                    onClick={() => pick(custom)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-violet-700 hover:bg-violet-50"
                  >
                    Use <span className="font-mono font-medium">“{custom}”</span>
                  </button>
                </li>
              )}
              {!filtered.length && !custom && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No models found</li>}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 text-xs">
        {loading ? (
          <span className="text-muted-foreground">Loading models from {providerLabel}…</span>
        ) : catalog?.live ? (
          <span className="text-emerald-600">
            {catalog.models.length} models available from {providerLabel}
          </span>
        ) : (
          <span className="text-amber-600">{catalog?.message ?? "Showing suggested models."}</span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-violet-700 hover:text-violet-900 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>
    </div>
  );
}

function SourceLabel({ info }: { info: KeyInfo }) {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";
  if (info.decrypt_failed) return <span className={cn(base, "bg-rose-100 text-rose-700")}>Unreadable — re-enter</span>;
  if (info.source === "database")
    return (
      <span className={cn(base, "bg-emerald-100 text-emerald-700")}>
        <ShieldCheck className="h-3 w-3" /> Encrypted
      </span>
    );
  if (info.source === "env") return <span className={cn(base, "bg-sky-100 text-sky-700")}>Environment</span>;
  return <span className={cn(base, "bg-slate-100 text-slate-600")}>Not set</span>;
}

function KeyField({
  provider,
  info,
  active,
  value,
  clear,
  onChange,
  onClear,
}: {
  provider: Provider;
  info: KeyInfo;
  active: boolean;
  value: string;
  clear: boolean;
  onChange: (v: string) => void;
  onClear: (v: boolean) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`key-${provider.key}`} className="flex items-center gap-2 text-sm font-medium">
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold text-white", providerStyle(provider.key).tile)}>
            {providerStyle(provider.key).initials}
          </span>
          {provider.label}
          {active && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">Active</span>}
        </Label>
        <SourceLabel info={info} />
      </div>
      <div className="relative">
        <Input
          id={`key-${provider.key}`}
          type={show ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={clear}
          placeholder={info.configured ? `${info.hint}  (leave blank to keep)` : "Enter API key"}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10 font-mono text-sm"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide key" : "Show key"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {info.source === "database" && (
        <label className="flex items-center gap-2 pt-0.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={clear} onChange={(e) => onClear(e.target.checked)} />
          Remove saved key and use the environment value instead
        </label>
      )}
    </div>
  );
}

function AITab({ options }: { options: Options | null }) {
  const [view, setView] = useState<AIView | null>(null);
  const [form, setForm] = useState<AIForm | null>(null);
  const [savedForm, setSavedForm] = useState<AIForm | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [clears, setClears] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  // Set when the admin switches provider, so the model snaps to one the new provider offers.
  const switchedProvider = useRef(false);

  async function loadModels(providerKey: string, apiKey?: string) {
    setLoadingModels(true);
    try {
      const res = await api.post<ModelCatalog>("/api/admin/settings/ai/models", {
        provider: providerKey,
        api_key: apiKey?.trim() || null,
      });
      setCatalog(res);
      if (switchedProvider.current && res.models.length) {
        switchedProvider.current = false;
        const fallback = options?.providers.find((p) => p.key === providerKey)?.default_model;
        setForm((f) =>
          f && f.provider === providerKey && !res.models.includes(f.model)
            ? { ...f, model: fallback && res.models.includes(fallback) ? fallback : res.models[0] }
            : f
        );
      }
    } catch {
      setCatalog({ provider: providerKey, models: [], live: false, message: "Couldn't load models." });
    } finally {
      setLoadingModels(false);
    }
  }

  useEffect(() => {
    if (form?.provider) loadModels(form.provider, keys[form.provider]);
    // Reload only when the provider changes; key edits use the Refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.provider]);

  function hydrate(v: AIView) {
    const f: AIForm = {
      provider: v.provider,
      model: v.model,
      timeout_seconds: v.timeout_seconds,
      temperature: v.temperature == null ? "" : String(v.temperature),
      max_output_tokens: v.max_output_tokens == null ? "" : String(v.max_output_tokens),
    };
    setView(v);
    setForm(f);
    setSavedForm(f);
    setKeys({});
    setClears({});
  }

  useEffect(() => {
    api
      .get<AIView>("/api/admin/settings/ai")
      .then(hydrate)
      .catch((err) => setNotice({ kind: "error", text: apiError(err, "Failed to load AI settings.") }));
  }, []);

  const dirty =
    JSON.stringify(form) !== JSON.stringify(savedForm) ||
    Object.values(keys).some((k) => k.trim()) ||
    Object.values(clears).some(Boolean);

  if (!form || !view) return <div className="mt-6 h-96 animate-pulse rounded-lg bg-muted" />;
  const provider = options?.providers.find((p) => p.key === form.provider);
  const set = <K extends keyof AIForm>(k: K, v: AIForm[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setTest(null);
    setNotice(null);
  };

  function validate(): string | null {
    if (!form) return "Form not loaded.";
    if (!form.model.trim()) return "Please choose a model.";
    if (form.temperature !== "") {
      const t = Number(form.temperature);
      if (isNaN(t) || t < 0 || t > 1) return "Temperature must be between 0 and 1.";
    }
    if (form.max_output_tokens !== "") {
      const m = Number(form.max_output_tokens);
      if (!Number.isInteger(m) || m < 256 || m > 64000) return "Max output tokens must be a whole number from 256 to 64000.";
    }
    if (form.timeout_seconds < 5 || form.timeout_seconds > 300) return "Timeout must be between 5 and 300 seconds.";
    const activeKey = view?.keys[form.provider];
    const removing = clears[form.provider];
    if (!keys[form.provider]?.trim() && (!activeKey?.configured || (removing && activeKey.source === "database")))
      return `An API key for ${provider?.label ?? form.provider} is required because it is the selected provider.`;
    return null;
  }

  function payload(includeClears: boolean) {
    const body: Record<string, unknown> = {
      provider: form!.provider,
      model: form!.model.trim(),
      timeout_seconds: Number(form!.timeout_seconds),
      temperature: form!.temperature === "" ? null : Number(form!.temperature),
      max_output_tokens: form!.max_output_tokens === "" ? null : Number(form!.max_output_tokens),
    };
    for (const p of options?.providers ?? []) {
      const field = `${p.key}_api_key`;
      if (clears[p.key] && includeClears) body[field] = "";
      else if (keys[p.key]?.trim()) body[field] = keys[p.key].trim();
    }
    return body;
  }

  async function runTest() {
    setNotice(null);
    const err = validate();
    if (err) return setNotice({ kind: "error", text: err });
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<TestResult>("/api/admin/settings/ai/test", payload(false)));
    } catch (e) {
      setNotice({ kind: "error", text: apiError(e, "Connection test failed.") });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setNotice(null);
    const err = validate();
    if (err) return setNotice({ kind: "error", text: err });
    setSaving(true);
    try {
      hydrate(await api.put<AIView>("/api/admin/settings/ai", payload(true)));
      setNotice({ kind: "success", text: "AI configuration saved. All AI features now use these settings." });
    } catch (e2) {
      setNotice({ kind: "error", text: apiError(e2, "Could not save AI settings.") });
    } finally {
      setSaving(false);
    }
  }


  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      noValidate
      autoComplete="off"
    >
      <ActionBar notice={notice}>
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || saving || testing}
          onClick={() => {
            setForm(savedForm);
            setKeys({});
            setClears({});
            setTest(null);
            setNotice(null);
          }}
        >
          Discard
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-violet-200 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
          onClick={runTest}
          disabled={testing || saving}
        >
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button type="submit" className={saveBtn} disabled={!dirty || saving || testing}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save changes
        </Button>
      </ActionBar>

      {test && (
        <div
          role="status"
          className={cn(
            "mt-4 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
            test.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"
          )}
        >
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white", test.ok ? "bg-emerald-500" : "bg-rose-500")}>
            {test.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          </span>
          <span>
            <span className="font-medium">{test.ok ? "Connection successful. " : "Connection failed. "}</span>
            {test.message}
            {test.latency_ms > 0 && <span className="text-muted-foreground"> ({test.latency_ms} ms)</span>}
          </span>
        </div>
      )}

      <div className="pt-6">
        <Section icon={Cpu} tone="indigo" title="AI Provider">
          <SubHeading icon={Cpu} tone="indigo" title="Provider" />
          <div role="radiogroup" aria-label="AI provider" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(options?.providers ?? []).map((p) => {
              const selected = form.provider === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    switchedProvider.current = true;
                    setForm((f) => (f ? { ...f, provider: p.key, model: p.default_model } : f));
                    setTest(null);
                    setNotice(null);
                  }}
                  className={cn(
                    "flex items-start gap-3 rounded-md border p-4 text-left transition-colors",
                    selected ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500 dark:bg-indigo-500/10" : "border-border hover:bg-accent/50"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm",
                      providerStyle(p.key).tile
                    )}
                  >
                    {providerStyle(p.key).initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span
                      className={cn(
                        "mt-0.5 block truncate text-xs",
                        view.keys[p.key]?.configured ? "text-emerald-600" : "text-muted-foreground"
                      )}
                    >
                      {view.keys[p.key]?.configured ? "API key configured" : "No API key"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-indigo-600" : "border-muted-foreground/40"
                    )}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-indigo-600" />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="my-6 border-t border-border" />
          <SubHeading icon={Layers} tone="violet" title="Model" />
          <ModelPicker
            value={form.model}
            catalog={catalog?.provider === form.provider ? catalog : null}
            loading={loadingModels}
            providerLabel={provider?.label ?? form.provider}
            onChange={(m) => set("model", m)}
            onRefresh={() => loadModels(form.provider, keys[form.provider])}
          />

          <div className="my-6 border-t border-border" />
          <SubHeading icon={KeyRound} tone="amber" title="API keys" />
          <div className="space-y-5">
            {(options?.providers ?? []).map((p) => (
              <KeyField
                key={p.key}
                provider={p}
                active={form.provider === p.key}
                info={view.keys[p.key] ?? { configured: false, hint: null, source: "none", decrypt_failed: false }}
                value={keys[p.key] ?? ""}
                clear={!!clears[p.key]}
                onChange={(v) => {
                  setKeys((k) => ({ ...k, [p.key]: v }));
                  setTest(null);
                  setNotice(null);
                }}
                onClear={(v) => setClears((c) => ({ ...c, [p.key]: v }))}
              />
            ))}
          </div>
        </Section>

        <Section icon={Wrench} tone="cyan" title="Advanced">
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Temperature" htmlFor="ai-temp" hint="0 to 1">
              <Input
                id="ai-temp"
                type="number"
                step="0.1"
                min={0}
                max={1}
                placeholder="Default"
                value={form.temperature}
                onChange={(e) => set("temperature", e.target.value)}
              />
            </Field>
            <Field label="Max output tokens" htmlFor="ai-max" hint="256 to 64,000">
              <Input
                id="ai-max"
                type="number"
                min={256}
                max={64000}
                placeholder="Default"
                value={form.max_output_tokens}
                onChange={(e) => set("max_output_tokens", e.target.value)}
              />
            </Field>
            <Field label="Timeout" htmlFor="ai-timeout" hint="5 to 300 seconds">
              <div className="relative">
                <Input
                  id="ai-timeout"
                  type="number"
                  min={5}
                  max={300}
                  className="pr-10"
                  value={form.timeout_seconds}
                  onChange={(e) => set("timeout_seconds", Number(e.target.value))}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">s</span>
              </div>
            </Field>
          </div>
        </Section>
      </div>
    </form>
  );
}

export default function ThemeConfigurationPage() {
  const [options, setOptions] = useState<Options | null>(null);
  useEffect(() => {
    api.get<Options>("/api/admin/settings/options").then(setOptions).catch(() => setOptions(null));
  }, []);

  return (
    <AppShell requireSuperAdmin>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Theme Configuration</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage application-wide settings. Changes take effect immediately.</p>
        </div>

        <Tabs defaultValue="general">
          <TabsList className="h-auto w-full justify-start gap-6 rounded-none border-b border-border bg-transparent p-0">
            {[
              { value: "general", label: "General" },
              { value: "branding", label: "Branding" },
              { value: "ai", label: "AI Model" },
            ].map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="-mb-px rounded-none border-b-2 border-transparent bg-transparent px-0 pb-3 pt-1 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="general" className="mt-0">
            <GeneralTab options={options} />
          </TabsContent>
          <TabsContent value="branding" className="mt-0">
            <BrandingTab />
          </TabsContent>
          <TabsContent value="ai" className="mt-0">
            <AITab options={options} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
