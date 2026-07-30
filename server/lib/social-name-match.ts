/**
 * Universal business name to social handle matching.
 * Every auto pick must prove relevance to the lead, not just that a valid profile exists.
 */

import { cityGuessFromLocation } from "@/server/lib/social-profile-url";

const LEGAL_SUFFIX =
  /\b(llc|l\.l\.c\.|inc|incorporated|co|company|corp|corporation|ltd|limited|pllc|lp|dba)\.?\b/gi;

/** Stripped from names before token extraction; not distinctive business identity. */
const NAME_STOPWORDS = new Set([
  "the",
  "and",
  "or",
  "a",
  "an",
  "of",
  "at",
  "in",
  "on",
  "for",
  "shop",
  "store",
  "more",
  "inc",
  "llc",
  "co",
  "corp",
  "company",
  "services",
  "service",
  "official",
  "usa",
  "us",
  "bar",
  "grill",
  "restaurant",
  "cafe",
  "coffee",
  "salon",
  "spa",
  "center",
  "centre",
  "group",
]);

/** Handles that are never a local business profile. */
const GENERIC_HANDLES = new Set([
  "facebook",
  "instagram",
  "meta",
  "explore",
  "pages",
  "people",
  "official",
  "contact",
  "info",
  "support",
  "help",
  "home",
  "events",
  "marketplace",
  "watch",
  "login",
]);

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripBusinessLegalSuffixes(name: string): string {
  return name
    .replace(LEGAL_SUFFIX, " ")
    .replace(/[''`]/g, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distinctive tokens from a business name (stopwords + legal junk removed). */
function significantBusinessTokens(businessName: string): string[] {
  const cleaned = stripBusinessLegalSuffixes(businessName).toLowerCase();
  const words = cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);

  const out: string[] = [];
  for (const w of words) {
    if (NAME_STOPWORDS.has(w)) continue;
    if (/^\d+$/.test(w) && w.length >= 2) {
      out.push(w);
      continue;
    }
    if (w.length >= 3) out.push(w);
  }
  return [...new Set(out)];
}

/** City/state slugs from a lead location; used to reject geo only false positives. */
function locationSlugTokens(location: string): string[] {
  const slugs: string[] = [];
  const city = cityGuessFromLocation(location);
  if (city) slugs.push(normalizeForMatch(city));

  for (const part of location.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const stateOnly = p.match(/^([A-Za-z]{2})(?:\s+\d{5}(-\d{4})?)?$/);
    if (stateOnly) {
      slugs.push(stateOnly[1]!.toLowerCase());
      continue;
    }
    if (/^\d/.test(p)) continue;
    const norm = normalizeForMatch(p);
    if (norm.length >= 3) slugs.push(norm);
  }

  return [...new Set(slugs.filter((s) => s.length >= 2))];
}

function tokenAppearsInBlob(token: string, blob: string): boolean {
  if (!token || !blob) return false;
  if (blob.includes(token)) return true;
  if (token.length >= 4 && token.endsWith("s") && blob.includes(token.slice(0, -1))) return true;
  if (token.length >= 5 && blob.includes(token.slice(0, 5))) return true;
  return false;
}

function isGeographicOrGenericHandle(handle: string, location?: string): boolean {
  const h = normalizeForMatch(handle);
  if (!h || h.length < 2) return true;
  if (GENERIC_HANDLES.has(h)) return true;
  if (/^[a-z]{2}$/.test(h)) return true;

  if (location?.trim()) {
    for (const slug of locationSlugTokens(location)) {
      if (h === slug) return true;
    }
  }
  return false;
}

export type BusinessRelevance = {
  score: number;
  tokensMatched: number;
  tokenTotal: number;
  handleTokenHits: number;
  titleTokenHits: number;
  geographicReject: boolean;
};

export function scoreBusinessRelevance(
  businessName: string,
  handle: string | null,
  profileTitle: string,
  location?: string,
): BusinessRelevance {
  const tokens = significantBusinessTokens(businessName);
  const tokenTotal = tokens.length;
  const hNorm = handle ? normalizeForMatch(handle) : "";
  const titleNorm = normalizeForMatch(profileTitle);

  if (handle && isGeographicOrGenericHandle(handle, location)) {
    return {
      score: 0,
      tokensMatched: 0,
      tokenTotal,
      handleTokenHits: 0,
      titleTokenHits: 0,
      geographicReject: true,
    };
  }

  let handleTokenHits = 0;
  let titleTokenHits = 0;
  for (const token of tokens) {
    if (tokenAppearsInBlob(token, hNorm)) handleTokenHits++;
    if (tokenAppearsInBlob(token, titleNorm)) titleTokenHits++;
  }

  const tokensMatched = tokens.filter(
    (t) => tokenAppearsInBlob(t, hNorm) || tokenAppearsInBlob(t, titleNorm),
  ).length;

  let score = handleTokenHits * 28 + titleTokenHits * 14;
  if (tokenTotal > 0 && handleTokenHits === tokenTotal) score += 35;
  else if (tokenTotal > 0 && tokensMatched === tokenTotal) score += 18;

  if (handleTokenHits === 0 && tokensMatched === 0) score = 0;

  return {
    score,
    tokensMatched,
    tokenTotal,
    handleTokenHits,
    titleTokenHits,
    geographicReject: false,
  };
}

/**
 * Auto pick bar for SERP candidates. Needs business tokens in the handle or title;
 * a city page or unrelated brand must not pass on location alone.
 */
export function meetsAutoPickBar(rel: BusinessRelevance): boolean {
  if (rel.geographicReject || rel.tokensMatched === 0) return false;
  if (rel.handleTokenHits === 0 && rel.titleTokenHits === 0) return false;
  if (rel.tokenTotal <= 1) return rel.tokensMatched >= 1;
  return (
    rel.handleTokenHits >= 2 ||
    (rel.handleTokenHits >= 1 && rel.titleTokenHits >= 1) ||
    (rel.titleTokenHits >= 2 && rel.tokensMatched >= 2)
  );
}
