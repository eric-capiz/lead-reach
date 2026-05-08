import { NextResponse } from "next/server";
import { ensureAppData } from "@/server/ensure-app-data";
import { LeadModel } from "@/server/db/models";

export async function GET() {
  try {
    await ensureAppData();
    const [total, noWebsite, emailsFound, socialMatches, messagesSent] = await Promise.all([
      LeadModel.countDocuments(),
      LeadModel.countDocuments({
        $or: [
          { websiteStatus: "No website" },
          { websiteUri: null },
          { websiteUri: "" },
        ],
      }),
      LeadModel.countDocuments({
        email: { $type: "string", $regex: /\S/ },
      }),
      LeadModel.countDocuments({
        $or: [
          { instagram: { $nin: [null, ""] } },
          { facebook: { $nin: [null, ""] } },
        ],
      }),
      LeadModel.countDocuments({ status: "sent" }),
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
