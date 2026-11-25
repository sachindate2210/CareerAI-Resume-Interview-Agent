// NOTE (production hardening): this is a client-only Next.js app with no
// backend-for-frontend, so there is nowhere to set an httpOnly cookie without
// a server component acting as a proxy. Storing JWTs in localStorage is
// pragmatic for this project but is vulnerable to XSS token theft. A
// production build should add Next.js Route Handlers (`app/api/.../route.ts`)
// that proxy to the FastAPI backend and set the access/refresh tokens as
// httpOnly, Secure, SameSite=strict cookies instead of exposing them to JS.

import type { AuthTokens, UserRead } from "@/types/api";

const ACCESS_KEY = "careerai_access_token";
const REFRESH_KEY = "careerai_refresh_token";
const USER_KEY = "careerai_user";
// While impersonating, the admin's own session is parked here so "Return to admin" can restore it.
const ORIGINAL_KEY = "careerai_original_session";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(tokens: AuthTokens): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCESS_KEY, tokens.access_token);
  window.localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
}

export function setUser(user: UserRead): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): UserRead | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserRead;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(ORIGINAL_KEY);
}

export function isImpersonating(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.localStorage.getItem(ORIGINAL_KEY);
}

/** Switch to an impersonation token, parking the current admin session. No refresh token is
 *  kept for the impersonated session, so it simply ends when the short-lived token expires. */
export function startImpersonation(accessToken: string): void {
  if (typeof window === "undefined" || isImpersonating()) return;
  const ls = window.localStorage;
  ls.setItem(
    ORIGINAL_KEY,
    JSON.stringify({ access: ls.getItem(ACCESS_KEY), refresh: ls.getItem(REFRESH_KEY), user: ls.getItem(USER_KEY) })
  );
  ls.setItem(ACCESS_KEY, accessToken);
  ls.removeItem(REFRESH_KEY);
  ls.removeItem(USER_KEY);
}

/** Restore the parked admin session. Returns false if there was none. */
export function stopImpersonation(): boolean {
  if (typeof window === "undefined") return false;
  const ls = window.localStorage;
  const raw = ls.getItem(ORIGINAL_KEY);
  if (!raw) return false;
  ls.removeItem(ORIGINAL_KEY);
  try {
    const original = JSON.parse(raw) as { access: string | null; refresh: string | null; user: string | null };
    for (const [key, value] of [
      [ACCESS_KEY, original.access],
      [REFRESH_KEY, original.refresh],
      [USER_KEY, original.user],
    ] as const) {
      if (value) ls.setItem(key, value);
      else ls.removeItem(key);
    }
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
