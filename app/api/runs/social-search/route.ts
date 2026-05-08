import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { LeadModel, SocialResolveCacheModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import {
  fetchSocialCandidatesForQuery,
  pickBestSocialCandidate,
  pickFirstProfileUrlFromSerpUrls,
  serpSearchUrlForQuery,
  socialSearchStem,
} from "@/server/services/google-serp-scrape";
import {
  hasLeadSocialUrl,
  leadNeedsSocialEnrichment,
  leadSearchableBase,
} from "@/server/lib/lead-socials";

type Network = "facebook" | "instagram" | "both";

export const maxDuration = 300;

type ReqBody = {
  network?: string;
};

/**
 * One eligible lead per request: the newest non-sample lead still missing Facebook and/or Instagram
 * (same behavior as the original “Get socials” before batching/chunking).
 * Body: { network?: "facebook" | "instagram" } (default both).
 */
export async function POST(req: Request) {
  try {
    const userId = await requireCurrentUserId();
    let network: Network = "both";
    try {
      const body = (await req.json()) as ReqBody;
      if (body.network === "facebook" || body.network === "instagram") network = body.network;
    } catch {
      /* empty body */
    }

    const allLeads = await LeadModel.find({ userId, isSample: { $ne: true } })
      .sort({ updatedAt: -1 })
      .lean();

    if (!allLeads.length) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        skipReason: "no_leads",
        pilot: true,
        network,
        leadId: null,
        businessName: "",
        facebook: null,
        instagram: null,
        updated: false,
        socialDebug: { step: "no_leads" },
      });
    }

    const lead = allLeads.find(leadNeedsSocialEnrichment);

    if (!lead) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        skipReason: "none_need_socials",
        pilot: true,
        network,
        leadId: null,
        businessName: "",
        facebook: null,
        instagram: null,
        updated: false,
        note: "Every lead already has Facebook and Instagram, or none have a name or location to search.",
        socialDebug: { step: "none_need_socials", nonSampleLeadCount: allLeads.length },
      });
    }

    const loc = (lead.location ?? "").trim();
    const biz = (lead.businessName ?? "").trim();
    const leadLine = leadSearchableBase(lead);
    const searchStem = socialSearchStem(biz, loc) ?? (leadLine.trim() || null);
    if (!searchStem) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        skipReason: "no_search_query",
        pilot: true,
        network,
        leadId: String(lead._id),
        businessName: lead.businessName ?? "",
        facebook: lead.facebook ?? null,
        instagram: lead.instagram ?? null,
        updated: false,
        note: "Add a business name or location on this lead to search for social profiles.",
        socialDebug: {
          step: "no_search_query",
          leadId: String(lead._id),
          businessName: biz,
          location: loc,
        },
      });
    }

    const fetchIssues: string[] = [];
    type SerpUrlSample = {
      query: string | null;
      winningQuery: string | null;
      urls: string[];
      /** Facebook only: Yahoo SERP URL for `query`. */
      serpSearchUrlForDisplayQuery?: string;
      /** Facebook only: each HTTP SERP attempt in order. */
      serpSearchAttempts?: { query: string; searchUrl: string }[];
    };
    const serpSampleFb: SerpUrlSample = { query: null, winningQuery: null, urls: [] };
    const serpSampleIg: SerpUrlSample = { query: null, winningQuery: null, urls: [] };

    const needFb = !hasLeadSocialUrl(lead.facebook);
    const needIg = !hasLeadSocialUrl(lead.instagram);
    const patch: { facebook?: string; instagram?: string } = {};
    const placeId = String(lead.googlePlaceId ?? "").trim();
    const cached = await SocialResolveCacheModel.findOne({ placeId }).lean();

    const socialDebug: Record<string, unknown> = {
      step: "searched",
      leadId: String(lead._id),
      placeId,
      cacheHitFacebook: false,
      cacheHitInstagram: false,
      /** SERP queries use business name only when available — not the full address line. */
      searchStem,
      /** Raw name + location as stored on the lead (may include street address). */
      leadLine,
      network,
      needFb,
      needIg,
    };

    if (needFb && network !== "instagram" && cached && hasLeadSocialUrl(cached.facebook)) {
      patch.facebook = cached.facebook as string;
      socialDebug.cacheHitFacebook = true;
      socialDebug.facebook = { fromCache: true, chosen: patch.facebook };
    }

    if (needIg && network !== "facebook" && cached && hasLeadSocialUrl(cached.instagram)) {
      patch.instagram = cached.instagram as string;
      socialDebug.cacheHitInstagram = true;
      socialDebug.instagram = { fromCache: true, chosen: patch.instagram };
    }

    if (needFb && network !== "instagram" && !patch.facebook) {
      try {
        const q = `${searchStem} facebook`;
        const r = await fetchSocialCandidatesForQuery(q, "facebook", {
          websiteUri: lead.websiteUri,
          businessName: biz || null,
          location: loc || null,
        });
        const fbSerp = pickFirstProfileUrlFromSerpUrls(r.urlsFromSearchResults, "facebook");
        const fb =
          fbSerp ?? pickBestSocialCandidate(r.candidates, biz, loc, "facebook");
        serpSampleFb.query = q;
        serpSampleFb.winningQuery = r.winningQuery ?? null;
        serpSampleFb.urls = r.urlsFromSearchResults;
        serpSampleFb.serpSearchUrlForDisplayQuery = serpSearchUrlForQuery(q);
        serpSampleFb.serpSearchAttempts = (r.engineAttempts ?? []).map((a) => ({
          query: a.query,
          searchUrl: serpSearchUrlForQuery(a.query),
        }));
        socialDebug.facebook = {
          query: q,
          googleStatus: r.googleStatus,
          fetchSource: r.fetchSource,
          googleWasChallenge: r.googleWasChallenge,
          serpSearchUrl: r.serpSearchUrl,
          websiteTried: r.websiteTried,
          websiteStatus: r.websiteStatus,
          winningQuery: r.winningQuery,
          engineAttempts: r.engineAttempts,
          htmlLength: r.htmlLength,
          searchUrl: r.searchUrl,
          candidates: r.candidates,
          chosen: fb,
          chosenFromSerpSample: !!fbSerp,
        };
        if (fb) patch.facebook = fb;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown error";
        fetchIssues.push("Facebook search could not be completed.");
        socialDebug.facebook = { error: msg };
      }
    }

    if (needIg && network !== "facebook" && !patch.instagram) {
      try {
        const q = `${searchStem} instagram`;
        const r = await fetchSocialCandidatesForQuery(q, "instagram", {
          websiteUri: lead.websiteUri,
          businessName: biz || null,
          location: loc || null,
        });
        const igSerp = pickFirstProfileUrlFromSerpUrls(r.urlsFromSearchResults, "instagram");
        const ig =
          igSerp ?? pickBestSocialCandidate(r.candidates, biz, loc, "instagram");
        serpSampleIg.query = q;
        serpSampleIg.winningQuery = r.winningQuery ?? null;
        serpSampleIg.urls = r.urlsFromSearchResults;
        socialDebug.instagram = {
          query: q,
          googleStatus: r.googleStatus,
          fetchSource: r.fetchSource,
          googleWasChallenge: r.googleWasChallenge,
          serpSearchUrl: r.serpSearchUrl,
          websiteTried: r.websiteTried,
          websiteStatus: r.websiteStatus,
          winningQuery: r.winningQuery,
          engineAttempts: r.engineAttempts,
          htmlLength: r.htmlLength,
          searchUrl: r.searchUrl,
          candidates: r.candidates,
          chosen: ig,
          chosenFromSerpSample: !!igSerp,
        };
        if (ig) patch.instagram = ig;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown error";
        fetchIssues.push("Instagram search could not be completed.");
        socialDebug.instagram = { error: msg };
      }
    }

    if (patch.facebook || patch.instagram) {
      const $set: { facebook?: string; instagram?: string } = {};
      if (patch.facebook) $set.facebook = patch.facebook;
      if (patch.instagram) $set.instagram = patch.instagram;
      if (placeId) {
        await SocialResolveCacheModel.updateOne({ placeId }, { $set }, { upsert: true });
      }
    }

    let leadUpdateMatched: boolean | undefined;
    if (Object.keys(patch).length > 0) {
      const lid = new mongoose.Types.ObjectId(String(lead._id));
      const uid = new mongoose.Types.ObjectId(userId);
      const leadRes = await LeadModel.updateOne({ _id: lid, userId: uid }, { $set: patch });
      leadUpdateMatched = leadRes.matchedCount > 0;
      if (!leadUpdateMatched) {
        console.error("[social-search] Lead update matched 0 rows", {
          leadId: String(lid),
          userId: String(uid),
          patchFields: Object.keys(patch),
        });
      }
    }
    socialDebug.leadUpdateMatched = leadUpdateMatched;

    const urlsFromSearchResults = {
      facebook: serpSampleFb,
      instagram: serpSampleIg,
    };
    console.log(
      "[social-search] urls-from-results",
      JSON.stringify(
        {
          leadId: String(lead._id),
          searchStem,
          facebook: {
            query: serpSampleFb.query,
            winningQuery: serpSampleFb.winningQuery,
            urls: serpSampleFb.urls,
            serpSearchUrlForDisplayQuery: serpSampleFb.serpSearchUrlForDisplayQuery,
            serpSearchAttempts: serpSampleFb.serpSearchAttempts,
          },
          instagram: {
            query: serpSampleIg.query,
            winningQuery: serpSampleIg.winningQuery,
            urls: serpSampleIg.urls,
          },
        },
        null,
        2,
      ),
    );

    const parts: string[] = [...fetchIssues];
    if (!patch.facebook && needFb && !fetchIssues.some((x) => x.includes("Facebook"))) {
      parts.push("No Facebook profile matched in search results.");
    }
    if (!patch.instagram && needIg && !fetchIssues.some((x) => x.includes("Instagram"))) {
      parts.push("No Instagram profile matched in search results.");
    }

    let note: string | undefined;
    if (parts.length) note = parts.join(" ");

    return NextResponse.json({
      ok: true,
      pilot: true,
      network,
      leadId: String(lead._id),
      businessName: lead.businessName,
      facebook: patch.facebook ?? (lead.facebook as string | null) ?? null,
      instagram: patch.instagram ?? (lead.instagram as string | null) ?? null,
      updated: Object.keys(patch).length > 0,
      note,
      socialDebug,
      urlsFromSearchResults,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
