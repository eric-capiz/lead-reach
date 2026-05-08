type LatLng = { latitude: number; longitude: number };

export type PlacesSearchPlace = {
  googlePlaceId: string;
  businessName: string;
  location: string;
  phone: string;
  websiteUri: string | null;
  googleMapsUrl: string;
};

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
].join(",");

function displayNameText(p: { displayName?: { text?: string } }): string {
  return p.displayName?.text?.trim() || "Unknown business";
}

export async function geocodeAddress(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lng: number }> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  const data = (await res.json()) as {
    status: string;
    error_message?: string;
    results?: { geometry: { location: { lat: number; lng: number } } }[];
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || `Geocode failed: ${data.status}`);
  }
  const loc = data.results?.[0]?.geometry?.location;
  if (!loc) throw new Error("No geocode results for that address");
  return { lat: loc.lat, lng: loc.lng };
}

function metersFromMiles(miles: number): number {
  return Math.round(miles * 1609.344);
}

export async function searchPlacesText(params: {
  apiKey: string;
  textQuery: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  pageSize?: number;
}): Promise<PlacesSearchPlace[]> {
  const { apiKey, textQuery, center, radiusMiles, pageSize = 20 } = params;
  const radiusM = Math.min(Math.max(metersFromMiles(radiusMiles), 1000), 50000);

  const body = {
    textQuery,
    pageSize: Math.min(pageSize, 20),
    languageCode: "en",
    regionCode: "US",
    locationBias: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng } satisfies LatLng,
        radius: radiusM,
      },
    },
  };

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Places searchText failed (${res.status}): ${errText.slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    places?: {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      nationalPhoneNumber?: string;
      websiteUri?: string;
      googleMapsUri?: string;
    }[];
  };

  const out: PlacesSearchPlace[] = [];
  for (const p of data.places ?? []) {
    const googlePlaceId = p.id?.trim();
    if (!googlePlaceId) continue;
    const websiteUri = p.websiteUri?.trim() || null;
    out.push({
      googlePlaceId,
      businessName: displayNameText(p),
      location: p.formattedAddress?.trim() || "",
      phone: p.nationalPhoneNumber?.trim() || "",
      websiteUri,
      googleMapsUrl:
        p.googleMapsUri?.trim() ||
        `https://www.google.com/maps/search/?api=1&query_place_id=${googlePlaceId}`,
    });
  }
  return out;
}

export function filterByWebsitePreference(
  places: PlacesSearchPlace[],
  filter: "no_website" | "any" | "has_website",
): PlacesSearchPlace[] {
  if (filter === "any") return places;
  if (filter === "no_website") {
    return places.filter((p) => !p.websiteUri);
  }
  return places.filter((p) => Boolean(p.websiteUri));
}
