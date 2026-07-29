/** Shared IG/FB profile URL helpers — kept out of serp/scoring modules to avoid circular imports. */

function facebookHostOk(host: string): boolean {
  const h = host.replace(/^www\./i, "").toLowerCase();
  if (h === "fb.com" || h.endsWith(".fb.com")) return true;
  if (h === "facebook.com" || h.endsWith(".facebook.com")) {
    if (h.startsWith("static.") || h.includes("fbcdn")) return false;
    return true;
  }
  return false;
}

export function looseFacebookOk(url: string): boolean {
  try {
    const u = new URL(url);
    if (!facebookHostOk(u.hostname)) return false;
    const p = u.pathname.toLowerCase();
    if (/\/(login|privacy|policies|share|sharer|dialog)(\/|$)/.test(p)) return false;
    return u.pathname.length > 1;
  } catch {
    return false;
  }
}

/**
 * Accept only profile URLs `instagram.com/<handle>` (one segment).
 * Rejects posts/reels/explore/popular hubs and Meta-owned handles like `/instagram`.
 */
export function looseInstagramOk(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (h !== "instagram.com" && !h.endsWith(".instagram.com")) return false;
    const parts = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (parts.length !== 1) return false;
    const handle = parts[0]!.toLowerCase();
    if (handle.length < 2) return false;
    const RESERVED = new Set([
      "instagram",
      "creators",
      "about",
      "explore",
      "accounts",
      "legal",
      "help",
      "press",
      "popular",
      "reel",
      "reels",
      "p",
      "tv",
      "stories",
      "direct",
      "developer",
    ]);
    return !RESERVED.has(handle);
  } catch {
    return false;
  }
}

export function isLikelyProfileUrl(url: string, kind: "facebook" | "instagram"): boolean {
  return kind === "facebook" ? looseFacebookOk(url) : looseInstagramOk(url);
}

/** First location segment that looks like a city (skip leading street lines and bare US states). */
export function cityGuessFromLocation(location: string): string | null {
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (/^\d/.test(p)) continue;
    const t = p.replace(/\s+/g, " ").trim();
    if (/^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?$/i.test(t)) continue;
    if (t.length >= 2) return t;
  }
  return null;
}
