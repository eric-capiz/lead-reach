/**
 * Social discovery: optional business website first, Bing SERP, then Playwright Bing.
 * Regex extraction only — no cheerio.
 */

import { Buffer } from "node:buffer";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Bing returns an AJAX-only shell (no organic results) to Chrome-like UAs; Firefox + ajaxserp=0 gets server-rendered SERP HTML. */
export const BING_SERP_FETCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";

const PAGE_TIMEOUT_MS = 12_000;
const BING_SERP_DEBUG_SNIPPET_MAX = 6000;

/** First N URLs from merged Bing SERP extraction (noise-filtered, deduped) for logs / API pairing with query. */
export const SERP_URL_SAMPLE_MAX = 5;

function decodeQ(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, "%20"));
  } catch {
    return raw;
  }
}

function normalizeUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u.startsWith("http")) return null;
  u = u.split(/["'\\s<&]/)[0] ?? u;
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t || /^no website$/i.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function unwrapFbRedirect(url: string): string {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (h === "l.facebook.com" || h === "lm.facebook.com") {
      const uu = u.searchParams.get("u");
      if (uu) return unwrapFbRedirect(decodeURIComponent(uu));
    }
  } catch {
    /* ignore */
  }
  return url;
}

function facebookHostOk(host: string): boolean {
  const h = host.replace(/^www\./i, "").toLowerCase();
  if (h === "fb.com" || h.endsWith(".fb.com")) return true;
  if (h === "facebook.com" || h.endsWith(".facebook.com")) {
    if (h.startsWith("static.") || h.includes("fbcdn")) return false;
    return true;
  }
  return false;
}

function looseFacebookOk(url: string): boolean {
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

function looseInstagramOk(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (h !== "instagram.com" && !h.endsWith(".instagram.com")) return false;
    return u.pathname.replace(/\/$/, "").length > 1;
  } catch {
    return false;
  }
}

function makeCollector(kind: "facebook" | "instagram") {
  const ok = kind === "facebook" ? looseFacebookOk : looseInstagramOk;
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const t = unwrapFbRedirect(raw.trim().split(/["'\\s<]/)[0] ?? raw);
    const n = normalizeUrl(t);
    if (!n) return;
    const f = normalizeUrl(unwrapFbRedirect(n)) ?? n;
    if (!ok(f)) return;
    if (seen.has(f)) return;
    seen.add(f);
    out.push(f);
  };

  return { add, out };
}

export function collectFromHtmlBlob(blob: string, kind: "facebook" | "instagram"): string[] {
  const { add, out } = makeCollector(kind);

  for (const m of blob.matchAll(/\/url\?q=([^&"'<>]+)/g)) {
    const dec = normalizeUrl(decodeQ(m[1]!));
    if (dec) add(dec);
  }
  for (const m of blob.matchAll(/[?&]url=([^&"'<>\s]+)/gi)) {
    let v = m[1]!;
    try {
      v = decodeURIComponent(v.replace(/\+/g, "%20"));
    } catch {
      continue;
    }
    const dec = normalizeUrl(v);
    if (dec) add(dec);
  }
  for (const m of blob.matchAll(/[?&]uddg=([^&"'<>\s]+)/gi)) {
    let v = m[1]!;
    try {
      v = decodeURIComponent(v);
    } catch {
      continue;
    }
    const dec = normalizeUrl(v);
    if (dec) add(dec);
  }
  if (kind === "facebook") {
    for (const m of blob.matchAll(/https?:\/\/(?:[\w-]+\.)?(?:facebook\.com|fb\.com)\/[^"'\\s<>]{2,500}/gi)) {
      add(m[0]!);
    }
  } else {
    for (const m of blob.matchAll(/https?:\/\/(?:[\w-]+\.)?instagram\.com\/[^"'\\s<>]{2,500}/gi)) {
      add(m[0]!);
    }
  }

  return out;
}

/** Normalize redirect wrappers (Google /url, Bing /ck/a) then apply the same filters as HTML extraction. */
export function extractSocialUrlsFromLinkList(urls: string[], kind: "facebook" | "instagram"): string[] {
  const { add, out } = makeCollector(kind);
  for (let raw of urls) {
    raw = raw.trim();
    if (!raw) continue;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      if (host.includes("google.") && u.pathname === "/url") {
        const q = u.searchParams.get("q") ?? u.searchParams.get("url");
        if (q) raw = decodeURIComponent(q.replace(/\+/g, "%20"));
      }
      if (host.includes("bing.com") && u.pathname.includes("/ck/a")) {
        const decoded = decodeBingCkHref(u.toString());
        if (decoded) raw = decoded;
      }
    } catch {
      /* keep raw */
    }
    add(raw);
  }
  return out;
}

/**
 * After base64 decode, Bing `u` is either a full `https://…` or a **path-only** internal link
 * like `/images/search?q=…`, `/videos/search?q=…` (vertical search tabs). Resolve the latter so
 * `isBingNoiseUrl` can drop them instead of leaving raw `/ck/a` wrappers in the sample.
 */
function normalizeDecodedBingU(decoded: string): string | null {
  const t = decoded.trim();
  if (t.startsWith("https://") || t.startsWith("http://")) return t;
  if (t.startsWith("//")) return `https:${t}`;
  if (t.startsWith("/")) {
    try {
      return new URL(t, "https://www.bing.com/").href;
    } catch {
      return null;
    }
  }
  return null;
}

function decodeBingCkHref(rawHref: string): string | null {
  const href = rawHref.replace(/&amp;/gi, "&");
  /** Bing uses `u=<base64("https://...")>`; newer SERPs prefix with `a1` → full value `a1aHR0cHM6...`. */
  const uMatch = href.match(/[?&]u=([^&]+)/);
  if (!uMatch) return null;

  const tryDecodeB64 = (raw: string): string | null => {
    try {
      let b64 = raw;
      const pad = b64.length % 4;
      if (pad) b64 += "=".repeat(4 - pad);
      const inner = Buffer.from(b64, "base64").toString("utf8");
      return normalizeDecodedBingU(inner);
    } catch {
      return null;
    }
  };

  try {
    let payload = decodeURIComponent(uMatch[1]!.replace(/\+/g, "%20"));
    let out = tryDecodeB64(payload);
    if (out) return out;
    const stripped = payload.replace(/^a\d+/, "");
    if (stripped !== payload) {
      out = tryDecodeB64(stripped);
      if (out) return out;
    }
    return null;
  } catch {
    return null;
  }
}

/** Bing SERP pages link to `/search`, `/images`, CDN assets, etc. Drop those from raw URL dumps. */
export function dropBingNoiseUrls(urls: string[]): string[] {
  return urls.filter((raw) => !isSerpUrlSampleNoise(raw));
}

/**
 * Filters junk Playwright collects from **every** `<a href>` (logo, `bing.com/#`, `?FORM=`, `javascript:`).
 * Not an encoding issue — manual Bing uses the same `q=`; automation just surfaces nav links first.
 */
export function isSerpUrlSampleNoise(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  const low = t.toLowerCase();
  if (low.startsWith("javascript:")) return true;
  if (low.startsWith("mailto:")) return true;
  if (low.startsWith("tel:")) return true;
  if (low.startsWith("data:")) return true;
  try {
    const u = new URL(t.startsWith("//") ? `https:${t}` : t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    /**
     * Playwright dumps raw `href`s (`bing.com/ck/a?…`). Those never matched `/images` pathname checks.
     * Decode `u=` → `/images/search`, videos tab, etc., then apply the same Bing-internal noise rules.
     */
    if (host.endsWith("bing.com") && u.pathname.toLowerCase().includes("/ck/a")) {
      const decoded = decodeBingCkHref(t);
      if (!decoded) return true;
      return isBingNoiseUrl(decoded);
    }
  } catch {
    return true;
  }
  return isBingNoiseUrl(t);
}

function isBingNoiseUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  try {
    const u = new URL(t.startsWith("//") ? `https:${t}` : t);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "r.bing.com" || host === "th.bing.com" || host === "sr.bing.com") return true;
    if (!host.endsWith("bing.com")) return false;
    const path = u.pathname.toLowerCase();
    /** Logo / footer / `bing.com/#` / `bing.com/?FORM=…` — not result URLs. */
    if (path === "/" || path === "") return true;
    if (path === "/search" || path.startsWith("/search/")) return true;
    if (path.startsWith("/copilotsearch")) return true;
    /** Vertical SERP tabs (incl. `/travel/search` flights — same encoded `/ck/a` pattern as images/videos). */
    if (/^\/(images|videos|news|maps|shop|chat|travel)(\/|$)/i.test(path)) return true;
    if (path.startsWith("/fd/") || path.startsWith("/profile/history")) return true;
    return false;
  } catch {
    return false;
  }
}

/** Prefer `#b_results` so header &lt;h2&gt; nav links (often same `/search?q=…`) are not scraped as results. */
function sliceBingOrganicRegion(html: string): string {
  const m = /id=["']b_results["']/i.exec(html);
  if (!m || m.index === undefined) return html;
  const start = m.index;
  const tail = html.slice(start, start + 1_200_000);
  const endProbe = /<(?:div|aside|section)[^>]*\bid=["']b_(?:context|sidebar)/i.exec(tail);
  const endIdx = endProbe && endProbe.index !== undefined && endProbe.index > 400 ? endProbe.index : tail.length;
  return tail.slice(0, endIdx);
}

function dedupeUrlStrings(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const u = raw.trim();
    if (!u) continue;
    let key = u;
    try {
      const url = new URL(u.startsWith("//") ? `https:${u}` : u);
      url.hash = "";
      key = url.href.replace(/\/$/, "");
    } catch {
      /* keep raw */
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.startsWith("//") ? `https:${u}` : u);
  }
  return out;
}

/** Full-document plain facebook.com / instagram.com strings (Copilot / pole often outside `#b_results`). */
function plainSocialUrlsFromFullSerp(html: string, network: "facebook" | "instagram"): string[] {
  const blob = html.replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  return collectFromHtmlBlob(blob, network);
}

/** Every destination URL found in Bing SERP HTML (decoded ck/a + visible hrefs), before FB/IG filtering. */
export function extractAllUrlsFromBingHtml(
  html: string,
  network?: "facebook" | "instagram",
): string[] {
  const scoped = sliceBingOrganicRegion(html);
  const blob = scoped.replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  const found: string[] = [];

  const pushRaw = (hrefRaw: string) => {
    let h = hrefRaw.trim();
    if (!h) return;
    if (h.startsWith("/ck/a")) h = `https://www.bing.com${h}`;
    if (h.startsWith("//")) h = `https:${h}`;
    if (h.startsWith("/") && !h.startsWith("//") && h.includes("bing.com") === false) {
      try {
        h = new URL(h, "https://www.bing.com/").href;
      } catch {
        /* keep */
      }
    }
    const decoded =
      h.includes("bing.com") && h.includes("/ck/a") ? decodeBingCkHref(h) : null;
    const target = decoded ?? (h.startsWith("http") ? h : null);
    if (!target || isBingNoiseUrl(target)) return;
    found.push(target);
  };

  for (const m of blob.matchAll(/https?:\/\/(?:www\.)?bing\.com\/ck\/a\?[^\s"'<>]+/gi)) pushRaw(m[0]!);
  for (const m of blob.matchAll(/\/ck\/a\?[^\s"'<>]+/gi)) pushRaw(m[0]!);
  for (const m of blob.matchAll(/<h2[^>]*>\s*<a[^>]+href=(["'])([^"']+)\1/gi)) pushRaw(m[2]!);
  for (const m of blob.matchAll(/class=["']tilk["'][^>]*href=(["'])([^"']+)\1/gi)) pushRaw(m[2]!);
  for (const m of blob.matchAll(/<cite[^>]*>\s*<a[^>]+href=(["'])([^"']+)\1/gi)) pushRaw(m[2]!);

  const plainFirst = network ? plainSocialUrlsFromFullSerp(html, network) : [];
  return dedupeUrlStrings([...plainFirst, ...found]);
}

export function collectFromBingHtml(html: string, kind: "facebook" | "instagram"): string[] {
  const fullBlob = html.replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  const scoped = sliceBingOrganicRegion(html);
  const blob = scoped.replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  const { add, out } = makeCollector(kind);

  /** Copilot / rich answers often sit outside `#b_results`; scan the full HTML first so real profiles beat generic “Horizon” web hits. */
  for (const x of collectFromHtmlBlob(fullBlob, kind)) {
    add(x);
  }

  const absorbCk = (hrefRaw: string) => {
    let h = hrefRaw.trim();
    if (h.startsWith("/ck/a")) h = `https://www.bing.com${h}`;
    if (h.startsWith("//")) h = `https:${h}`;
    const target = decodeBingCkHref(h);
    if (target) add(target);
  };

  // Absolute ck/a (Playwright sometimes emits protocol-relative or www-less hosts).
  for (const m of blob.matchAll(/https?:\/\/(?:www\.)?bing\.com\/ck\/a\?[^\s"'<>]+/gi)) {
    absorbCk(m[0]!);
  }
  // Relative ck/a in raw HTML (common in DOM snapshots).
  for (const m of blob.matchAll(/\/ck\/a\?[^\s"'<>]+/gi)) {
    absorbCk(m[0]!);
  }

  for (const m of blob.matchAll(/<h2[^>]*>\s*<a[^>]+href=(["'])([^"']+)\1/gi)) {
    const href = m[2]!;
    if (href.includes("/ck/a")) {
      absorbCk(href);
    } else if (href.startsWith("http") || href.startsWith("//")) {
      add(href.startsWith("//") ? `https:${href}` : href);
    }
  }

  return out;
}

/** SERP URL that returns HTML with organic listings for server-side fetch (see BING_SERP_FETCH_USER_AGENT). */
export function bingSearchUrlForQuery(query: string): string {
  const u = new URL("https://www.bing.com/search");
  u.searchParams.set("q", query);
  u.searchParams.set("count", "10");
  u.searchParams.set("ajaxserp", "0");
  return u.toString();
}

/** Prefer `#b_results` in logs — the head is huge and hides whether extraction ran on organic links. */
function bingSerpDebugSnippet(html: string): string {
  const marker = /id=["']b_results["']/i;
  const m = marker.exec(html);
  if (m && m.index !== undefined) {
    return html.slice(m.index, m.index + BING_SERP_DEBUG_SNIPPET_MAX);
  }
  return html.slice(0, BING_SERP_DEBUG_SNIPPET_MAX);
}

/**
 * First comma-separated segment often mixes business name + street; digits usually start the street
 * address ("Horizon Star Bakery 14000 Horizon Blvd"). Truncating before the first digit avoids Bing
 * matching street tokens like "Horizon" to unrelated brands.
 */
function businessNameGuessFromBase(base: string): string {
  const beforeComma = base.split(",")[0]?.trim() ?? base;
  const digitIdx = beforeComma.search(/\d/);
  if (digitIdx <= 0) return beforeComma.trim();
  return beforeComma.slice(0, digitIdx).trim();
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

/**
 * Text used for Bing keyword queries: **business name only** when present (no street address).
 * If the name is missing/too short, falls back to a city guess or the trimmed location string.
 */
export function socialSearchStem(businessName: string, location: string): string | null {
  const bn = businessName.trim();
  if (bn.length >= 2) return bn;
  const loc = location.trim();
  if (!loc) return null;
  const city = cityGuessFromLocation(loc);
  return city ?? loc;
}

function searchQueriesForBase(base: string, network: "facebook" | "instagram"): string[] {
  const kw = network === "facebook" ? "facebook" : "instagram";
  const site = network === "facebook" ? "site:facebook.com" : "site:instagram.com";
  const primary = `${base} ${kw}`;
  const words = base.trim().split(/\s+/).filter(Boolean);
  const shortened = words.length > 10 ? `${words.slice(0, 8).join(" ")} ${kw}` : primary;
  const comma = base.split(",").map((s) => s.trim()).filter(Boolean);
  let compact = primary;
  if (comma.length >= 2) {
    const rest = comma[1]!.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
    compact = `${comma[0]!} ${rest} ${kw}`.replace(/\s+/g, " ").trim();
  }

  const nameGuess = businessNameGuessFromBase(base);
  const cityTail =
    comma.length >= 2
      ? comma
          .slice(1)
          .join(" ")
          .replace(/\b\d{5}(-\d{4})?\b/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : "";

  /** Prefer Bing `site:` queries — organic results often lack facebook.com/instagram.com entirely. */
  const siteNameCity =
    nameGuess.length >= 3 && cityTail.length >= 2
      ? `${site} ${nameGuess} ${cityTail}`
      : nameGuess.length >= 3
        ? `${site} ${nameGuess}`
        : null;

  /** `base` is expected to be business-name-only (+ optional light context) — do not append full street addresses here. */
  const siteFull = `${site} ${base}`;
  const ordered = [
    ...(siteNameCity ? [siteNameCity] : []),
    siteFull,
    primary,
    shortened,
    compact,
  ];

  return [...new Set(ordered.filter((q) => q.length > kw.length + 1))];
}

/** Prefer structured name + city from the lead — **name-only site:** queries first (no street address). */
function hintedSiteQueries(
  network: "facebook" | "instagram",
  businessName?: string,
  location?: string,
): string[] {
  const site = network === "facebook" ? "site:facebook.com" : "site:instagram.com";
  const bn = businessName?.replace(/\s+/g, " ").trim();
  const city = location ? cityGuessFromLocation(location) : null;
  const out: string[] = [];
  if (!bn || bn.length < 2) return out;

  out.push(`${site} "${bn}"`, `${site} ${bn}`);
  if (city && city.length >= 2) {
    out.push(`${site} "${bn}" ${city}`, `${site} ${bn} ${city}`);
  }
  return out;
}

function buildSocialSearchQueries(
  base: string,
  network: "facebook" | "instagram",
  hints?: { businessName?: string; location?: string },
): string[] {
  const hinted = hintedSiteQueries(network, hints?.businessName, hints?.location);
  const fallback = searchQueriesForBase(base, network);
  return [...new Set([...hinted, ...fallback])];
}

async function fetchPageHtml(
  url: string,
  opts?: { userAgent?: string },
): Promise<{ html: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
  const userAgent = opts?.userAgent ?? UA;
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    return { html: await res.text(), status: res.status };
  } catch {
    return { html: "", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Pause between two Bing GETs — first HTML is often wrong; second mirrors a browser refresh. */
const BING_SERP_REFRESH_GAP_MS = 750;

async function fetchBingSearchHtml(query: string): Promise<{ html: string; status: number }> {
  const url = bingSearchUrlForQuery(query);
  const ua = BING_SERP_FETCH_USER_AGENT;
  /** Bing commonly serves junk/reordered organic hits on first paint; manual refresh fixes it — fetch twice. */
  await fetchPageHtml(url, { userAgent: ua });
  await new Promise<void>((r) => setTimeout(r, BING_SERP_REFRESH_GAP_MS));
  return fetchPageHtml(url, { userAgent: ua });
}

type EngineAttempt = {
  engine: "bing";
  query: string;
  status: number;
  candidateCount: number;
};

async function collectFromSearchEngines(
  queries: string[],
  network: "facebook" | "instagram",
): Promise<{
  candidates: string[];
  googleStatus: number;
  googleWasChallenge: boolean;
  fetchSource: "bing" | "none";
  htmlOut: string;
  statusOut: number;
  searchUrl: string;
  attempts: EngineAttempt[];
  winningQuery: string | null;
  serpUrlsRaw: string[];
}> {
  const attempts: EngineAttempt[] = [];
  const googleStatus = 0;
  const googleWasChallenge = false;
  let lastHtml = "";
  let lastStatus = 0;
  let lastSearchUrl = "";
  let winningQuery: string | null = null;

  for (const query of queries) {
    const bUrl = bingSearchUrlForQuery(query);
    const { html: bHtml, status: bSt } = await fetchBingSearchHtml(query);
    const bCand = collectFromBingHtml(bHtml, network);
    attempts.push({ engine: "bing", query, status: bSt, candidateCount: bCand.length });
    lastHtml = bHtml;
    lastStatus = bSt;
    lastSearchUrl = bUrl;
    if (bCand.length > 0) {
      winningQuery = query;
      /** Only this page’s links — merging across query variants mixed unrelated SERPs with the stem query label. */
      const serpUrlsRaw = extractAllUrlsFromBingHtml(bHtml, network);
      return {
        candidates: bCand,
        googleStatus,
        googleWasChallenge,
        fetchSource: "bing",
        htmlOut: bHtml,
        statusOut: bSt,
        searchUrl: bUrl,
        attempts,
        winningQuery,
        serpUrlsRaw,
      };
    }
  }

  const serpUrlsRaw = extractAllUrlsFromBingHtml(lastHtml, network);

  return {
    candidates: [],
    googleStatus,
    googleWasChallenge,
    fetchSource: "none",
    htmlOut: lastHtml,
    statusOut: lastStatus,
    searchUrl: lastSearchUrl,
    attempts,
    winningQuery,
    serpUrlsRaw,
  };
}

export type SocialScrapeFetchResult = {
  candidates: string[];
  googleStatus: number;
  htmlLength: number;
  htmlSnippet: string;
  searchUrl: string;
  fetchSource: "bing" | "website" | "mixed" | "playwright" | "none";
  googleWasChallenge: boolean;
  bingSearchUrl?: string;
  websiteTried: boolean;
  websiteStatus?: number;
  engineAttempts?: EngineAttempt[];
  winningQuery?: string | null;
  /** Unfiltered URLs collected from Bing HTML + Playwright page (decoded redirects and anchor hrefs). */
  urlsFromSearchResults: string[];
};

export async function fetchSocialCandidatesForQuery(
  query: string,
  network: "facebook" | "instagram",
  options?: {
    websiteUri?: string | null;
    /** When set (from the lead), searches avoid ambiguous street tokens in the address line. */
    businessName?: string | null;
    location?: string | null;
  },
): Promise<SocialScrapeFetchResult> {
  const normalizedSite = normalizeWebsiteUrl(options?.websiteUri);
  const fromWebsite: string[] = [];
  let websiteStatus: number | undefined;

  if (normalizedSite) {
    const { html, status } = await fetchPageHtml(normalizedSite);
    websiteStatus = status;
    if (html.length > 0) {
      for (const c of collectFromHtmlBlob(html.replace(/&amp;/gi, "&"), network)) {
        if (!fromWebsite.includes(c)) fromWebsite.push(c);
      }
    }
  }

  const baseForAlts = query.replace(/\s+facebook\s*$/i, "").replace(/\s+instagram\s*$/i, "").trim();
  const queries = buildSocialSearchQueries(baseForAlts || query, network, {
    businessName: options?.businessName ?? undefined,
    location: options?.location ?? undefined,
  });

  const engine = await collectFromSearchEngines(queries, network);

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const c of [...fromWebsite, ...engine.candidates]) {
    if (seen.has(c)) continue;
    seen.add(c);
    merged.push(c);
  }

  let fetchSource: SocialScrapeFetchResult["fetchSource"] = engine.fetchSource;
  if (fromWebsite.length > 0 && engine.candidates.length > 0) fetchSource = "mixed";
  else if (fromWebsite.length > 0 && engine.candidates.length === 0) fetchSource = "website";

  let winningQ: string | null = engine.winningQuery;
  let htmlOutLen = engine.htmlOut.length;
  let searchUrlOut = engine.searchUrl;
  let htmlSnippet = bingSerpDebugSnippet(engine.htmlOut);

  let playwrightSerpUrls: string[] = [];

  /**
   * Plain HTTP Bing often has **no** `facebook.com` in HTML (Copilot/answers are JS); Playwright sees the real SERP.
   * If the lead’s website already contributed a Facebook URL, `merged` was non‑empty and we **skipped** Playwright —
   * leaving only junk `/ck/a` decoding from HTTP. Always run Playwright when the Bing engine found zero FB hits.
   */
  const runPlaywright =
    merged.length === 0 || (network === "facebook" && engine.candidates.length === 0);

  if (runPlaywright) {
    const { browserHarvestSocialCandidates } = await import("@/server/services/social-browser");
    const { candidates: br, pageUrls } = await browserHarvestSocialCandidates(queries, network);
    playwrightSerpUrls = pageUrls;
    if (br.length > 0) {
      for (const c of br) {
        if (seen.has(c)) continue;
        seen.add(c);
        merged.push(c);
      }
      if (fromWebsite.length > 0) fetchSource = "mixed";
      else if (engine.candidates.length > 0) fetchSource = "mixed";
      else fetchSource = "playwright";
      winningQ = winningQ ?? queries[0] ?? null;
      htmlOutLen = 0;
      searchUrlOut = "playwright:chromium";
      htmlSnippet = "playwright";
    }
  }

  let serpUrlPool = [...engine.serpUrlsRaw, ...playwrightSerpUrls];
  if (fetchSource === "playwright" && playwrightSerpUrls.length > 0) {
    /** HTTP Bing already failed; don’t mix last failed SERP HTML with the Chromium Bing page. */
    serpUrlPool = playwrightSerpUrls;
  } else if (network === "facebook" && playwrightSerpUrls.length > 0) {
    /** Chromium Copilot row usually has the Page link; raw HTTP HTML often does not. */
    serpUrlPool = playwrightSerpUrls;
  }
  let sampleUrls = dropBingNoiseUrls(dedupeUrlStrings(serpUrlPool));
  /** Same scraper for IG/FB; Bing’s web column for “… facebook” is far noisier than “… instagram”. Float real hosts first. */
  if (network === "facebook") {
    const pri = sampleUrls.filter((u) => /facebook\.com|fb\.com/i.test(u));
    const rest = sampleUrls.filter((u) => !/facebook\.com|fb\.com/i.test(u));
    sampleUrls = [...pri, ...rest];
  } else {
    const pri = sampleUrls.filter((u) => /instagram\.com/i.test(u));
    const rest = sampleUrls.filter((u) => !/instagram\.com/i.test(u));
    sampleUrls = [...pri, ...rest];
  }
  const urlsFromSearchResults = sampleUrls.slice(0, SERP_URL_SAMPLE_MAX);

  return {
    candidates: merged,
    googleStatus: engine.googleStatus,
    htmlLength: htmlOutLen,
    htmlSnippet,
    searchUrl: searchUrlOut,
    fetchSource,
    googleWasChallenge: engine.googleWasChallenge,
    bingSearchUrl: fetchSource === "bing" ? engine.searchUrl : undefined,
    websiteTried: !!normalizedSite,
    websiteStatus,
    engineAttempts: engine.attempts,
    winningQuery: winningQ,
    urlsFromSearchResults,
  };
}

export function pickBestSocialCandidate(
  candidates: string[],
  _businessName?: string,
  _location?: string,
  _kind?: "facebook" | "instagram",
): string | null {
  return candidates[0] ?? null;
}

export function isLikelyProfileUrl(url: string, kind: "facebook" | "instagram"): boolean {
  return kind === "facebook" ? looseFacebookOk(url) : looseInstagramOk(url);
}
