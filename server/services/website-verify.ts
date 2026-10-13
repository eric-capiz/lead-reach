/**
 * Lightweight "does this business actually have a website?" check.
 *
 * Google's Places `websiteUri` is often empty even when a business HAS a site,
 * which pollutes the "no website" filter with false positives. This runs ONE
 * best-effort DuckDuckGo HTML search per business and looks for an
 * official-looking domain in the results.
 *
 * Rules: plain HTTP only (no Playwright, no paid SERP API), hard timeout,
 * never throws — returns null when unsure or blocked. A null result means
 * "could not confirm a website", NOT "confirmed no website".
 */

const DDG_URL = "https://html.duckduckgo.com/html/";
const FETCH_TIMEOUT_MS = 6000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0";

/** Domains that are never a business's official site. */
const SKIP_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "yelp.com",
  "yellowpages.com",
  "superpages.com",
  "bbb.org",
  "mapquest.com",
  "tripadvisor.com",
  "foursquare.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "thumbtack.com",
  "angi.com",
  "homeadvisor.com",
  "chamberofcommerce.com",
  "manta.com",
  "citysearch.com",
  "groupon.com",
  "birdeye.com",
  "clutch.co",
  "cylex.us.com",
  "hotfrog.com",
  "iglobal.co",
  "wheree.com",
  "brownbook.net",
  "ezlocal.com",
  "showmelocal.com",
  "local.yahoo.com",
  "patch.com",
]);

const NAME_STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "a",
  "an",
  "co",
  "inc",
  "llc",
  "ltd",
  "company",
  "services",
  "service",
  "shop",
  "store",
]);

function significantTokens(businessName: string): string[] {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !NAME_STOPWORDS.has(t));
}

/** Does this hostname look like the business's own domain? */
function hostLooksOfficial(hostname: string, businessName: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const root = host.split(".")[0] ?? "";
  if (!root || SKIP_HOSTS.has(host) || [...SKIP_HOSTS].some((s) => host.endsWith(`.${s}`))) {
    return false;
  }
  const tokens = significantTokens(businessName);
  if (tokens.length === 0) return false;
  const squashed = root.replace(/[^a-z0-9]/g, "");
  let hits = 0;
  for (const t of tokens) {
    if (squashed.includes(t)) hits++;
  }
  // One distinctive token is enough only when it's basically the whole name.
  if (tokens.length === 1) return hits === 1 && squashed.length <= tokens[0]!.length + 6;
  return hits >= 2 || (hits === 1 && squashed === tokens.join(""));
}

function extractResultUrls(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const clean = html.replace(/&amp;/gi, "&");
  for (const m of clean.matchAll(/\/url\?q=([^&"'<>]+)/g)) {
    try {
      const u = new URL(decodeURIComponent(m[1]!.replace(/\+/g, "%20")));
      const key = u.hostname + u.pathname.replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u.toString());
    } catch {
      /* skip */
    }
  }
  for (const m of clean.matchAll(/https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/?[^"'\s<>]*/gi)) {
    try {
      const u = new URL(m[0]);
      if (u.hostname.includes("duckduckgo.com")) continue;
      const key = u.hostname + u.pathname.replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u.toString());
    } catch {
      /* skip */
    }
  }
  return out.slice(0, 15);
}

/**
 * Returns an official-looking website URL for the business, or null.
 * Null = could not confirm (blocked, no results, no official domain found).
 */
export async function verifyBusinessWebsite(
  businessName: string,
  location: string,
): Promise<string | null> {
  const name = businessName.trim();
  if (name.length < 2) return null;
  const query = `"${name}" ${location.trim()}`.trim();
  const url = new URL(DDG_URL);
  url.searchParams.set("q", query);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    for (const raw of extractResultUrls(html)) {
      let hostname: string;
      try {
        hostname = new URL(raw).hostname;
      } catch {
        continue;
      }
      if (hostLooksOfficial(hostname, name)) {
        return `https://${hostname.replace(/^www\./, "")}`;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
