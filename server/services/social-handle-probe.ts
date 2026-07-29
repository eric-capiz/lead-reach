/**
 * Direct handle probing + unified scoring for IG/FB profile resolution.
 * Free-only: HTTP fetch + regex — no paid APIs.
 */

import { cityGuessFromLocation, isLikelyProfileUrl } from "@/server/lib/social-profile-url";
import {
  meetsAutoPickBar,
  normalizeForMatch,
  scoreBusinessRelevance,
  significantBusinessTokens,
  stripBusinessLegalSuffixes,
  type SocialPickSource,
} from "@/server/lib/social-name-match";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Mobile UA — Facebook serves usable titles on m/www with this. */
const FB_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

/** Public web app id embedded in Instagram pages — used for handle existence checks. */
const IG_WEB_APP_ID = "936619743392459";

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_DELAY_MS = 120;

/** Winner must lead second-place by at least this many relevance points. */
const MIN_PICK_MARGIN = 10;

export type SocialCandidateSource = SocialPickSource;

export type SocialCandidateEntry = {
  url: string;
  source: SocialCandidateSource;
};

const IG_DEAD = [
  "sorry, this page isn't available",
  "the link you followed may be broken",
  "the page may have been removed",
];

const FB_DEAD = [
  "this content isn't available",
  "this page isn't available",
  "page not found",
  "the link you followed may be broken",
];

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export { stripBusinessLegalSuffixes, significantBusinessTokens } from "@/server/lib/social-name-match";

function addSlugVariant(variants: Set<string>, slug: string) {
  if (slug.length >= 3 && slug.length <= 30) variants.add(slug);
}

/**
 * Build handle slug candidates from distinctive name tokens (not city-only slugs).
 * Covers separators, reversed order, and recent year suffixes (e.g. rosasflower2025).
 */
export function generateHandleVariants(businessName: string, location?: string): string[] {
  const tokens = significantBusinessTokens(businessName);
  if (tokens.length === 0) return [];

  const variants = new Set<string>();
  const joiners = ["", "_", "-", "."] as const;

  const addJoin = (parts: string[]) => {
    if (parts.length === 0) return;
    for (const j of joiners) {
      addSlugVariant(variants, parts.join(j));
    }
  };

  addJoin(tokens);

  if (tokens.length >= 2) {
    addJoin([...tokens].reverse());
    const last = tokens[tokens.length - 1]!;
    if (last.length >= 4) addSlugVariant(variants, last);
    if (tokens.length === 2) addJoin([tokens[1]!, tokens[0]!]);
  }

  for (const w of tokens) {
    if (/^\d/.test(w)) addSlugVariant(variants, w);
  }

  /** Common pattern: brand name + year (rosasflower2025). */
  const year = new Date().getFullYear();
  const years = [year - 1, year, year + 1];
  const primaryBases = [tokens.join(""), tokens.join("_"), tokens.join("-")];
  for (const base of primaryBases) {
    if (base.length < 3 || base.length > 24) continue;
    for (const y of years) {
      addSlugVariant(variants, `${base}${y}`);
      addSlugVariant(variants, `${base}_${y}`);
    }
  }

  /** City + business token combos (never city alone — avoids facebook.com/elpaso). */
  const city = location?.trim() ? cityGuessFromLocation(location) : null;
  if (city) {
    const citySlug = normalizeForMatch(city);
    const contentTokens = tokens.filter((w) => !/^\d+$/.test(w));
    if (citySlug.length >= 3) {
      for (const w of contentTokens) {
        addJoin([citySlug, w]);
        addJoin([w, citySlug]);
      }
    }
  }

  return [...variants];
}

function profileUrlForHandle(handle: string, network: "facebook" | "instagram"): string {
  const enc = encodeURIComponent(handle);
  if (network === "instagram") return `https://www.instagram.com/${enc}/`;
  return `https://www.facebook.com/${enc}/`;
}

function extractHandle(url: string, network: "facebook" | "instagram"): string | null {
  try {
    const parts = new URL(url).pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (parts.length !== 1) return null;
    const h = parts[0]!.toLowerCase();
    if (network === "facebook" && (h === "profile.php" || h === "people")) return null;
    return h;
  } catch {
    return null;
  }
}

function canonicalProfileUrl(raw: string, network: "facebook" | "instagram"): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const url = new URL(t.startsWith("//") ? `https:${t}` : t);
    url.hash = "";
    let href = url.href.replace(/\/$/, "");
    return isLikelyProfileUrl(href, network) ? href : null;
  } catch {
    return null;
  }
}

function dedupeEntries(
  entries: SocialCandidateEntry[],
  network: "facebook" | "instagram",
): SocialCandidateEntry[] {
  const seen = new Set<string>();
  const out: SocialCandidateEntry[] = [];
  const sourceRank: Record<SocialCandidateSource, number> = {
    website: 4,
    direct_probe: 3,
    serp: 2,
    playwright: 1,
  };

  for (const e of entries) {
    const c = canonicalProfileUrl(e.url, network);
    if (!c) continue;
    if (seen.has(c)) {
      const idx = out.findIndex((x) => canonicalProfileUrl(x.url, network) === c);
      if (idx >= 0 && sourceRank[e.source] > sourceRank[out[idx]!.source]) {
        out[idx] = { url: c, source: e.source };
      }
      continue;
    }
    seen.add(c);
    out.push({ url: c, source: e.source });
  }
  return out;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function extractTitle(html: string): string {
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (og?.[1]) return decodeHtmlEntities(og[1].trim());
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t?.[1] ? decodeHtmlEntities(t[1].trim()) : "";
}

type ProfileMeta = { alive: boolean; title: string; html: string };

async function fetchInstagramProfileMeta(
  handle: string,
): Promise<{ alive: boolean; username?: string; fullName?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`,
      {
        signal: ctrl.signal,
        headers: {
          "User-Agent": UA,
          "X-IG-App-ID": IG_WEB_APP_ID,
          "X-Requested-With": "XMLHttpRequest",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          Accept: "*/*",
          Referer: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
        },
      },
    );
    const text = await res.text();
    if (res.status === 404 || text.trimStart().startsWith("<!")) {
      return { alive: false };
    }
    if (res.status === 200) {
      try {
        const json = JSON.parse(text) as {
          data?: { user?: { username?: string; full_name?: string } };
        };
        const user = json.data?.user;
        if (user?.username) {
          return { alive: true, username: user.username, fullName: user.full_name ?? "" };
        }
      } catch {
        /* fall through */
      }
    }
    if (res.status === 400 && text.trimStart().startsWith("{")) {
      return { alive: true, username: handle };
    }
    return { alive: false };
  } catch {
    return { alive: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFacebookProfileMeta(
  handle: string,
): Promise<{ alive: boolean; title: string; html: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const url = profileUrlForHandle(handle, "facebook");
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": FB_MOBILE_UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const html = await res.text();
    const title = extractTitle(html);
    const lowTitle = title.toLowerCase();
    const low = html.toLowerCase();

    if (res.status === 404 || res.status === 410) {
      return { alive: false, title: "", html };
    }
    if (FB_DEAD.some((p) => low.includes(p))) {
      return { alive: false, title, html };
    }
    if (lowTitle === "facebook" || lowTitle === "error" || lowTitle.startsWith("log in to facebook")) {
      return { alive: false, title, html };
    }
    if (/"entity_id"\s*:/.test(html) || /"page_id"\s*:/.test(html)) {
      return { alive: true, title, html };
    }
    if (title.length > 0 && lowTitle !== "facebook") {
      return { alive: true, title, html };
    }
    return { alive: false, title, html };
  } catch {
    return { alive: false, title: "", html: "" };
  } finally {
    clearTimeout(timer);
  }
}

export function isDeadSocialProfilePage(
  html: string,
  network: "facebook" | "instagram",
): boolean {
  if (!html || html.length < 80) return true;
  const low = html.toLowerCase();
  const dead = network === "instagram" ? IG_DEAD : FB_DEAD;
  if (dead.some((p) => low.includes(p))) return true;

  if (network === "instagram") {
    if (/"username"\s*:\s*"/.test(html) || /"is_private"\s*:\s*false/.test(html)) return false;
    if (html.includes("ProfilePage")) return false;
    return true;
  }

  if (network === "facebook") {
    if (/"entity_id"\s*:/.test(html) || /"page_id"\s*:/.test(html)) return false;
    const title = extractTitle(html).toLowerCase();
    if (title === "facebook" || title === "error") return true;
    if (low.includes("log in to facebook") && !/"name"\s*:/.test(html)) return true;
  }

  return false;
}

export async function validateProfileAlive(
  url: string,
  network: "facebook" | "instagram",
): Promise<ProfileMeta> {
  const handle = extractHandle(url, network);
  if (!handle) return { alive: false, title: "", html: "" };

  if (network === "instagram") {
    const meta = await fetchInstagramProfileMeta(handle);
    const title = meta.fullName || meta.username || "";
    return { alive: meta.alive, title, html: "" };
  }

  return fetchFacebookProfileMeta(handle);
}

export async function probeDirectHandleCandidates(
  businessName: string,
  network: "facebook" | "instagram",
  location?: string,
): Promise<SocialCandidateEntry[]> {
  const handles = generateHandleVariants(businessName, location);
  const found: SocialCandidateEntry[] = [];

  for (const handle of handles) {
    const url = profileUrlForHandle(handle, network);
    const meta = await validateProfileAlive(url, network);
    if (!meta.alive) {
      await sleep(PROBE_DELAY_MS);
      continue;
    }

    const rel = scoreBusinessRelevance(businessName, handle, meta.title, location);
    if (!meetsAutoPickBar("direct_probe", rel)) {
      await sleep(PROBE_DELAY_MS);
      continue;
    }

    const c = canonicalProfileUrl(url, network);
    if (c) {
      found.push({ url: c, source: "direct_probe" });
      break;
    }
    await sleep(PROBE_DELAY_MS);
  }

  return found;
}

type QualifiedCandidate = {
  url: string;
  source: SocialCandidateSource;
  relevance: ReturnType<typeof scoreBusinessRelevance>;
};

function preRankHandle(entry: SocialCandidateEntry, businessName: string, network: "facebook" | "instagram") {
  const handle = extractHandle(entry.url, network);
  const rel = scoreBusinessRelevance(businessName, handle, "", undefined);
  const sourceBoost = { website: 40, direct_probe: 30, serp: 10, playwright: 5 }[entry.source];
  return rel.score + sourceBoost;
}

/**
 * Score all candidates (with alive checks), auto-pick only when business relevance is proven.
 * Returns null when no clear winner — caller should leave the field blank.
 */
export async function pickBestSocialCandidate(
  entries: SocialCandidateEntry[],
  businessName?: string,
  location?: string,
  kind?: "facebook" | "instagram",
): Promise<string | null> {
  const network = kind ?? "instagram";
  const bn = (businessName ?? "").trim();
  if (!bn) return null;

  const loc = location?.trim() || undefined;
  const deduped = dedupeEntries(entries, network).filter((e) => isLikelyProfileUrl(e.url, network));
  if (deduped.length === 0) return null;

  const ranked = [...deduped]
    .sort((a, b) => preRankHandle(b, bn, network) - preRankHandle(a, bn, network))
    .slice(0, 12);

  const qualified: QualifiedCandidate[] = [];

  for (const entry of ranked) {
    const handle = extractHandle(entry.url, network);
    const meta = await validateProfileAlive(entry.url, network);
    if (!meta.alive) {
      await sleep(PROBE_DELAY_MS / 2);
      continue;
    }

    const rel = scoreBusinessRelevance(bn, handle, meta.title, loc);
    if (meetsAutoPickBar(entry.source, rel)) {
      qualified.push({ url: entry.url, source: entry.source, relevance: rel });
    }
    await sleep(PROBE_DELAY_MS / 2);
  }

  if (qualified.length === 0) return null;

  qualified.sort((a, b) => b.relevance.score - a.relevance.score);
  const best = qualified[0]!;
  const second = qualified[1];

  if (!second) return best.url;
  if (best.relevance.score - second.relevance.score >= MIN_PICK_MARGIN) return best.url;

  const trusted = qualified.filter((q) => q.source === "website" || q.source === "direct_probe");
  if (trusted.length === 1 && trusted[0]!.relevance.score >= best.relevance.score - 5) {
    return trusted[0]!.url;
  }

  return null;
}

export function entriesFromUrls(
  urls: string[],
  source: SocialCandidateSource,
): SocialCandidateEntry[] {
  return urls.map((url) => ({ url, source }));
}

/** Re-validate cached URLs with current relevance rules (drops stale bad picks like city pages). */
export async function isTrustedSocialUrlForLead(
  url: string,
  network: "facebook" | "instagram",
  businessName: string,
  location?: string,
): Promise<boolean> {
  const handle = extractHandle(url, network);
  if (!handle || !canonicalProfileUrl(url, network)) return false;
  const meta = await validateProfileAlive(url, network);
  if (!meta.alive) return false;
  const rel = scoreBusinessRelevance(businessName, handle, meta.title, location);
  return meetsAutoPickBar("serp", rel);
}
