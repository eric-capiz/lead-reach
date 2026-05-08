import { chromium, type Browser } from "playwright";
import {
  bingSearchUrlForQuery,
  collectFromBingHtml,
  extractAllUrlsFromBingHtml,
  extractSocialUrlsFromLinkList,
  isSerpUrlSampleNoise,
} from "@/server/services/google-serp-scrape";

const NAV_MS = 55_000;

/**
 * Headless Chromium + Chrome UA matches interactive Bing (Copilot cards); Firefox UA is better for raw HTTP fetch only.
 */
const PLAYWRIGHT_BING_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function toAbsoluteHref(href: string, base: string): string {
  const h = href.trim();
  if (!h) return h;
  try {
    if (h.startsWith("http")) return h;
    if (h.startsWith("//")) return `https:${h}`;
    return new URL(h, base).href;
  } catch {
    return h;
  }
}

async function collectFromPage(
  browser: Browser,
  targetUrl: string,
  baseOrigin: string,
  network: "facebook" | "instagram",
): Promise<{ hrefs: string[]; fromBlob: string[]; serpAllUrls: string[] }> {
  const context = await browser.newContext({ userAgent: PLAYWRIGHT_BING_USER_AGENT });
  const page = await context.newPage();
  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAV_MS });
    await sleep(2500);
    /** Same behavior users see: first Bing paint can be wrong until reload completes hydration. */
    await page.reload({ waitUntil: "domcontentloaded", timeout: NAV_MS });
    await sleep(3500);
    const rawHrefs = await page.$$eval("a[href]", (els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") || "").filter(Boolean),
    );
    const hrefs = rawHrefs.map((h) => toAbsoluteHref(h, baseOrigin));
    const html = await page.content();
    const blob = html.replace(/&amp;/gi, "&");
    const fromBlob = collectFromBingHtml(blob, network);
    const serpAllUrls = extractAllUrlsFromBingHtml(blob, network);
    return { hrefs, fromBlob, serpAllUrls };
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * Headless Chromium: Bing SERP only, then scrapes anchors + HTML.
 * Skipped on Vercel unless SOCIAL_BROWSER_FORCE=1 (Chromium is usually unavailable there).
 */
export async function browserHarvestSocialCandidates(
  queries: string[],
  network: "facebook" | "instagram",
): Promise<{ candidates: string[]; pageUrls: string[] }> {
  if (process.env.SOCIAL_BROWSER === "0") {
    return { candidates: [], pageUrls: [] };
  }

  if (process.env.VERCEL === "1" && process.env.SOCIAL_BROWSER_FORCE !== "1") {
    return { candidates: [], pageUrls: [] };
  }

  let browser: Browser | null = null;
  try {
    const channel =
      process.env.PLAYWRIGHT_CHROME_CHANNEL === "1" || process.env.PLAYWRIGHT_CHROME_CHANNEL === "true"
        ? "chrome"
        : undefined;
    browser = await chromium.launch({
      headless: true,
      channel,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  } catch {
    return { candidates: [], pageUrls: [] };
  }

  const seen = new Set<string>();
  const candidates: string[] = [];
  const pageUrlSeen = new Set<string>();
  const pageUrls: string[] = [];

  const mergePageUrl = (raw: string) => {
    const u = raw.trim();
    if (!u || isSerpUrlSampleNoise(u)) return;
    let key = u;
    try {
      key = new URL(u.startsWith("//") ? `https:${u}` : u).href.replace(/\/$/, "");
    } catch {
      /* keep */
    }
    if (pageUrlSeen.has(key)) return;
    pageUrlSeen.add(key);
    pageUrls.push(u.startsWith("//") ? `https:${u}` : u);
  };

  const absorb = (urls: string[]) => {
    const got = extractSocialUrlsFromLinkList(urls, network);
    for (const c of got) {
      if (seen.has(c)) continue;
      seen.add(c);
      candidates.push(c);
    }
  };

  try {
    for (const query of queries) {
      if (candidates.length > 0) break;

      const bUrl = bingSearchUrlForQuery(query);
      try {
        const { hrefs, fromBlob, serpAllUrls } = await collectFromPage(
          browser,
          bUrl,
          "https://www.bing.com/",
          network,
        );
        for (const h of hrefs) mergePageUrl(h);
        for (const u of serpAllUrls) mergePageUrl(u);
        absorb(hrefs);
        for (const c of fromBlob) {
          if (!seen.has(c)) {
            seen.add(c);
            candidates.push(c);
          }
        }
      } catch {
        /* skip query */
      }
    }
  } finally {
    await browser.close();
  }

  return { candidates, pageUrls };
}
