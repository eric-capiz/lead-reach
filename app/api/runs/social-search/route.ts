import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { LeadModel, SocialResolveCacheModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";
import { serpSearchUrlForQuery, socialSearchStem } from "@/server/services/social-serp";
import {
  adLibraryUrlsForNetwork,
  searchAdLibraryPages,
} from "@/server/services/social-ad-library";
import { resolveSocialProfile, trustExistingSocialUrl } from "@/server/services/social-resolve";
import { isSocialLlmEnabled as groqEnabled } from "@/server/services/social-llm";
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
  leadIds?: string[];
};

type SerpUrlSample = {
  query: string | null;
  winningQuery: string | null;
  urls: string[];
  serpSearchUrlForDisplayQuery?: string;
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
  phone?: string;
  facebook?: unknown;
  instagram?: unknown;
  googlePlaceId?: unknown;
};

async function enrichSingleLead(
  lead: LeadDocLike,
  userId: string,
  network: Network,
): Promise<OneLeadSocialResult> {
  const loc = (lead.location ?? "").trim();
  const biz = (lead.businessName ?? "").trim();
  const phone = (lead.phone ?? "").trim();
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
      socialDebug: { step: "no_search_query", leadId: String(lead._id) },
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
  const aiMode = groqEnabled();

  const socialDebug: Record<string, unknown> = {
    step: "searched",
    leadId: String(lead._id),
    placeId,
    searchStem,
    network,
    needFb,
    needIg,
    aiMode,
    cacheHitFacebook: false,
    cacheHitInstagram: false,
  };

  if (needFb && network !== "instagram" && cached && hasLeadSocialUrl(cached.facebook)) {
    const ok = await trustExistingSocialUrl(cached.facebook as string, biz, loc, "facebook");
    if (ok) {
      patch.facebook = cached.facebook as string;
      socialDebug.cacheHitFacebook = true;
    } else {
      socialDebug.cacheRejectedFacebook = cached.facebook;
    }
  }

  if (needIg && network !== "facebook" && cached && hasLeadSocialUrl(cached.instagram)) {
    const ok = await trustExistingSocialUrl(cached.instagram as string, biz, loc, "instagram");
    if (ok) {
      patch.instagram = cached.instagram as string;
      socialDebug.cacheHitInstagram = true;
    } else {
      socialDebug.cacheRejectedInstagram = cached.instagram;
    }
  }

  // One Ad Library lookup per lead — often returns FB page + linked IG handle together
  let adFb: string[] = [];
  let adIg: string[] = [];
  if ((needFb && network !== "instagram" && !patch.facebook) || (needIg && network !== "facebook" && !patch.instagram)) {
    try {
      const hits = await searchAdLibraryPages(biz);
      adFb = adLibraryUrlsForNetwork(hits, "facebook");
      adIg = adLibraryUrlsForNetwork(hits, "instagram");
      socialDebug.adLibrary = { facebook: adFb, instagram: adIg, hitCount: hits.length };
    } catch (e) {
      socialDebug.adLibrary = { error: e instanceof Error ? e.message : "failed" };
    }
  }

  // FACEBOOK search (separate)
  if (needFb && network !== "instagram" && !patch.facebook) {
    try {
      console.log(`[social-search] FB search start: ${biz}`);
      const result = await resolveSocialProfile({
        businessName: biz,
        location: loc,
        phone,
        network: "facebook",
        extraCandidates: adFb,
      });
      console.log(
        `[social-search] FB search done: chosen=${result.chosen ?? "none"} candidates=${result.candidateUrls.length}`,
      );
      serpSampleFb.query = result.searchQuery;
      serpSampleFb.winningQuery = result.winningQuery;
      serpSampleFb.urls = result.candidateUrls;
      serpSampleFb.serpSearchUrlForDisplayQuery =
        result.searchUrl ?? serpSearchUrlForQuery(result.searchQuery);
      socialDebug.facebook = {
        sources: result.sources,
        searchQuery: result.searchQuery,
        candidates: result.candidateUrls,
        aiPick: result.aiPick,
        attempts: result.attempts,
        chosen: result.chosen,
      };
      if (result.chosen) patch.facebook = result.chosen;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      fetchIssues.push("Facebook search could not be completed.");
      socialDebug.facebook = { error: msg };
      console.error(`[social-search] FB search error: ${msg}`);
    }
  }

  // INSTAGRAM search (separate; always its own name + Instagram SERP)
  if (needIg && network !== "facebook" && !patch.instagram) {
    try {
      const fbHint =
        patch.facebook ??
        (hasLeadSocialUrl(lead.facebook) ? String(lead.facebook) : null) ??
        adFb[0] ??
        null;
      console.log(`[social-search] IG search start: ${biz}`);
      const result = await resolveSocialProfile({
        businessName: biz,
        location: loc,
        phone,
        network: "instagram",
        extraCandidates: adIg,
        facebookUrlHint: fbHint,
      });
      console.log(
        `[social-search] IG search done: chosen=${result.chosen ?? "none"} candidates=${result.candidateUrls.length} sources=${result.sources.join(",")}`,
      );
      serpSampleIg.query = result.searchQuery;
      serpSampleIg.winningQuery = result.winningQuery;
      serpSampleIg.urls = result.candidateUrls;
      serpSampleIg.serpSearchUrlForDisplayQuery =
        result.searchUrl ?? serpSearchUrlForQuery(result.searchQuery);
      socialDebug.instagram = {
        sources: result.sources,
        searchQuery: result.searchQuery,
        candidates: result.candidateUrls,
        aiPick: result.aiPick,
        attempts: result.attempts,
        chosen: result.chosen,
        facebookUrlHint: fbHint,
      };
      if (result.chosen) patch.instagram = result.chosen;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown error";
      fetchIssues.push("Instagram search could not be completed.");
      socialDebug.instagram = { error: msg };
      console.error(`[social-search] IG search error: ${msg}`);
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

  const parts: string[] = [...fetchIssues];
  if (!patch.facebook && needFb && !fetchIssues.some((x) => x.includes("Facebook"))) {
    parts.push("No Facebook profile verified for this lead.");
  }
  if (!patch.instagram && needIg && !fetchIssues.some((x) => x.includes("Instagram"))) {
    parts.push("No Instagram profile verified for this lead.");
  }

  return {
    leadId: String(lead._id),
    businessName: lead.businessName ?? "",
    facebook: patch.facebook ?? (lead.facebook as string | null) ?? null,
    instagram: patch.instagram ?? (lead.instagram as string | null) ?? null,
    updated: Object.keys(patch).length > 0,
    note: parts.length ? parts.join(" ") : undefined,
    socialDebug,
    urlsFromSearchResults: { facebook: serpSampleFb, instagram: serpSampleIg },
  };
}

/**
 * Body: `{ network?, leadIds? }`.
 * With `leadIds`: enrich those leads (current table page), order preserved.
 * Without `leadIds`: one lead globally that still needs FB/IG.
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
        results.push(await enrichSingleLead(lead as LeadDocLike, userId, network));
      }

      const updatedCount = results.filter((r) => r.updated).length;
      const noteParts: string[] = [];
      if (invalid) noteParts.push(`Only the first ${LEADS_PAGE_SIZE} ids were processed.`);
      noteParts.push(`Updated ${updatedCount} of ${results.length} lead(s) on this page.`);

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
