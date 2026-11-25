import { create } from "zustand";

// Global, non-secret settings from GET /api/settings/public (edited in Theme Configuration).

export interface GeneralSettings {
  app_name: string;
  support_email: string | null;
  timezone: string;
  date_format: "DD MMM YYYY" | "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "MMM DD, YYYY";
  time_format: "12h" | "24h";
  week_start: "monday" | "sunday";
  default_page_size: 10 | 20 | 50 | 100;
  max_upload_mb: number;
  public_optimizer_enabled: boolean;
}

export const DEFAULT_SETTINGS: GeneralSettings = {
  app_name: "CareerAI",
  support_email: null,
  timezone: "UTC",
  date_format: "DD MMM YYYY",
  time_format: "12h",
  week_start: "monday",
  default_page_size: 20,
  max_upload_mb: 10,
  public_optimizer_enabled: true,
};

export interface Branding {
  primary_color: string;
  default_theme: "light" | "dark" | "system";
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  loader_url: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  primary_color: "#2563eb",
  default_theme: "light",
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  loader_url: null,
};

// Last known branding, so the logo/loader/theme are right on the very first paint of the next visit.
export const BRANDING_CACHE_KEY = "careerai_branding";

export function readCachedBranding(): Branding | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BRANDING_CACHE_KEY);
    return raw ? { ...DEFAULT_BRANDING, ...(JSON.parse(raw) as Partial<Branding>) } : null;
  } catch {
    return null;
  }
}

interface SettingsState {
  settings: GeneralSettings;
  branding: Branding;
  loaded: boolean;
  setSettings: (s: GeneralSettings) => void;
  setBranding: (b: Branding) => void;
}

export const useAppSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  branding: DEFAULT_BRANDING,
  loaded: false,
  setSettings: (settings) => set({ settings, loaded: true }),
  setBranding: (branding) => {
    try {
      window.localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(branding));
    } catch {
      /* storage blocked */
    }
    set({ branding });
  },
}));

/** Branding image paths are served by the API; make them absolute for <img>/<link>. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
  return `${base}${path}`;
}

/** "#2563eb" -> "221 83% 53%" (the HSL triplet format our CSS variables use). */
export function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function applyBrandColor(hex: string) {
  const hsl = hexToHslTriplet(hex);
  if (!hsl || typeof document === "undefined") return;
  document.documentElement.style.setProperty("--primary", hsl);
  document.documentElement.style.setProperty("--ring", hsl);
}

export function applyFavicon(url: string | null) {
  if (typeof document === "undefined") return;
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!url) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options });
  }
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value])) as Record<string, string>;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDateWith(value: string | Date | null | undefined, s: GeneralSettings): string {
  const d = toDate(value);
  if (!d) return typeof value === "string" && value ? value : "—";
  const p = parts(d, s.timezone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const mon = parts(d, s.timezone, { month: "short" }).month;
  switch (s.date_format) {
    case "DD/MM/YYYY":
      return `${p.day}/${p.month}/${p.year}`;
    case "MM/DD/YYYY":
      return `${p.month}/${p.day}/${p.year}`;
    case "YYYY-MM-DD":
      return `${p.year}-${p.month}-${p.day}`;
    case "MMM DD, YYYY":
      return `${mon} ${p.day}, ${p.year}`;
    default:
      return `${p.day} ${mon} ${p.year}`;
  }
}

export function formatTimeWith(value: string | Date | null | undefined, s: GeneralSettings): string {
  const d = toDate(value);
  if (!d) return "—";
  const p = parts(d, s.timezone, { hour: "2-digit", minute: "2-digit", hour12: s.time_format === "12h" });
  return s.time_format === "12h" ? `${p.hour}:${p.minute} ${(p.dayPeriod || "").toUpperCase()}`.trim() : `${p.hour}:${p.minute}`;
}

// Read the store directly so plain helpers (used during render) follow the saved settings.
export function formatDate(value: string | Date | null | undefined): string {
  return formatDateWith(value, useAppSettings.getState().settings);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  const s = useAppSettings.getState().settings;
  return `${formatDateWith(d, s)}, ${formatTimeWith(d, s)}`;
}
