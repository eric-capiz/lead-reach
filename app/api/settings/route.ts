import { NextResponse } from "next/server";
import { AppSettingsModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

export async function GET() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const doc = await AppSettingsModel.findOne({ userId }).lean();
    return NextResponse.json({ settings: doc });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
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
    const base = await AppSettingsModel.findOne({ userId });
    if (!base) return NextResponse.json({ error: "No settings" }, { status: 500 });
    Object.assign(base, patch);
    await base.save();
    return NextResponse.json({ settings: base.toObject() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
