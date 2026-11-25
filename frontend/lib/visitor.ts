// Anonymous, random per-browser id sent with public tool requests so the admin panel can spot
// repeat usage without a login. It identifies a browser, not a person, and holds no personal data.

const KEY = "careerai_visitor_id";

export function getVisitorId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    let id = window.localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // Storage blocked (private mode etc.) — the backend falls back to a hashed IP.
    return undefined;
  }
}
