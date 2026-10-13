import { NextResponse } from "next/server";
import { LeadModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

export async function GET() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const [total, noWebsite, emailsFound, messagesSent] = await Promise.all([
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
      LeadModel.countDocuments({ userId, isSample: { $ne: true }, status: "sent" }),
    ]);
    return NextResponse.json({
      stats: {
        leadsFound: total,
        noWebsite,
        emailsFound,
        messagesSent,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
