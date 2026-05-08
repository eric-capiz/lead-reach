import { NextResponse } from "next/server";
import { ensureAppData } from "@/server/ensure-app-data";
import { AppSettingsModel } from "@/server/db/models";

export async function GET() {
  try {
    await ensureAppData();
    const doc = await AppSettingsModel.findOne().sort({ createdAt: 1 }).lean();
    return NextResponse.json({ settings: doc });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    await ensureAppData();
    const body = (await req.json()) as {
      locationAddress?: string;
      radiusMiles?: number;
      websiteFilter?: "no_website" | "any" | "has_website";
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.locationAddress === "string") patch.locationAddress = body.locationAddress.trim();
    if (typeof body.radiusMiles === "number" && body.radiusMiles > 0 && body.radiusMiles <= 200) {
      patch.radiusMiles = body.radiusMiles;
    }
    if (body.websiteFilter === "no_website" || body.websiteFilter === "any" || body.websiteFilter === "has_website") {
      patch.websiteFilter = body.websiteFilter;
    }
    const base = await AppSettingsModel.findOne().sort({ createdAt: 1 });
    if (!base) return NextResponse.json({ error: "No settings" }, { status: 500 });
    Object.assign(base, patch);
    await base.save();
    return NextResponse.json({ settings: base.toObject() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
