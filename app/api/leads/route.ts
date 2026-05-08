import { NextResponse } from "next/server";
import { ensureAppData } from "@/server/ensure-app-data";
import { LeadModel } from "@/server/db/models";

export async function GET() {
  try {
    await ensureAppData();
    const leads = await LeadModel.find()
      .populate("templateId", "name")
      .sort({ updatedAt: -1 })
      .lean();
    const items = leads.map((l) => {
      const t = l.templateId as unknown as { name?: string } | null;
      return {
        ...l,
        templateName: t?.name ?? null,
      };
    });
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
