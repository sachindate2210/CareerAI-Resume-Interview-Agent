import { create } from "zustand";

// Per-browser light/dark preference. Falls back to the admin's default theme (Branding tab).

export type ThemeMode = "light" | "dark";
export const THEME_KEY = "careerai_theme";

function readStored(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function resolveTheme(defaultTheme: "light" | "dark" | "system" = "light"): ThemeMode {
  const stored = readStored();
  if (stored) return stored;
  if (defaultTheme === "system") {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return defaultTheme;
}

function apply(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", mode === "dark");
}

interface ThemeState {
  mode: ThemeMode;
  /** Apply the stored preference, else the admin default, without saving anything. */
  init: (defaultTheme: "light" | "dark" | "system") => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: "light",
  init: (defaultTheme) => {
    const mode = resolveTheme(defaultTheme);
    apply(mode);
    set({ mode });
  },
  toggle: () => {
    const mode: ThemeMode = get().mode === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* storage blocked: still switch for this page */
    }
    apply(mode);
    set({ mode });
  },
}));

/** Runs before React hydrates so the page never flashes the wrong theme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(!t){var b=JSON.parse(localStorage.getItem("careerai_branding")||"{}");var d=b.default_theme||"light";t=d==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):d;}if(t==="dark")document.documentElement.classList.add("dark");}catch(e){}})();`;
