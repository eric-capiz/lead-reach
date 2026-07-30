/**
 * Meta Ad Library typeahead: resolves business name to Facebook page (and linked IG when present).
 * Uses the same GraphQL the public Ad Library search bar uses (via Playwright).
 */

import type { Browser } from "playwright";
import { isLikelyProfileUrl } from "@/server/lib/social-profile-url";
import { launchSocialBrowser, SOCIAL_BROWSER_UA } from "@/server/services/social-playwright";

export type AdLibraryHit = {
  pageId: string;
  name: string;
  pageAlias: string | null;
  facebookUrl: string | null;
  instagramHandle: string | null;
  instagramUrl: string | null;
};

type TypeaheadPage = {
  page_id?: string | number;
  name?: string;
  page_alias?: string;
  ig_username?: string;
  ig_followers?: number;
  category?: string;
};

/**
 * Query Ad Library typeahead for a business name. Returns candidate FB/IG URLs only.
 */
export async function searchAdLibraryPages(
  businessName: string,
  opts?: { browser?: Browser | null; country?: string },
): Promise<AdLibraryHit[]> {
  const q = businessName.trim();
  if (q.length < 2) return [];

  const ownBrowser = !opts?.browser;
  const browser = opts?.browser ?? (await launchSocialBrowser());
  if (!browser) return [];

  try {
    const context = await browser.newContext({ userAgent: SOCIAL_BROWSER_UA });
    const page = await context.newPage();
    try {
      await page.goto("https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US", {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await new Promise((r) => setTimeout(r, 1200));

      const country = opts?.country ?? "US";
      const raw = await page.evaluate(
        async ({ queryString, countryCode }) => {
          const body = new URLSearchParams();
          body.set("fb_api_req_friendly_name", "useAdLibraryTypeaheadSuggestionDataSourceQuery");
          body.set("doc_id", "9755915494515334");
          body.set(
            "variables",
            JSON.stringify({
              queryString,
              isMobile: false,
              country: countryCode,
              adType: "ALL",
            }),
          );

          const res = await fetch("https://www.facebook.com/api/graphql/", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "*/*",
            },
            body: body.toString(),
          });
          return res.text();
        },
        { queryString: q, countryCode: country },
      );

      return parseTypeaheadResponse(raw);
    } finally {
      await page.close();
      await context.close();
    }
  } catch {
    return [];
  } finally {
    if (ownBrowser) await browser.close();
  }
}

function parseTypeaheadResponse(raw: string): AdLibraryHit[] {
  if (!raw || raw.trimStart().startsWith("<!")) return [];

  let json: unknown;
  try {
    // GraphQL sometimes returns concatenated JSON objects.
    const first = raw.split("\n").find((line) => line.trim().startsWith("{")) ?? raw;
    json = JSON.parse(first);
  } catch {
    return [];
  }

  const pages =
    (json as {
      data?: {
        ad_library_main?: {
          typeahead_suggestions?: { page_results?: TypeaheadPage[] };
        };
      };
    })?.data?.ad_library_main?.typeahead_suggestions?.page_results ?? [];

  const out: AdLibraryHit[] = [];
  for (const p of pages.slice(0, 10)) {
    const pageId = String(p.page_id ?? "").trim();
    const name = String(p.name ?? "").trim();
    if (!pageId && !p.page_alias && !p.ig_username) continue;

    const alias = p.page_alias?.trim() || null;
    let facebookUrl: string | null = null;
    if (alias) {
      const u = `https://www.facebook.com/${alias}`;
      if (isLikelyProfileUrl(u, "facebook")) facebookUrl = u;
    } else if (pageId) {
      facebookUrl = `https://www.facebook.com/profile.php?id=${pageId}`;
    }

    const igHandle = p.ig_username?.replace(/^@/, "").trim() || null;
    const instagramUrl = igHandle ? `https://www.instagram.com/${igHandle}` : null;

    out.push({
      pageId: pageId || alias || igHandle || "",
      name,
      pageAlias: alias,
      facebookUrl,
      instagramHandle: igHandle,
      instagramUrl: instagramUrl && isLikelyProfileUrl(instagramUrl, "instagram") ? instagramUrl : null,
    });
  }
  return out;
}

/** Collect FB or IG candidate URLs from Ad Library hits. */
export function adLibraryUrlsForNetwork(
  hits: AdLibraryHit[],
  network: "facebook" | "instagram",
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const url = network === "facebook" ? h.facebookUrl : h.instagramUrl;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
