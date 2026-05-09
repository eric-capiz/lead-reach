import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { AppSettingsModel, LeadModel, TemplateModel } from "@/server/db/models";
import { filterByWebsitePreference, geocodeAddress, searchPlacesText } from "@/server/services/places";
import { requireCurrentUserId } from "@/server/auth/session";
import { getGoogleApiKey } from "@/server/lib/google-api-key";
import { connectDB } from "@/server/db/connect";

/** Normalize category tags for comparison (trim, lowercase, collapse spaces). */
function normalizeCategoryTag(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function heuristicGeneralTemplateId(
  templates: { _id: unknown; name?: string; categoryTag?: string }[],
): mongoose.Types.ObjectId | null {
  const byTag = templates.find((t) => {
    const tag = normalizeCategoryTag(String(t.categoryTag ?? ""));
    return tag === "general" || tag === "default" || tag === "catchall";
  });
  if (byTag) return byTag._id as mongoose.Types.ObjectId;

  const byName = templates.find((t) => {
    const n = normalizeCategoryTag(String(t.name ?? ""));
    return n === "general" || n.startsWith("general ");
  });
  return byName ? (byName._id as mongoose.Types.ObjectId) : null;
}

/**
 * Pick template for this run:
 * 1) Template **name** matches the category label (case insensitive)
 * 2) Else **categoryTag** matches
 * 3) Else template with **useWhenNoCategoryMatch** (explicit default)
 * 4) Else heuristic "general" (tag/name)
 * Name-only runs: then first template by order if still unset.
 * Category runs: do **not** fall back to first template (avoids wrong vertical).
 */
async function resolveTemplateIdForPlacesRun(
  userId: string,
  categoryLabel: string,
  mode: "category" | "name",
): Promise<mongoose.Types.ObjectId | null> {
  const templates = await TemplateModel.find({ userId })
    .sort({ order: 1 })
    .select("_id name categoryTag useWhenNoCategoryMatch")
    .lean();
  if (!templates.length) return null;

  const fallbackFirst = templates[0]!._id as mongoose.Types.ObjectId;
  const explicitDefault = templates.find((t) => t.useWhenNoCategoryMatch)?._id as
    | mongoose.Types.ObjectId
    | undefined;
  const heuristicGeneral = heuristicGeneralTemplateId(templates);

  if (mode === "name" || !normalizeCategoryTag(categoryLabel)) {
    return explicitDefault ?? heuristicGeneral ?? fallbackFirst;
  }

  const want = normalizeCategoryTag(categoryLabel);
  const byName = templates.find((t) => normalizeCategoryTag(String(t.name ?? "")) === want);
  if (byName) return byName._id as mongoose.Types.ObjectId;

  const byTag = templates.find((t) => normalizeCategoryTag(String(t.categoryTag ?? "")) === want);
  if (byTag) return byTag._id as mongoose.Types.ObjectId;

  return explicitDefault ?? heuristicGeneral ?? null;
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const apiKey = getGoogleApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_API_KEY" }, { status: 500 });
    }

    const body = (await req.json()) as {
      mode?: "category" | "name";
      categoryName?: string;
      nameQuery?: string;
      locationAddress?: string;
      radiusMiles?: number;
      websiteFilter?: "no_website" | "any" | "has_website";
    };

    const settings = await AppSettingsModel.findOne({ userId });
    if (!settings) return NextResponse.json({ error: "No settings" }, { status: 500 });

    const locationAddress = body.locationAddress?.trim() || settings.locationAddress;
    if (!locationAddress?.trim()) {
      return NextResponse.json({ error: "locationAddress required" }, { status: 400 });
    }
    const radiusMiles =
      typeof body.radiusMiles === "number" && body.radiusMiles > 0 && body.radiusMiles <= 200
        ? body.radiusMiles
        : settings.radiusMiles;
    const websiteFilter = body.websiteFilter ?? settings.websiteFilter ?? "no_website";

    // Keep "last used" run inputs as current settings.
    settings.locationAddress = locationAddress;
    settings.radiusMiles = radiusMiles;
    settings.websiteFilter = websiteFilter;
    await settings.save();

    const center = await geocodeAddress(locationAddress, apiKey);

    const mode = body.mode === "name" ? "name" : "category";
    const loc = locationAddress.trim();
    let textQuery: string;
    if (mode === "category") {
      const cat = body.categoryName?.trim() || "";
      if (!cat) {
        return NextResponse.json({ error: "categoryName required for category mode" }, { status: 400 });
      }
      const extra = body.nameQuery?.trim() || "";
      textQuery = [cat, extra, loc].filter(Boolean).join(" ");
    } else {
      const q = body.nameQuery?.trim() || "";
      if (!q) return NextResponse.json({ error: "nameQuery required for name mode" }, { status: 400 });
      textQuery = [q, loc].filter(Boolean).join(" ");
    }

    const raw = await searchPlacesText({
      apiKey,
      textQuery,
      center,
      radiusMiles,
      pageSize: 20,
    });

    const filtered = filterByWebsitePreference(raw, websiteFilter);

    const saved: string[] = [];
    const categoryLabel = mode === "category" ? (body.categoryName?.trim() || "") : "";

    const resolvedTemplateId = await resolveTemplateIdForPlacesRun(userId, categoryLabel, mode);

    if (mode === "category" && normalizeCategoryTag(categoryLabel) && !resolvedTemplateId) {
      return NextResponse.json(
        {
          error:
            "No email template for this category. Match the category: rename a template to the same name as the category, set its optional category tag, turn on “Use when no category matches” on your general template, or name/tag a template as general.",
        },
        { status: 400 },
      );
    }

    for (const p of filtered) {
      const websiteUri = p.websiteUri;
      const websiteStatus = websiteUri ? "Has website" : "No website";
      const $set: Record<string, unknown> = {
        userId,
        businessName: p.businessName,
        category: categoryLabel,
        location: p.location,
        phone: p.phone,
        websiteUri,
        websiteStatus,
        googleMapsUrl: p.googleMapsUrl,
        isSample: false,
      };
      if (resolvedTemplateId) $set.templateId = resolvedTemplateId;

      const doc = await LeadModel.findOneAndUpdate(
        { userId, googlePlaceId: p.googlePlaceId },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      saved.push(String(doc!._id));
    }

    if (saved.length > 0) {
      await LeadModel.deleteMany({ userId, isSample: true });
    }

    return NextResponse.json({
      ok: true,
      textQuery,
      rawCount: raw.length,
      matchedCount: filtered.length,
      savedCount: saved.length,
      leadIds: saved,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Run failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
