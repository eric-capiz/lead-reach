import { NextRequest, NextResponse } from "next/server";
import { LeadModel } from "@/server/db/models";
import { escapeRegex } from "@/lib/escape-regex";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

export async function GET(req: NextRequest) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const search = searchParams.get("search")?.trim() ?? "";
    const sortParam = searchParams.get("sort") === "old" ? "old" : "new";
    const sortDir = sortParam === "old" ? 1 : -1;

    const filter: Record<string, unknown> = { userId, isSample: { $ne: true } };
    if (search) {
      filter.businessName = { $regex: escapeRegex(search), $options: "i" };
    }

    const skip = (page - 1) * limit;

    const [total, leads] = await Promise.all([
      LeadModel.countDocuments(filter),
      LeadModel.find(filter)
        .populate("templateId", "name")
        .sort({ updatedAt: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const items = leads.map((l) => {
      const t = l.templateId as unknown as { name?: string } | null;
      return {
        ...l,
        templateName: t?.name ?? null,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const result = await LeadModel.deleteMany({ userId });
    return NextResponse.json({
      ok: true,
      deletedCount: result.deletedCount ?? 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
