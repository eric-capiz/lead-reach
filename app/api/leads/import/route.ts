import { NextResponse } from "next/server";
import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { LeadModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

/**
 * POST /api/leads/import
 * Accepts a multipart upload with an .xlsx lead spreadsheet (the format we
 * generate: "Leads" sheet with Business Name, Category, City, Address,
 * Google Maps, Facebook, Instagram, Email, Website Status, Notes columns).
 * The Maps/Facebook/Instagram cells contain "link" text hyperlinked to the
 * real URL — hyperlinks are resolved back to URLs on import.
 */
export async function POST(req: Request) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (!/\.xlsx?$/i.test(file.name)) {
      return NextResponse.json({ error: "Only .xlsx files are supported" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames.includes("Leads") ? "Leads" : wb.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ error: "Spreadsheet has no sheets" }, { status: 400 });
    }
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      return NextResponse.json({ error: "Could not read spreadsheet" }, { status: 400 });
    }

    // Read as a 2D array so we can resolve hyperlinks ("link" text -> real URL).
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
    if (rows.length < 2) {
      return NextResponse.json({ error: "No data rows found" }, { status: 400 });
    }

    const header = (rows[0] as unknown[]).map((h) => String(h ?? "").trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);

    const cName = col("business name");
    if (cName < 0) {
      return NextResponse.json({ error: 'Missing "Business Name" column' }, { status: 400 });
    }
    const cCategory = col("category");
    const cCity = col("city");
    const cAddress = col("address");
    const cMaps = col("google maps");
    const cFb = col("facebook");
    const cIg = col("instagram");
    const cEmail = col("email");
    const cSiteStatus = col("website status");
    const cNotes = col("notes");

    // Resolve a cell's value: if it's "link" text with a hyperlink, use the URL.
    // (openpyxl HTML-escapes & as &amp; in stored hyperlink targets, so decode.)
    const decodeEntities = (s: string): string =>
      s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    const cellValue = (r: number, c: number): string => {
      if (c < 0) return "";
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as { v?: unknown; l?: { Target?: string } } | undefined;
      if (cell?.l?.Target) return decodeEntities(String(cell.l.Target));
      const row = rows[r] as unknown[];
      return String(row?.[c] ?? "").trim();
    };

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let r = 1; r < rows.length; r++) {
      const businessName = cellValue(r, cName).trim();
      if (!businessName || /^link$/i.test(businessName)) {
        skipped++;
        continue;
      }
      const city = cCity >= 0 ? cellValue(r, cCity).trim() : "";
      const dedupeKey = `${businessName.toLowerCase()}|${city.toLowerCase()}`;
      const googlePlaceId = `import-${createHash("sha1").update(dedupeKey).digest("hex").slice(0, 24)}`;

      try {
        const exists = await LeadModel.findOne({ userId, googlePlaceId }).select("_id").lean();
        if (exists) {
          skipped++;
          continue;
        }

        const email = cEmail >= 0 ? cellValue(r, cEmail).trim() : "";
        const mapsUrl = cMaps >= 0 ? cellValue(r, cMaps).trim() : "";
        const facebook = cFb >= 0 ? cellValue(r, cFb).trim() : "";
        const instagram = cIg >= 0 ? cellValue(r, cIg).trim() : "";
        const address = cAddress >= 0 ? cellValue(r, cAddress).trim() : "";
        const websiteStatus = cSiteStatus >= 0 ? cellValue(r, cSiteStatus).trim() : "No website";
        const notes = cNotes >= 0 ? cellValue(r, cNotes).trim() : "";

        await LeadModel.create({
          userId,
          googlePlaceId,
          businessName,
          category: cCategory >= 0 ? cellValue(r, cCategory).trim() : "",
          location: city,
          phone: "",
          email: email || null,
          websiteStatus: websiteStatus || "No website",
          websiteUri: null,
          googleMapsUrl: mapsUrl || "https://www.google.com/maps",
          instagram: instagram && instagram !== "link" ? instagram : null,
          facebook: facebook && facebook !== "link" ? facebook : null,
          address,
          notes,
          status: "pending",
          isSample: false,
        });
        imported++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed";
        if (msg.includes("duplicate")) {
          skipped++;
        } else {
          errors.push(`${businessName}: ${msg}`);
        }
      }
    }

    return NextResponse.json({ ok: true, imported, skipped, errors: errors.slice(0, 10) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Import failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
