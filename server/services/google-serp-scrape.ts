/**
 * Social discovery: optional business website first, Yahoo SERP (`search.yahoo.com`), then Playwright Chromium.
 * Regex extraction only — no cheerio.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Firefox UA — Yahoo/Bing-backed SERPs often serve thin shells to pure-Chrome user agents. */
export const SERP_FETCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";

/** @deprecated Use {@link SERP_FETCH_USER_AGENT}. */
export const BING_SERP_FETCH_USER_AGENT = SERP_FETCH_USER_AGENT;

const PAGE_TIMEOUT_MS = 12_000;
const SERP_DEBUG_SNIPPET_MAX = 6000;

/** First N URLs from SERP extraction (noise-filtered, deduped) for logs / API pairing with query. */
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

/** Yahoo wraps outbound clicks (`r.search.yahoo.com/.../RU=https%3a%2f%2f…`). */
export function unwrapYahooSerpRedirectUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  try {
    const u = new URL(s.startsWith("//") ? `https:${s}` : s);
    const host = u.hostname.toLowerCase();
    if (host !== "r.search.yahoo.com" && !host.endsWith(".search.yahoo.com")) return s;

    const ruUntilRk = u.pathname.match(/\/RU=(.+)\/RK=/i);
    if (ruUntilRk?.[1]) {
      try {
        const decoded = decodeURIComponent(ruUntilRk[1].replace(/\+/g, "%20"));
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch {
        /* ignore */
      }
    }
    const ruPath = u.pathname.match(/\/RU=([^/]+)/i);
    if (ruPath?.[1]) {
      try {
        const decoded = decodeURIComponent(ruPath[1].replace(/\+/g, "%20"));
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch {
        /* ignore */
      }
    }
    const ruQ = u.searchParams.get("RU");
    if (ruQ) {
      try {
        const decoded = decodeURIComponent(ruQ.replace(/\+/g, "%20"));
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* keep */
  }
  return s;
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

  for (const m of blob.matchAll(/https?:\/\/r\.search\.yahoo\.com[^"'\\s<>]{10,4000}/gi)) {
    const inner = unwrapYahooSerpRedirectUrl(m[0]!);
    if (inner !== m[0]) add(inner);
  }

  return out;
}

/** Normalize redirect wrappers (Google `/url`, Yahoo `r.search.yahoo.com` / `RU=`). */
export function extractSocialUrlsFromLinkList(urls: string[], kind: "facebook" | "instagram"): string[] {
  const { add, out } = makeCollector(kind);
  for (let raw of urls) {
    raw = unwrapYahooSerpRedirectUrl(raw.trim());
    if (!raw) continue;
    try {
      const u = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
      const host = u.hostname.toLowerCase();
      if (host.includes("google.") && u.pathname === "/url") {
        const q = u.searchParams.get("q") ?? u.searchParams.get("url");
        if (q) raw = decodeURIComponent(q.replace(/\+/g, "%20"));
      }
    } catch {
      /* keep raw */
    }
    add(raw);
  }
  return out;
}

/** Drop obvious SERP chrome / nav URLs before sampling. */
export function dropSerpNoiseUrls(urls: string[]): string[] {
  return urls
    .map((raw) => unwrapYahooSerpRedirectUrl(raw.trim()))
    .filter((u) => !isSerpUrlSampleNoise(u));
}

/** @deprecated Use {@link dropSerpNoiseUrls}. */
export const dropBingNoiseUrls = dropSerpNoiseUrls;

/**
 * Filters junk Playwright collects from **every** `<a href>` (nav bars, `javascript:`, Yahoo internal search links).
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
    const path = u.pathname.toLowerCase();
    if (host === "search.yahoo.com" && path.startsWith("/search")) return true;
    if ((host === "yahoo.com" || host.endsWith(".yahoo.com")) && (path === "/" || path === "")) return true;
  } catch {
    return true;
  }
  return false;
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

/** Plain facebook.com / instagram.com strings anywhere in the SERP HTML. */
function plainSocialUrlsFromFullSerp(html: string, network: "facebook" | "instagram"): string[] {
  const blob = html.replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  return collectFromHtmlBlob(blob, network);
}

/** Prefer Yahoo organic region in logs — the head is huge and hides whether extraction ran on results. */
function yahooSerpDebugSnippet(html: string): string {
  const markers = [/id=["']web["']/i, /searchCenterMiddle/i, /compTitle/i];
  for (const re of markers) {
    const m = re.exec(html);
    if (m?.index !== undefined) return html.slice(m.index, m.index + SERP_DEBUG_SNIPPET_MAX);
  }
  return html.slice(0, SERP_DEBUG_SNIPPET_MAX);
}

/**
 * First comma-separated segment often mixes business name + street; digits usually start the street
 * address ("Horizon Star Bakery 14000 Horizon Blvd"). Truncating before the first digit avoids SERPs
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
 * Text used for SERP queries: **business name only** when present (no street address).
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

  /** Prefer `site:` queries — organic results often lack facebook.com/instagram.com entirely. */
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

/** Yahoo Search (`p=` query param). */
export function yahooSearchUrlForQuery(query: string): string {
  const u = new URL("https://search.yahoo.com/search");
  u.searchParams.set("p", query);
  return u.toString();
}

export function serpSearchUrlForQuery(query: string): string {
  return yahooSearchUrlForQuery(query);
}

async function fetchYahooSearchHtml(query: string): Promise<{ html: string; status: number }> {
  const url = yahooSearchUrlForQuery(query);
  return fetchPageHtml(url, { userAgent: SERP_FETCH_USER_AGENT });
}

/** Regex-only extraction from Yahoo HTML (plain instagram.com / facebook.com in document). */
export function extractYahooSerpUrlsForSample(html: string, network: "facebook" | "instagram"): string[] {
  return dedupeUrlStrings(plainSocialUrlsFromFullSerp(html, network));
}

/** Yahoo SERP: rely on full-document social URL regex (same as embedded blob path). */
export function collectFromYahooHtml(html: string, kind: "facebook" | "instagram"): string[] {
  const fullBlob = html.replace(/&amp;/gi, "&").replace(/\\\//g, "/");
  const { add, out } = makeCollector(kind);
  for (const x of collectFromHtmlBlob(fullBlob, kind)) {
    add(x);
  }
  return out;
}

type EngineAttempt = {
  engine: "yahoo";
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
  fetchSource: "yahoo" | "none";
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
    const pageUrl = yahooSearchUrlForQuery(query);
    const { html: bHtml, status: bSt } = await fetchYahooSearchHtml(query);
    const bCand = collectFromYahooHtml(bHtml, network);
    attempts.push({ engine: "yahoo", query, status: bSt, candidateCount: bCand.length });
    lastHtml = bHtml;
    lastStatus = bSt;
    lastSearchUrl = pageUrl;
    if (bCand.length > 0) {
      winningQuery = query;
      /** Only this page’s links — merging across query variants mixed unrelated SERPs with the stem query label. */
      const serpUrlsRaw = extractYahooSerpUrlsForSample(bHtml, network);
      return {
        candidates: bCand,
        googleStatus,
        googleWasChallenge,
        fetchSource: "yahoo",
        htmlOut: bHtml,
        statusOut: bSt,
        searchUrl: pageUrl,
        attempts,
        winningQuery,
        serpUrlsRaw,
      };
    }
  }

  const serpUrlsRaw = extractYahooSerpUrlsForSample(lastHtml, network);

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
  fetchSource: "yahoo" | "website" | "mixed" | "playwright" | "none";
  googleWasChallenge: boolean;
  /** Winning SERP page URL when results came from Yahoo HTTP fetch (not Playwright-only). */
  serpSearchUrl?: string;
  websiteTried: boolean;
  websiteStatus?: number;
  engineAttempts?: EngineAttempt[];
  winningQuery?: string | null;
  /** URLs collected from Yahoo SERP HTML + Playwright (redirect-unwrapped; filtered to FB/IG hosts for samples). */
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
  let htmlSnippet = yahooSerpDebugSnippet(engine.htmlOut);

  let playwrightSerpUrls: string[] = [];

  /**
   * Plain HTTP often omits social URLs (JS-heavy SERP). Playwright loads Yahoo like a real browser.
   * For Facebook, also run when HTTP SERP returned zero candidates (merged may still be empty).
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

  let serpUrlPool = [...engine.serpUrlsRaw, ...playwrightSerpUrls].map(unwrapYahooSerpRedirectUrl);
  if (fetchSource === "playwright" && playwrightSerpUrls.length > 0) {
    serpUrlPool = playwrightSerpUrls.map(unwrapYahooSerpRedirectUrl);
  } else if (network === "facebook" && playwrightSerpUrls.length > 0) {
    serpUrlPool = playwrightSerpUrls.map(unwrapYahooSerpRedirectUrl);
  } else if (network === "instagram" && playwrightSerpUrls.length > 0) {
    serpUrlPool = playwrightSerpUrls.map(unwrapYahooSerpRedirectUrl);
  }

  let sampleUrls = dropSerpNoiseUrls(dedupeUrlStrings(serpUrlPool));

  const socialHostOk =
    network === "facebook"
      ? (u: string) => {
          try {
            const h = new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
            return h.includes("facebook.") || h.endsWith(".fb.com") || h === "fb.com";
          } catch {
            return false;
          }
        }
      : (u: string) => {
          try {
            return new URL(u).hostname.toLowerCase().includes("instagram.");
          } catch {
            return false;
          }
        };

  sampleUrls = sampleUrls.filter(socialHostOk);

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
    serpSearchUrl: fetchSource === "yahoo" ? engine.searchUrl : undefined,
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

/** Normalize and validate a social URL for persistence (unwrap Yahoo hops, strip hash, trim slash). */
function canonicalSocialProfileUrl(raw: string, network: "facebook" | "instagram"): string | null {
  const unwrapped = unwrapYahooSerpRedirectUrl(raw.trim());
  if (!unwrapped) return null;
  try {
    const url = new URL(unwrapped.startsWith("//") ? `https:${unwrapped}` : unwrapped);
    url.hash = "";
    let href = url.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return isLikelyProfileUrl(href, network) ? href : null;
  } catch {
    return null;
  }
}

/** Lower rank = pick first (prefer `/pagename` over `/posts/…`, `/p/…`, etc.). */
function serpSocialPathRank(url: string, network: "facebook" | "instagram"): number {
  try {
    const p = new URL(url).pathname.replace(/\/$/, "").toLowerCase();
    if (network === "facebook") {
      if (/\/(posts|videos|watch|reel|photo\.php|story\.php|share|dialog)/.test(p)) return 10;
      if (/^\/[^/]+$/.test(p)) return 0;
      return 5;
    }
    if (/\/(p|reel|tv|stories)\//.test(p)) return 10;
    if (/^\/[^/]+$/.test(p)) return 0;
    return 5;
  } catch {
    return 99;
  }
}

/**
 * Prefer the SERP sample order after unwrap + path ranking; validate with {@link isLikelyProfileUrl}
 * (not only {@link extractSocialUrlsFromLinkList}, which can skip edge-case URLs).
 */
export function pickFirstProfileUrlFromSerpUrls(
  urls: string[],
  network: "facebook" | "instagram",
): string | null {
  const cleaned = urls
    .filter((x): x is string => typeof x === "string")
    .map((x) => unwrapYahooSerpRedirectUrl(x.trim()))
    .filter(Boolean);

  const sorted = [...cleaned].sort((a, b) => serpSocialPathRank(a, network) - serpSocialPathRank(b, network));

  for (const raw of sorted) {
    const c = canonicalSocialProfileUrl(raw, network);
    if (c) return c;
  }

  for (const raw of sorted) {
    const got = extractSocialUrlsFromLinkList([raw], network);
    if (got[0]) return got[0]!;
  }

  return null;
}
