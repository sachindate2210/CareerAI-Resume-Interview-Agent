"use client";

import { Moon, Sun } from "lucide-react";
import { assetUrl, useAppSettings } from "@/lib/app-settings";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** App logo: the uploaded logo (dark variant in dark mode), else the default mark + app name. */
export function BrandLogo({
  className,
  showName = true,
  size = "md",
  variant,
  compact = false,
}: {
  className?: string;
  showName?: boolean;
  size?: "sm" | "md" | "lg";
  /** Icon only (favicon image or the default mark), for collapsed sidebars. */
  compact?: boolean;
  /** Force the logo for a light/dark surface regardless of theme (e.g. the always-dark sidebar). */
  variant?: "light" | "dark";
}) {
  const { branding, settings } = useAppSettings();
  const mode = useTheme((s) => s.mode);
  const surface = variant ?? mode;
  const src = assetUrl(surface === "dark" ? branding.logo_dark_url || branding.logo_url : branding.logo_url);
  const height = size === "lg" ? "h-10" : size === "sm" ? "h-6" : "h-8";

  if (compact) {
    const icon = assetUrl(branding.favicon_url);
    return icon ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={icon} alt={settings.app_name} className={cn("h-9 w-9 rounded-lg object-contain", className)} />
    ) : (
      <span className={cn("h-8 w-8 rounded-lg bg-primary", className)} />
    );
  }

  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={settings.app_name} className={cn(height, "w-auto max-w-[180px] object-contain", className)} />;
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className={cn("shrink-0 rounded-md bg-primary", size === "lg" ? "h-8 w-8" : "h-6 w-6")} />
      {showName && (
        <span className={cn("truncate font-semibold tracking-tight", size === "lg" ? "text-xl" : "text-base")}>{settings.app_name}</span>
      )}
    </span>
  );
}

/** Loading indicator: the uploaded loader image, else a spinner in the brand colour. */
export function BrandLoader({ label, className }: { label?: string; className?: string }) {
  const loader = assetUrl(useAppSettings((s) => s.branding.loader_url));
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-3 py-16", className)}>
      {loader ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={loader} alt="" className="h-14 w-14 object-contain" />
      ) : (
        <span className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
      )}
      {label && <span className="text-sm text-muted-foreground">{label}</span>}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { mode, toggle } = useTheme();
  const dark = mode === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className
      )}
    >
      <Sun className={cn("h-4 w-4 transition-all", dark ? "scale-0 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100")} />
      <Moon className={cn("absolute h-4 w-4 transition-all", dark ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-90 opacity-0")} />
    </button>
  );
}
