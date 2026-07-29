import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { LeadModel, SocialResolveCacheModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";
import {
  fetchSocialCandidatesForQuery,
  serpSearchUrlForQuery,
  socialSearchStem,
} from "@/server/services/google-serp-scrape";
import {
  entriesFromUrls,
  isTrustedSocialUrlForLead,
  pickBestSocialCandidate,
  type SocialCandidateEntry,
} from "@/server/services/social-handle-probe";
import {
  hasLeadSocialUrl,
  leadNeedsSocialEnrichment,
  leadSearchableBase,
} from "@/server/lib/lead-socials";
import { LEADS_PAGE_SIZE } from "@/lib/leads-page";

type Network = "facebook" | "instagram" | "both";

export const maxDuration = 300;

type ReqBody = {
  network?: string;
  /** Current leads table page — processed in order. Max {@link LEADS_PAGE_SIZE} ids. */
  leadIds?: string[];
};

type SerpUrlSample = {
  query: string | null;
  winningQuery: string | null;
  urls: string[];
  serpSearchUrlForDisplayQuery?: string;
  serpSearchAttempts?: { query: string; searchUrl: string }[];
};

export type OneLeadSocialResult = {
  leadId: string;
  businessName: string;
  facebook: string | null;
  instagram: string | null;
  updated: boolean;
  note?: string;
  socialDebug: Record<string, unknown>;
  urlsFromSearchResults?: {
    facebook: SerpUrlSample;
    instagram: SerpUrlSample;
  };
  skippedReason?: "already_complete" | "no_search_query" | "not_found";
};

function mergeCandidateEntries(
  primary: SocialCandidateEntry[],
  serpUrls: string[],
  serpSource: "serp" | "playwright",
): SocialCandidateEntry[] {
  return [...primary, ...entriesFromUrls(serpUrls, serpSource)];
}

async function resolveSocialProfile(
  r: Awaited<ReturnType<typeof fetchSocialCandidatesForQuery>>,
  network: "facebook" | "instagram",
  businessName: string,
  location: string,
): Promise<{ chosen: string | null; chosenFromSerpSample: boolean }> {
  const serpSource = r.fetchSource === "playwright" ? "playwright" : "serp";
  const entries = mergeCandidateEntries(r.candidateEntries, r.urlsFromSearchResults, serpSource);
  const chosen = await pickBestSocialCandidate(entries, businessName, location, network);
  return { chosen, chosenFromSerpSample: false };
}

function dedupePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

type LeadDocLike = {
  _id: mongoose.Types.ObjectId;
  businessName?: string;
  location?: string;
  facebook?: unknown;
  instagram?: unknown;
  websiteUri?: unknown;
  googlePlaceId?: unknown;
};

async function enrichSingleLead(
  lead: LeadDocLike,
  userId: string,
  network: Network,
): Promise<OneLeadSocialResult> {
  const loc = (lead.location ?? "").trim();
  const biz = (lead.businessName ?? "").trim();
  const leadLine = leadSearchableBase(lead);
  const searchStem = socialSearchStem(biz, loc) ?? (leadLine.trim() || null);
  if (!searchStem) {
    return {
      leadId: String(lead._id),
      businessName: lead.businessName ?? "",
      facebook: (lead.facebook as string | null) ?? null,
      instagram: (lead.instagram as string | null) ?? null,
      updated: false,
      note: "Add a business name or location on this lead to search for social profiles.",
      socialDebug: {
        step: "no_search_query",
        leadId: String(lead._id),
        businessName: biz,
        location: loc,
      },
      skippedReason: "no_search_query",
    };
  }

  const fetchIssues: string[] = [];
  const serpSampleFb: SerpUrlSample = { query: null, winningQuery: null, urls: [] };
  const serpSampleIg: SerpUrlSample = { query: null, winningQuery: null, urls: [] };

  const needFb = !hasLeadSocialUrl(lead.facebook);
  const needIg = !hasLeadSocialUrl(lead.instagram);
  const patch: { facebook?: string; instagram?: string } = {};
  const placeId = String(lead.googlePlaceId ?? "").trim();
  const cached = placeId ? await SocialResolveCacheModel.findOne({ placeId }).lean() : null;

  const socialDebug: Record<string, unknown> = {
    step: "searched",
    leadId: String(lead._id),
    placeId,
    cacheHitFacebook: false,
    cacheHitInstagram: false,
    searchStem,
    leadLine,
    network,
    needFb,
    needIg,
  };

  if (needFb && network !== "instagram" && cached && hasLeadSocialUrl(cached.facebook)) {
    const ok = await isTrustedSocialUrlForLead(cached.facebook as string, "facebook", biz, loc);
    if (ok) {
      patch.facebook = cached.facebook as string;
      socialDebug.cacheHitFacebook = true;
      socialDebug.facebook = { fromCache: true, chosen: patch.facebook };
    } else {
      socialDebug.cacheRejectedFacebook = cached.facebook;
    }
  }

  if (needIg && network !== "facebook" && cached && hasLeadSocialUrl(cached.instagram)) {
    const ok = await isTrustedSocialUrlForLead(cached.instagram as string, "instagram", biz, loc);
    if (ok) {
      patch.instagram = cached.instagram as string;
      socialDebug.cacheHitInstagram = true;
      socialDebug.instagram = { fromCache: true, chosen: patch.instagram };
    } else {
      socialDebug.cacheRejectedInstagram = cached.instagram;
    }
  }

  if (needFb && network !== "instagram" && !patch.facebook) {
    try {
      const q = `${searchStem} facebook`;
      const r = await fetchSocialCandidatesForQuery(q, "facebook", {
        websiteUri: lead.websiteUri as string | null | undefined,
        businessName: biz || null,
        location: loc || null,
      });
      const { chosen: fb, chosenFromSerpSample } = await resolveSocialProfile(r, "facebook", biz, loc);
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
        candidateEntries: r.candidateEntries,
        chosen: fb,
        chosenFromSerpSample,
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
        websiteUri: lead.websiteUri as string | null | undefined,
        businessName: biz || null,
        location: loc || null,
      });
      const { chosen: ig, chosenFromSerpSample } = await resolveSocialProfile(r, "instagram", biz, loc);
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
        candidateEntries: r.candidateEntries,
        chosen: ig,
        chosenFromSerpSample,
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

  const updated = Object.keys(patch).length > 0;

  return {
    leadId: String(lead._id),
    businessName: lead.businessName ?? "",
    facebook: patch.facebook ?? (lead.facebook as string | null) ?? null,
    instagram: patch.instagram ?? (lead.instagram as string | null) ?? null,
    updated,
    note,
    socialDebug,
    urlsFromSearchResults,
  };
}

/**
 * Body: `{ network?, leadIds? }`.
 * - With **`leadIds`**: enrich those leads (current table page), order preserved, max {@link LEADS_PAGE_SIZE}.
 * - Without **`leadIds`**: legacy — one lead globally (newest that still needs FB/IG).
 */
export async function POST(req: Request) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    let network: Network = "both";
    let leadIdsBody: string[] | undefined;
    try {
      const body = (await req.json()) as ReqBody;
      if (body.network === "facebook" || body.network === "instagram") network = body.network;
      if (Array.isArray(body.leadIds)) leadIdsBody = body.leadIds;
    } catch {
      /* empty body */
    }

    if (leadIdsBody && leadIdsBody.length > 0) {
      const ordered = dedupePreserveOrder(leadIdsBody.map((x) => String(x).trim())).slice(
        0,
        LEADS_PAGE_SIZE,
      );
      const invalid = leadIdsBody.length > LEADS_PAGE_SIZE;
      const oids = ordered
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      const leads = await LeadModel.find({
        userId,
        _id: { $in: oids },
        isSample: { $ne: true },
      }).lean();
      const byId = new Map(leads.map((l) => [String(l._id), l]));

      const results: OneLeadSocialResult[] = [];
      for (const id of ordered) {
        if (!mongoose.isValidObjectId(id)) {
          results.push({
            leadId: id,
            businessName: "",
            facebook: null,
            instagram: null,
            updated: false,
            socialDebug: { step: "invalid_id" },
            skippedReason: "not_found",
          });
          continue;
        }
        const lead = byId.get(id);
        if (!lead) {
          results.push({
            leadId: id,
            businessName: "",
            facebook: null,
            instagram: null,
            updated: false,
            socialDebug: { step: "not_found" },
            skippedReason: "not_found",
          });
          continue;
        }
        if (!leadNeedsSocialEnrichment(lead)) {
          results.push({
            leadId: id,
            businessName: String(lead.businessName ?? ""),
            facebook: (lead.facebook as string | null) ?? null,
            instagram: (lead.instagram as string | null) ?? null,
            updated: false,
            socialDebug: { step: "already_complete", leadId: id },
            skippedReason: "already_complete",
          });
          continue;
        }
        const r = await enrichSingleLead(lead as LeadDocLike, userId, network);
        results.push(r);
      }

      const updatedCount = results.filter((r) => r.updated).length;
      const noteParts: string[] = [];
      if (invalid) {
        noteParts.push(`Only the first ${LEADS_PAGE_SIZE} ids were processed.`);
      }
      noteParts.push(
        `Updated ${updatedCount} of ${results.length} lead(s) on this page (cache used when possible).`,
      );

      return NextResponse.json({
        ok: true,
        pilot: true,
        batch: true,
        network,
        pageSize: LEADS_PAGE_SIZE,
        processed: results.length,
        updatedCount,
        results,
        note: noteParts.join(" "),
      });
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

    const lead = allLeads.find((l) => leadNeedsSocialEnrichment(l));

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

    const one = await enrichSingleLead(lead as LeadDocLike, userId, network);

    return NextResponse.json({
      ok: true,
      pilot: true,
      network,
      leadId: one.leadId,
      businessName: one.businessName,
      facebook: one.facebook,
      instagram: one.instagram,
      updated: one.updated,
      note: one.note,
      socialDebug: one.socialDebug,
      urlsFromSearchResults: one.urlsFromSearchResults,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
