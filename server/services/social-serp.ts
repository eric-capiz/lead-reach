/**
 * Separate Facebook vs Instagram SERP harvest.
 * Primary: DuckDuckGo + Brave HTTP.
 * Fallback: Playwright on DuckDuckGo / Brave / Bing (system Chrome preferred).
 */

import { cityGuessFromLocation, isLikelyProfileUrl } from "@/server/lib/social-profile-url";
import { launchSocialBrowser, SOCIAL_BROWSER_UA } from "@/server/services/social-playwright";
import type { Browser } from "playwright";

const SERP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";
const PAGE_TIMEOUT_MS = 12_000;
const PLAYWRIGHT_NAV_MS = 40_000;

export type SocialNetwork = "facebook" | "instagram";

export type SerpHarvestResult = {
  urls: string[];
  queries: string[];
  winningQuery: string | null;
  sources: string[];
  searchUrl: string | null;
};

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
  u = u.split(/["'\s<&]/)[0] ?? u;
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
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

/** Pull profile URLs from HTML / href dumps for ONE network only. */
function collectSocialUrls(blob: string, network: SocialNetwork): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    let t = unwrapFbRedirect(raw.trim().split(/["'\s<]/)[0] ?? raw);
    try {
      t = decodeURIComponent(t);
    } catch {
      /* keep */
    }
    const n = normalizeUrl(t);
    if (!n || !isLikelyProfileUrl(n, network)) return;
    if (seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  const html = blob.replace(/&amp;/gi, "&").replace(/\\\//g, "/");

  for (const m of html.matchAll(/\/url\?q=([^&"'<>]+)/g)) {
    const dec = normalizeUrl(decodeQ(m[1]!));
    if (dec) add(dec);
  }
  for (const m of html.matchAll(/[?&]uddg=([^&"'<>\s]+)/gi)) {
    try {
      const dec = normalizeUrl(decodeURIComponent(m[1]!));
      if (dec) add(dec);
    } catch {
      /* skip */
    }
  }
  for (const m of html.matchAll(/[?&]url=([^&"'<>\s]+)/gi)) {
    try {
      const dec = normalizeUrl(decodeURIComponent(m[1]!.replace(/\+/g, "%20")));
      if (dec) add(dec);
    } catch {
      /* skip */
    }
  }

  if (network === "facebook") {
    for (const m of html.matchAll(/https?:\/\/(?:[\w-]+\.)?(?:facebook\.com|fb\.com)\/[^"'\s<>]{2,500}/gi)) {
      add(m[0]!);
    }
  } else {
    for (const m of html.matchAll(/https?:\/\/(?:[\w-]+\.)?instagram\.com\/[^"'\s<>]{2,500}/gi)) {
      add(m[0]!);
    }
    for (const m of html.matchAll(/(?:^|[^a-z0-9])instagram\.com\/([A-Za-z0-9._]{2,30})(?:[^A-Za-z0-9._]|$)/gi)) {
      add(`https://www.instagram.com/${m[1]}`);
    }
  }

  return out;
}

async function fetchHtml(url: string, userAgent = SERP_UA): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS);
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
    if (!res.ok) {
      console.warn(`[social-serp] HTTP ${res.status} for ${url.slice(0, 120)}`);
      return "";
    }
    return await res.text();
  } catch (e) {
    console.warn(
      `[social-serp] fetch failed ${url.slice(0, 80)}:`,
      e instanceof Error ? e.message : e,
    );
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export function socialSearchStem(businessName: string, location: string): string | null {
  const bn = businessName.trim();
  if (bn.length >= 2) return bn;
  const loc = location.trim();
  if (!loc) return null;
  return cityGuessFromLocation(loc) ?? loc;
}

/** Facebook only. City plus name first for precision. */
function buildFacebookQueries(opts: {
  businessName: string;
  location?: string;
  phone?: string;
}): string[] {
  const name = opts.businessName.trim();
  if (name.length < 2) return [];
  const city = opts.location?.trim() ? cityGuessFromLocation(opts.location) : null;
  const phone = (opts.phone ?? "").replace(/[^\d+]/g, "").trim();
  const q: string[] = [];
  if (city && city.length >= 2) {
    q.push(`${name} ${city} facebook`);
    q.push(`"${name}" ${city} facebook`);
    q.push(`site:facebook.com "${name}" ${city}`);
  }
  q.push(`${name} facebook`);
  q.push(`"${name}" facebook`);
  q.push(`site:facebook.com "${name}"`);
  q.push(`site:facebook.com ${name}`);
  if (phone.length >= 10) q.push(`${phone} facebook`);
  return [...new Set(q)];
}

/** Instagram only. City plus name first for precision. */
function buildInstagramQueries(opts: {
  businessName: string;
  location?: string;
  phone?: string;
}): string[] {
  const name = opts.businessName.trim();
  if (name.length < 2) return [];
  const city = opts.location?.trim() ? cityGuessFromLocation(opts.location) : null;
  const phone = (opts.phone ?? "").replace(/[^\d+]/g, "").trim();
  const q: string[] = [];
  if (city && city.length >= 2) {
    q.push(`${name} ${city} instagram`);
    q.push(`"${name}" ${city} instagram`);
    q.push(`site:instagram.com "${name}" ${city}`);
    q.push(`"${name}" ${city} site:instagram.com`);
  }
  q.push(`${name} instagram`);
  q.push(`"${name}" instagram`);
  q.push(`site:instagram.com "${name}"`);
  q.push(`site:instagram.com ${name}`);
  if (phone.length >= 10) {
    q.push(`${phone} instagram`);
    q.push(`"${name}" ${phone} instagram`);
  }
  return [...new Set(q)];
}

function buildSerpQueries(opts: {
  businessName: string;
  location?: string;
  phone?: string;
  network: SocialNetwork;
}): string[] {
  return opts.network === "instagram"
    ? buildInstagramQueries(opts)
    : buildFacebookQueries(opts);
}

function duckDuckGoSearchUrl(query: string): string {
  const u = new URL("https://html.duckduckgo.com/html/");
  u.searchParams.set("q", query);
  return u.toString();
}

function braveSearchUrl(query: string): string {
  const u = new URL("https://search.brave.com/search");
  u.searchParams.set("q", query);
  return u.toString();
}

function bingSearchUrl(query: string): string {
  const u = new URL("https://www.bing.com/search");
  u.searchParams.set("q", query);
  return u.toString();
}

/** Display URL for debug UI (DuckDuckGo). */
export function serpSearchUrlForQuery(query: string): string {
  return duckDuckGoSearchUrl(query);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function playwrightHarvestOne(
  browser: Browser,
  targetUrl: string,
  network: SocialNetwork,
): Promise<string[]> {
  const context = await browser.newContext({ userAgent: SOCIAL_BROWSER_UA });
  const page = await context.newPage();
  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: PLAYWRIGHT_NAV_MS });
    await sleep(1500);
    const hrefs = await page.$$eval("a[href]", (els) =>
      els.map((e) => (e as HTMLAnchorElement).href).filter(Boolean),
    );
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 12000) ?? "");
    return [
      ...new Set([
        ...collectSocialUrls(html, network),
        ...collectSocialUrls(hrefs.join("\n"), network),
        ...collectSocialUrls(text, network),
      ]),
    ];
  } finally {
    await page.close();
    await context.close();
  }
}

async function playwrightSearch(
  queries: string[],
  network: SocialNetwork,
  engines: Array<{ name: string; urlFor: (q: string) => string }>,
  maxQueries: number,
): Promise<{ urls: string[]; winningQuery: string | null; searchUrl: string | null; sources: string[] }> {
  const browser = await launchSocialBrowser();
  if (!browser) {
    console.warn(`[social-serp] ${network}: Playwright unavailable, cannot harvest browser SERP`);
    return { urls: [], winningQuery: null, searchUrl: null, sources: [] };
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  const sources: string[] = [];
  let winningQuery: string | null = null;
  let searchUrl: string | null = null;

  try {
    for (const query of queries.slice(0, maxQueries)) {
      if (urls.length >= 6) break;
      for (const engine of engines) {
        if (urls.length >= 6) break;
        const displayUrl = engine.urlFor(query);
        try {
          const found = await playwrightHarvestOne(browser, displayUrl, network);
          let added = 0;
          for (const u of found) {
            if (seen.has(u)) continue;
            seen.add(u);
            urls.push(u);
            added++;
          }
          if (added > 0) {
            console.log(`[social-serp] ${network}: ${engine.name} +${added} for "${query}"`);
            if (!sources.includes(engine.name)) sources.push(engine.name);
            if (!winningQuery) {
              winningQuery = query;
              searchUrl = displayUrl;
            }
          }
        } catch (e) {
          console.warn(
            `[social-serp] ${network}: ${engine.name} failed for "${query}":`,
            e instanceof Error ? e.message : e,
          );
        }
      }
      if (urls.length > 0) break;
    }
  } finally {
    await browser.close();
  }

  return { urls, winningQuery, searchUrl, sources };
}

type HttpEngine = { name: string; urlFor: (q: string) => string };

const PRIMARY_HTTP_ENGINES: HttpEngine[] = [
  { name: "duckduckgo", urlFor: duckDuckGoSearchUrl },
  { name: "brave", urlFor: braveSearchUrl },
  { name: "bing", urlFor: bingSearchUrl },
];

async function httpHarvest(
  queries: string[],
  network: SocialNetwork,
  maxQueries = 4,
): Promise<{ urls: string[]; winningQuery: string | null; searchUrl: string | null; sources: string[] }> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const sources: string[] = [];
  let winningQuery: string | null = null;
  let searchUrl: string | null = null;
  const disabled = new Set<string>();

  const absorb = (found: string[], source: string, query: string, displayUrl: string) => {
    let added = 0;
    for (const u of found) {
      if (seen.has(u)) continue;
      seen.add(u);
      urls.push(u);
      added++;
    }
    if (added > 0) {
      console.log(`[social-serp] ${network}: ${source} +${added} for "${query}"`);
      if (!sources.includes(source)) sources.push(source);
      if (!winningQuery) {
        winningQuery = query;
        searchUrl = displayUrl;
      }
    }
  };

  for (const query of queries.slice(0, maxQueries)) {
    if (urls.length >= 6) break;
    for (const engine of PRIMARY_HTTP_ENGINES) {
      if (urls.length >= 6) break;
      if (disabled.has(engine.name)) continue;
      const displayUrl = engine.urlFor(query);
      const html = await fetchHtml(displayUrl);
      if (!html && engine.name !== "duckduckgo") {
        // Empty after non OK (e.g. Brave 429): stop hammering that engine
        disabled.add(engine.name);
        continue;
      }
      absorb(collectSocialUrls(html, network), engine.name, query, displayUrl);
    }
    if (urls.length >= 2) break;
  }

  return { urls, winningQuery, searchUrl, sources };
}

const PW_ENGINES: Array<{ name: string; urlFor: (q: string) => string }> = [
  { name: "playwright-duckduckgo", urlFor: duckDuckGoSearchUrl },
  { name: "playwright-brave", urlFor: braveSearchUrl },
  { name: "playwright-bing", urlFor: bingSearchUrl },
];

/** Harvest profile URLs for exactly one network (facebook OR instagram, never both). */
export async function harvestSerpProfileUrls(opts: {
  businessName: string;
  location?: string;
  phone?: string;
  network: SocialNetwork;
}): Promise<SerpHarvestResult> {
  const queries = buildSerpQueries(opts);
  console.log(`[social-serp] START ${opts.network} queries=${queries.length} name="${opts.businessName}"`);

  const http = await httpHarvest(queries, opts.network);
  if (http.urls.length > 0) {
    console.log(
      `[social-serp] DONE ${opts.network} http=${http.urls.length} sources=${http.sources.join(",")}`,
    );
    return {
      urls: http.urls,
      queries,
      winningQuery: http.winningQuery,
      sources: http.sources,
      searchUrl: http.searchUrl,
    };
  }

  console.log(`[social-serp] ${opts.network}: HTTP empty, trying Playwright fallback`);
  const pw = await playwrightSearch(queries, opts.network, PW_ENGINES, opts.network === "instagram" ? 3 : 2);
  console.log(`[social-serp] DONE ${opts.network} browser=${pw.urls.length}`);
  return {
    urls: pw.urls,
    queries,
    winningQuery: pw.winningQuery,
    sources: pw.sources,
    searchUrl: pw.searchUrl,
  };
}

/** Open a known Facebook page and pull linked Instagram profile URLs. */
export async function harvestInstagramFromFacebookPage(facebookUrl: string): Promise<string[]> {
  const browser = await launchSocialBrowser();
  if (!browser) return [];
  try {
    const found = await playwrightHarvestOne(browser, facebookUrl, "instagram");
    console.log(`[social-serp] IG from FB page ${facebookUrl}: ${found.length}`);
    return found;
  } catch {
    return [];
  } finally {
    await browser.close();
  }
}
