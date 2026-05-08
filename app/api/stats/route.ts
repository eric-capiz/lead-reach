import { NextResponse } from "next/server";
import { LeadModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";

export async function GET() {
  try {
    const userId = await requireCurrentUserId();
    const [total, noWebsite, emailsFound, socialMatches, messagesSent] = await Promise.all([
      LeadModel.countDocuments({ userId, isSample: { $ne: true } }),
      LeadModel.countDocuments({
        userId,
        isSample: { $ne: true },
        $or: [
          { websiteStatus: "No website" },
          { websiteUri: null },
          { websiteUri: "" },
        ],
      }),
      LeadModel.countDocuments({
        userId,
        isSample: { $ne: true },
        email: { $type: "string", $regex: /\S/ },
      }),
      LeadModel.countDocuments({
        userId,
        isSample: { $ne: true },
        $or: [
          { instagram: { $nin: [null, ""] } },
          { facebook: { $nin: [null, ""] } },
        ],
      }),
      LeadModel.countDocuments({ userId, isSample: { $ne: true }, status: "sent" }),
    ]);
    return NextResponse.json({
      stats: {
        leadsFound: total,
        noWebsite,
        emailsFound,
        socialMatches,
        messagesSent,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
