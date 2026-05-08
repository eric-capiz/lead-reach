import { NextResponse } from "next/server";
import { AppSettingsModel, LeadModel, TemplateModel } from "@/server/db/models";
import { ensureAppData } from "@/server/ensure-app-data";
import { filterByWebsitePreference, geocodeAddress, searchPlacesText } from "@/server/services/places";

export async function POST(req: Request) {
  try {
    await ensureAppData();
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_MAPS_API_KEY" }, { status: 500 });
    }

    const body = (await req.json()) as {
      mode?: "category" | "name";
      categoryName?: string;
      nameQuery?: string;
      websiteFilter?: "no_website" | "any" | "has_website";
    };

    const settings = await AppSettingsModel.findOne().sort({ createdAt: 1 });
    if (!settings) return NextResponse.json({ error: "No settings" }, { status: 500 });

    const websiteFilter = body.websiteFilter ?? settings.websiteFilter ?? "no_website";
    const center = await geocodeAddress(settings.locationAddress, apiKey);

    const mode = body.mode === "name" ? "name" : "category";
    const loc = settings.locationAddress.trim();
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
      radiusMiles: settings.radiusMiles,
      pageSize: 20,
    });

    const filtered = filterByWebsitePreference(raw, websiteFilter);
    const defaultTpl = await TemplateModel.findOne().sort({ order: 1 }).select("_id");
    const defaultTemplateId = defaultTpl?._id ?? null;

    const saved: string[] = [];
    const categoryLabel = mode === "category" ? (body.categoryName?.trim() || "") : "";

    for (const p of filtered) {
      const websiteUri = p.websiteUri;
      const websiteStatus = websiteUri ? "Has website" : "No website";
      const setOnInsert: Record<string, unknown> = { googlePlaceId: p.googlePlaceId };
      if (defaultTemplateId) setOnInsert.templateId = defaultTemplateId;
      const doc = await LeadModel.findOneAndUpdate(
        { googlePlaceId: p.googlePlaceId },
        {
          $set: {
            businessName: p.businessName,
            category: categoryLabel,
            location: p.location,
            phone: p.phone,
            websiteUri,
            websiteStatus,
            googleMapsUrl: p.googleMapsUrl,
          },
          $setOnInsert: setOnInsert,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      saved.push(String(doc!._id));
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
