import { NextResponse } from "next/server";
import { AppSettingsModel, LeadModel, TemplateModel } from "@/server/db/models";
import { filterByWebsitePreference, geocodeAddress, searchPlacesText } from "@/server/services/places";
import { requireCurrentUserId } from "@/server/auth/session";
import { getGoogleApiKey } from "@/server/lib/google-api-key";

export async function POST(req: Request) {
  try {
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
    const defaultTpl = await TemplateModel.findOne({ userId }).sort({ order: 1 }).select("_id");
    const defaultTemplateId = defaultTpl?._id ?? null;

    const saved: string[] = [];
    const categoryLabel = mode === "category" ? (body.categoryName?.trim() || "") : "";

    for (const p of filtered) {
      const websiteUri = p.websiteUri;
      const websiteStatus = websiteUri ? "Has website" : "No website";
      const setOnInsert: Record<string, unknown> = {};
      if (defaultTemplateId) setOnInsert.templateId = defaultTemplateId;
      const doc = await LeadModel.findOneAndUpdate(
        { userId, googlePlaceId: p.googlePlaceId },
        {
          $set: {
            userId,
            businessName: p.businessName,
            category: categoryLabel,
            location: p.location,
            phone: p.phone,
            websiteUri,
            websiteStatus,
            googleMapsUrl: p.googleMapsUrl,
            isSample: false,
          },
          $setOnInsert: setOnInsert,
        },
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
