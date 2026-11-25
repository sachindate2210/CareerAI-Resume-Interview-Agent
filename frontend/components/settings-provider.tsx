"use client";

import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand";
import { api } from "@/lib/api";
import {
  type Branding,
  type GeneralSettings,
  applyBrandColor,
  applyFavicon,
  assetUrl,
  readCachedBranding,
  useAppSettings,
} from "@/lib/app-settings";
import { useTheme } from "@/lib/theme";

type PublicSettings = GeneralSettings & { branding: Branding };

/** Applies branding (colour, favicon, theme) to the whole app, re-applying whenever it changes. */
export function useApplyBranding() {
  const branding = useAppSettings((s) => s.branding);
  const initTheme = useTheme((s) => s.init);
  useEffect(() => {
    applyBrandColor(branding.primary_color);
    applyFavicon(assetUrl(branding.favicon_url));
  }, [branding.primary_color, branding.favicon_url]);
  useEffect(() => {
    initTheme(branding.default_theme);
  }, [branding.default_theme, initTheme]);
}

/** Loads global settings before rendering so dates, logo and colours are right on first paint.
 *  Shows the brand loader while waiting, and never blocks for more than ~1.5s. */
export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { loaded, setSettings, setBranding, settings } = useAppSettings();
  const [timedOut, setTimedOut] = useState(false);

  useApplyBranding();

  useEffect(() => {
    const cached = readCachedBranding();
    if (cached) setBranding(cached);
    const timer = setTimeout(() => setTimedOut(true), 1500);
    api
      .get<PublicSettings>("/api/settings/public", undefined, { skipAuth: true })
      .then(({ branding, ...general }) => {
        setBranding(branding);
        setSettings(general);
      })
      .catch(() => setTimedOut(true))
      .finally(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, [setSettings, setBranding]);

  useEffect(() => {
    if (loaded && settings.app_name) {
      document.title = document.title.replace(/^[^—]+/, `${settings.app_name} `);
    }
  }, [loaded, settings.app_name]);

  if (!loaded && !timedOut) return <BrandLoader className="min-h-screen" />;
  return <>{children}</>;
}
