/**
 * Get Socials resolver:
 * SERP (DuckDuckGo / Brave / Bing) + Meta Ad Library, AI pick from candidates only, hard verify, blank OK.
 */

import { isSocialLlmEnabled, requestGroqJson } from "@/server/services/social-llm";
import { harvestInstagramFromFacebookPage, harvestSerpProfileUrls, type SocialNetwork } from "@/server/services/social-serp";
import {
  adLibraryUrlsForNetwork,
  searchAdLibraryPages,
} from "@/server/services/social-ad-library";
import {
  canonicalProfileUrl,
  extractHandle,
  nameMatchesBusiness,
  pageSnippetForAi,
  validateProfileAlive,
} from "@/server/services/social-verify";

const VERIFY_MIN_CONFIDENCE = 0.65;
const MAX_CANDIDATES = 14;
const MAX_VERIFY = 5;

export type SocialResolveAttempt = {
  url: string;
  handle: string | null;
  source: string;
  ruleDead: boolean;
  nameOk: boolean;
  title: string;
  verify: {
    live: boolean;
    matchesBusiness: boolean;
    confidence: number;
    reason: string;
  } | null;
};

export type SocialResolveResult = {
  chosen: string | null;
  searchQuery: string;
  candidateUrls: string[];
  sources: string[];
  aiPick: { url: string | null; rankedUrls: string[]; confidence: number; reason: string } | null;
  attempts: SocialResolveAttempt[];
  winningQuery: string | null;
  searchUrl: string | null;
};

const PICK_SYSTEM = `You pick the official Instagram or Facebook PROFILE for ONE local business from a candidate URL list.
Return JSON only: {"url": string|null, "rankedUrls": string[], "confidence": number, "reason": string}

Rules:
- url and rankedUrls MUST be copied exactly from the candidates list. Never invent handles or URLs.
- If none are the real business profile, return url:null, rankedUrls:[], confidence under 0.5.
- Reject posts, reels, city pages, unrelated brands, login pages.
- Prefer profile roots like instagram.com/handle or facebook.com/pagename.`;

const VERIFY_SYSTEM = `You verify a social profile belongs to ONE local business and has real content.
Return JSON only: {"live": boolean, "matchesBusiness": boolean, "confidence": number, "reason": string}

live=false when: content unavailable, deleted, empty, login wall only.
matchesBusiness=false for wrong business or city pages.
Save only if live and matchesBusiness are both true. If unsure, false.`;

function dedupeUrls(urls: string[], network: SocialNetwork): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const c = canonicalProfileUrl(raw, network);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

async function aiPick(
  businessName: string,
  location: string,
  network: SocialNetwork,
  candidates: string[],
): Promise<SocialResolveResult["aiPick"]> {
  if (!isSocialLlmEnabled() || candidates.length === 0) {
    return {
      url: null,
      rankedUrls: candidates.slice(0, 5),
      confidence: candidates.length ? 0.4 : 0,
      reason: isSocialLlmEnabled() ? "no_candidates" : "ai_disabled_fallback_order",
    };
  }

  const res = await requestGroqJson<{
    url?: unknown;
    rankedUrls?: unknown;
    confidence?: unknown;
    reason?: unknown;
  }>(
    PICK_SYSTEM,
    JSON.stringify({
      businessName,
      location,
      network,
      candidates: candidates.slice(0, MAX_CANDIDATES),
    }),
  );

  if (!res) {
    return {
      url: null,
      rankedUrls: candidates.slice(0, 5),
      confidence: 0.35,
      reason: "ai_unavailable",
    };
  }

  const norm = (u: string) => u.trim().replace(/\/$/, "");
  let url: string | null = null;
  if (typeof res.data.url === "string" && res.data.url.trim()) {
    const match = candidates.find((c) => norm(c) === norm(res.data.url as string));
    if (match) url = match;
  }

  const rankedUrls: string[] = [];
  if (Array.isArray(res.data.rankedUrls)) {
    for (const raw of res.data.rankedUrls) {
      if (typeof raw !== "string") continue;
      const match = candidates.find((c) => norm(c) === norm(raw));
      if (match && !rankedUrls.includes(match)) rankedUrls.push(match);
    }
  }
  if (url && !rankedUrls.includes(url)) rankedUrls.unshift(url);

  const confidence =
    typeof res.data.confidence === "number" && Number.isFinite(res.data.confidence)
      ? Math.max(0, Math.min(1, res.data.confidence))
      : 0;

  return {
    url,
    rankedUrls,
    confidence,
    reason: typeof res.data.reason === "string" ? res.data.reason.trim() : "",
  };
}

async function aiVerify(
  businessName: string,
  location: string,
  network: SocialNetwork,
  profile: { url: string; handle: string | null; title: string; snippet: string },
): Promise<SocialResolveAttempt["verify"]> {
  if (!isSocialLlmEnabled()) {
    // Without AI: rule based name match + alive already checked by caller
    const ok = nameMatchesBusiness(businessName, location, profile.handle, profile.title);
    return {
      live: true,
      matchesBusiness: ok,
      confidence: ok ? 0.75 : 0.2,
      reason: ok ? "rule_name_match" : "rule_name_mismatch",
    };
  }

  const res = await requestGroqJson<{
    live?: unknown;
    matchesBusiness?: unknown;
    confidence?: unknown;
    reason?: unknown;
  }>(
    VERIFY_SYSTEM,
    JSON.stringify({
      businessName,
      location,
      network,
      url: profile.url,
      handle: profile.handle,
      pageTitle: profile.title,
      pageSnippet: profile.snippet.slice(0, 1800),
    }),
  );

  if (!res) return null;

  const confidence =
    typeof res.data.confidence === "number" && Number.isFinite(res.data.confidence)
      ? Math.max(0, Math.min(1, res.data.confidence))
      : 0;

  return {
    live: res.data.live === true,
    matchesBusiness: res.data.matchesBusiness === true,
    confidence,
    reason: typeof res.data.reason === "string" ? res.data.reason.trim() : "",
  };
}

function verifyPasses(
  network: SocialNetwork,
  ruleDead: boolean,
  nameOk: boolean,
  v: SocialResolveAttempt["verify"],
): boolean {
  if (ruleDead) return false;
  if (!v?.live || !v.matchesBusiness || v.confidence < VERIFY_MIN_CONFIDENCE) return false;
  // Instagram handles are often loose vs legal name; allow strong AI match without strict token bar
  if (network === "instagram" && v.confidence >= 0.75) return true;
  return nameOk;
}

/**
 * Resolve one network for a lead. Never invents URLs. Blank if nothing verifies.
 */
export async function resolveSocialProfile(opts: {
  businessName: string;
  location?: string;
  phone?: string;
  network: SocialNetwork;
  /** Precomputed Ad Library / other candidates (e.g. shared across FB+IG for one lead). */
  extraCandidates?: string[];
  /** When resolving Instagram, open this FB page for linked IG. */
  facebookUrlHint?: string | null;
}): Promise<SocialResolveResult> {
  const businessName = opts.businessName.trim();
  const location = (opts.location ?? "").trim();
  const attempts: SocialResolveAttempt[] = [];

  if (businessName.length < 2) {
    return {
      chosen: null,
      searchQuery: "",
      candidateUrls: [],
      sources: [],
      aiPick: null,
      attempts,
      winningQuery: null,
      searchUrl: null,
    };
  }

  const serp = await harvestSerpProfileUrls({
    businessName,
    location: location || undefined,
    phone: opts.phone,
    network: opts.network,
  });

  // Skip second Ad Library call when the route already passed those URLs as extraCandidates
  let adUrls: string[] = [];
  let adSource = false;
  if (!(opts.extraCandidates && opts.extraCandidates.length > 0)) {
    try {
      const hits = await searchAdLibraryPages(businessName);
      adUrls = adLibraryUrlsForNetwork(hits, opts.network);
      if (adUrls.length) adSource = true;
    } catch {
      /* optional channel */
    }
  }

  // Scrape known FB page for linked IG when SERP came up empty
  let fromFb: string[] = [];
  if (opts.network === "instagram" && opts.facebookUrlHint && serp.urls.length === 0) {
    try {
      fromFb = await harvestInstagramFromFacebookPage(opts.facebookUrlHint);
    } catch {
      /* optional */
    }
  }

  // SERP first. Ad Library extras are noisier and were drowning good DuckDuckGo/Brave hits.
  const candidateUrls = dedupeUrls(
    [...serp.urls, ...fromFb, ...(opts.extraCandidates ?? []), ...adUrls],
    opts.network,
  ).slice(0, MAX_CANDIDATES);
  const sources = [
    ...serp.sources,
    ...(adSource ? ["ad_library"] : []),
    ...(fromFb.length ? ["facebook_page"] : []),
    ...(opts.extraCandidates?.length ? ["extra"] : []),
  ];
  const searchQuery = serp.winningQuery ?? serp.queries[0] ?? `${businessName} ${opts.network}`;

  console.log(
    `[social-resolve] ${opts.network} candidates=${candidateUrls.length} serp=${serp.urls.length} ` +
      `extra=${opts.extraCandidates?.length ?? 0} sample=${candidateUrls.slice(0, 5).join(" | ") || "(none)"}`,
  );

  const pick = await aiPick(businessName, location, opts.network, candidateUrls);

  const toTry: string[] = [];
  for (const u of pick?.rankedUrls ?? []) {
    if (!toTry.includes(u)) toTry.push(u);
  }
  if (pick?.url && !toTry.includes(pick.url)) toTry.unshift(pick.url);
  if (toTry.length === 0) {
    for (const u of candidateUrls.slice(0, MAX_VERIFY)) toTry.push(u);
  }

  if (toTry.length === 0) {
    return {
      chosen: null,
      searchQuery,
      candidateUrls,
      sources,
      aiPick: pick,
      attempts,
      winningQuery: serp.winningQuery,
      searchUrl: serp.searchUrl,
    };
  }

  for (const url of toTry.slice(0, MAX_VERIFY)) {
    const handle = extractHandle(url, opts.network);
    const meta = await validateProfileAlive(url, opts.network);
    const ruleDead = !meta.alive;
    const nameOk =
      !ruleDead && nameMatchesBusiness(businessName, location || undefined, meta.handle ?? handle, meta.title);

    let verify: SocialResolveAttempt["verify"] = null;
    if (ruleDead) {
      verify = {
        live: false,
        matchesBusiness: false,
        confidence: 0,
        reason: "dead_or_unavailable",
      };
    } else {
      verify = await aiVerify(businessName, location, opts.network, {
        url,
        handle: meta.handle ?? handle,
        title: meta.title,
        snippet: pageSnippetForAi(meta),
      });
    }

    const attempt: SocialResolveAttempt = {
      url,
      handle: meta.handle ?? handle,
      source: adUrls.includes(url) ? "ad_library" : "serp",
      ruleDead,
      nameOk,
      title: meta.title,
      verify,
    };
    attempts.push(attempt);

    const pass = verifyPasses(opts.network, ruleDead, nameOk, verify);
    console.log(
      `[social-resolve] ${opts.network} try ${url} alive=${!ruleDead} nameOk=${nameOk} ` +
        `ai=${verify?.matchesBusiness ?? false}/${verify?.confidence ?? 0} ` +
        `reason=${verify?.reason ?? "n/a"} pass=${pass}`,
    );

    if (pass) {
      return {
        chosen: url,
        searchQuery,
        candidateUrls,
        sources,
        aiPick: pick,
        attempts,
        winningQuery: serp.winningQuery,
        searchUrl: serp.searchUrl,
      };
    }
  }

  return {
    chosen: null,
    searchQuery,
    candidateUrls,
    sources,
    aiPick: pick,
    attempts,
    winningQuery: serp.winningQuery,
    searchUrl: serp.searchUrl,
  };
}

/** Re check a cached URL before trusting it. */
export async function trustExistingSocialUrl(
  url: string,
  businessName: string,
  location: string,
  network: SocialNetwork,
): Promise<boolean> {
  const c = canonicalProfileUrl(url, network);
  if (!c) return false;
  const handle = extractHandle(c, network);
  const meta = await validateProfileAlive(c, network);
  if (!meta.alive) return false;
  const nameOk = nameMatchesBusiness(
    businessName,
    location || undefined,
    meta.handle ?? handle,
    meta.title,
  );
  const verify = await aiVerify(businessName, location, network, {
    url: c,
    handle: meta.handle ?? handle,
    title: meta.title,
    snippet: pageSnippetForAi(meta),
  });
  return verifyPasses(network, false, nameOk, verify);
}
