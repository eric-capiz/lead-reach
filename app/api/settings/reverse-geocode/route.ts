import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUserId } from "@/server/auth/session";

type GeocodeResponse = {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
  }>;
};

export async function GET(req: NextRequest) {
  try {
    await requireCurrentUserId();
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GOOGLE_MAPS_API_KEY" }, { status: 500 });
    }

    const lat = Number(req.nextUrl.searchParams.get("lat"));
    const lng = Number(req.nextUrl.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "lat/lng required" }, { status: 400 });
    }

    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    const data = (await res.json()) as GeocodeResponse;

    if (data.status !== "OK" || !data.results?.length) {
      return NextResponse.json({ error: data.error_message || "Could not resolve location" }, { status: 400 });
    }

    const first = data.results[0]!;
    const components = first.address_components ?? [];
    const pick = (type: string) => components.find((c) => c.types?.includes(type))?.long_name?.trim() ?? "";
    const pickShort = (type: string) => components.find((c) => c.types?.includes(type))?.short_name?.trim() ?? "";

    const postalCode = pick("postal_code");
    const city = pick("locality") || pick("postal_town") || pick("administrative_area_level_2");
    const state = pickShort("administrative_area_level_1");

    const locationText =
      postalCode || (city && state ? `${city}, ${state}` : city || first.formatted_address?.trim() || "");

    if (!locationText) {
      return NextResponse.json({ error: "Could not resolve location" }, { status: 400 });
    }

    return NextResponse.json({ locationText });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

