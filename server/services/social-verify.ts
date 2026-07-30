/**
 * Hard verification for Instagram / Facebook profile candidates.
 * IG: web_profile_info API, then Playwright page title/text when the API is rate limited.
 * FB: Playwright rendered page text (login walls fail).
 */

import { isLikelyProfileUrl } from "@/server/lib/social-profile-url";
import {
  meetsAutoPickBar,
  scoreBusinessRelevance,
} from "@/server/lib/social-name-match";
import { launchSocialBrowser, SOCIAL_BROWSER_UA } from "@/server/services/social-playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IG_WEB_APP_ID = "936619743392459";
const PROBE_TIMEOUT_MS = 12_000;

const FB_DEAD = [
  "this content isn't available",
  "this content isn't available right now",
  "this page isn't available",
  "page not found",
  "the link you followed may be broken",
  "when this happens, it's usually because the owner only shared",
  "log into facebook",
  "log in to facebook",
  "you must log in to continue",
];

const IG_DEAD = [
  "profile isn't available",
  "sorry, this page isn't available",
  "the link may be broken",
  "page not found",
];

export type ProfileVerifyMeta = {
  alive: boolean;
  title: string;
  snippet: string;
  handle: string | null;
};

export function extractHandle(url: string, network: "facebook" | "instagram"): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (network === "instagram") {
      if (parts.length !== 1) return null;
      const h = parts[0]!.toLowerCase();
      if (["p", "reel", "reels", "explore", "stories"].includes(h)) return null;
      return h;
    }
    if (u.pathname.includes("profile.php")) {
      const id = u.searchParams.get("id");
      return id ? `id:${id}` : null;
    }
    if (parts.length !== 1) return null;
    const h = parts[0]!.toLowerCase();
    if (h === "people" || h === "share" || h === "groups") return null;
    return h;
  } catch {
    return null;
  }
}

export function canonicalProfileUrl(raw: string, network: "facebook" | "instagram"): string | null {
  try {
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw.trim());
    url.hash = "";
    const isFbId = network === "facebook" && url.pathname.includes("profile.php") && url.searchParams.has("id");
    if (isFbId) {
      const id = url.searchParams.get("id");
      return `https://www.facebook.com/profile.php?id=${id}`;
    }
    url.search = "";
    const href = url.href.replace(/\/$/, "");
    return isLikelyProfileUrl(href, network) ? href : null;
  } catch {
    return null;
  }
}

type IgApiResult = ProfileVerifyMeta & { confirmed: boolean };

async function fetchInstagramMetaApi(handle: string): Promise<IgApiResult> {
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
          Accept: "*/*",
          Referer: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
        },
      },
    );
    const text = await res.text();
    if (res.status === 404) {
      return { alive: false, title: "", snippet: "api_404", handle, confirmed: true };
    }
    if (res.status === 200) {
      try {
        const json = JSON.parse(text) as {
          data?: {
            user?: {
              username?: string;
              full_name?: string;
              biography?: string;
              edge_owner_to_timeline_media?: { count?: number };
            };
          };
        };
        const user = json.data?.user;
        if (user?.username) {
          const posts = user.edge_owner_to_timeline_media?.count ?? 0;
          const title = user.full_name || user.username;
          const snippet = [title, user.biography ?? "", `posts:${posts}`].join(" | ").slice(0, 1800);
          return {
            alive: true,
            title,
            snippet,
            handle: user.username,
            confirmed: true,
          };
        }
      } catch {
        /* fall through: treat as inconclusive */
      }
    }
    // 401 rate limit / login wall / HTML challenge: not a confirmed dead profile
    console.warn(`[social-verify] IG API inconclusive for @${handle} status=${res.status}`);
    return { alive: false, title: "", snippet: `api_${res.status}`, handle, confirmed: false };
  } catch (e) {
    console.warn(
      `[social-verify] IG API error for @${handle}:`,
      e instanceof Error ? e.message : e,
    );
    return { alive: false, title: "", snippet: "api_error", handle, confirmed: false };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchInstagramMetaPlaywright(url: string, handle: string): Promise<ProfileVerifyMeta> {
  const browser = await launchSocialBrowser();
  if (!browser) {
    return { alive: false, title: "", snippet: "browser_unavailable", handle };
  }
  try {
    const context = await browser.newContext({ userAgent: SOCIAL_BROWSER_UA });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
      await new Promise((r) => setTimeout(r, 1500));
      const title = await page.title();
      const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "");
      const low = `${title}\n${text}`.toLowerCase();

      if (IG_DEAD.some((p) => low.includes(p))) {
        return { alive: false, title, snippet: text.slice(0, 1800), handle };
      }

      // Public profiles usually: "Business Name (@handle) • Instagram photos and videos"
      const atHandle = new RegExp(`\\(@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "i");
      if (atHandle.test(title) || atHandle.test(text)) {
        const nameFromTitle = title.replace(/\s*[•|].*$/, "").replace(/\(@[^)]+\)/, "").trim();
        return {
          alive: true,
          title: nameFromTitle || title,
          snippet: text.slice(0, 1800),
          handle,
        };
      }

      if (
        low.includes(handle.toLowerCase()) &&
        (low.includes("followers") || low.includes("posts")) &&
        text.replace(/\s+/g, " ").trim().length > 40
      ) {
        return { alive: true, title: title || handle, snippet: text.slice(0, 1800), handle };
      }

      return { alive: false, title, snippet: text.slice(0, 1800), handle };
    } finally {
      await page.close();
      await context.close();
    }
  } catch {
    return { alive: false, title: "", snippet: "", handle };
  } finally {
    await browser.close();
  }
}

async function fetchFacebookMetaPlaywright(url: string, handle: string | null): Promise<ProfileVerifyMeta> {
  const browser = await launchSocialBrowser();
  if (!browser) {
    return { alive: false, title: "", snippet: "browser_unavailable", handle };
  }
  try {
    const context = await browser.newContext({ userAgent: SOCIAL_BROWSER_UA });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
      await new Promise((r) => setTimeout(r, 1500));
      const title = await page.title();
      const text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "");
      const low = `${title}\n${text}`.toLowerCase();

      if (FB_DEAD.some((p) => low.includes(p))) {
        return { alive: false, title, snippet: text.slice(0, 1800), handle };
      }
      if (title.toLowerCase() === "facebook" || title.toLowerCase() === "error") {
        return { alive: false, title, snippet: text.slice(0, 1800), handle };
      }
      if (text.replace(/\s+/g, " ").trim().length < 40) {
        return { alive: false, title, snippet: text.slice(0, 1800), handle };
      }
      return { alive: true, title, snippet: text.slice(0, 1800), handle };
    } finally {
      await page.close();
      await context.close();
    }
  } catch {
    return { alive: false, title: "", snippet: "", handle };
  } finally {
    await browser.close();
  }
}

export async function validateProfileAlive(
  url: string,
  network: "facebook" | "instagram",
): Promise<ProfileVerifyMeta> {
  const handle = extractHandle(url, network);
  if (network === "instagram") {
    if (!handle) return { alive: false, title: "", snippet: "", handle: null };
    const api = await fetchInstagramMetaApi(handle);
    if (api.alive && api.confirmed) {
      const { confirmed: _c, ...meta } = api;
      return meta;
    }
    if (api.confirmed && !api.alive) {
      const { confirmed: _c, ...meta } = api;
      return meta;
    }
    // Rate limited / login wall on API: confirm with Playwright (titles include @handle)
    console.log(`[social-verify] IG Playwright fallback for @${handle}`);
    return fetchInstagramMetaPlaywright(url, handle);
  }
  return fetchFacebookMetaPlaywright(url, handle);
}

/** Rule + fuzzy name gate before AI / save. */
export function nameMatchesBusiness(
  businessName: string,
  location: string | undefined,
  handle: string | null,
  title: string,
): boolean {
  const rel = scoreBusinessRelevance(businessName, handle?.startsWith("id:") ? null : handle, title, location);
  // Ad Library / SERP picks: allow title heavy matches when handle is opaque (profile.php id)
  if (handle?.startsWith("id:")) {
    return rel.titleTokenHits >= 1 && rel.tokensMatched >= 1;
  }
  return meetsAutoPickBar(rel) || (rel.titleTokenHits >= 1 && rel.tokensMatched >= 1);
}

export function pageSnippetForAi(meta: ProfileVerifyMeta): string {
  const parts: string[] = [];
  if (meta.title) parts.push(`Title: ${meta.title}`);
  if (meta.handle) parts.push(`Handle: ${meta.handle}`);
  if (meta.snippet) parts.push(meta.snippet);
  return parts.join("\n").slice(0, 1800);
}
