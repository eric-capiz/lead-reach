import { NextResponse } from "next/server";
import { LeadModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { leadNeedsSocialEnrichment } from "@/server/lib/lead-socials";
import { connectDB } from "@/server/db/connect";

export async function GET() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const [total, noWebsite, emailsFound, socialMatches, messagesSent, leadSocialSlice] = await Promise.all([
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
      LeadModel.find({ userId, isSample: { $ne: true } })
        .select({ facebook: 1, instagram: 1, businessName: 1, location: 1 })
        .lean(),
    ]);
    const leadsNeedingSocials = leadSocialSlice.filter(leadNeedsSocialEnrichment).length;
    return NextResponse.json({
      stats: {
        leadsFound: total,
        noWebsite,
        emailsFound,
        socialMatches,
        messagesSent,
        leadsNeedingSocials,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
