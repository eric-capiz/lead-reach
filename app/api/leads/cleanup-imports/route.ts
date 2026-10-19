import { NextResponse } from "next/server";
import { LeadModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

/**
 * TEMPORARY cleanup endpoint — removes leads imported from the Texas
 * spreadsheet (googlePlaceId starts with "import-"). Delete this file
 * after use. Token-gated + requires login.
 */
const CLEANUP_TOKEN = "056852f476a73915910c50db30168948";

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (token !== CLEANUP_TOKEN) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    await connectDB();
    const userId = await requireCurrentUserId();
    const result = await LeadModel.deleteMany({
      userId,
      googlePlaceId: { $regex: "^import-" },
    });
    return NextResponse.json({ ok: true, deletedCount: result.deletedCount ?? 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cleanup failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
