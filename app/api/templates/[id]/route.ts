import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { ensureAppData } from "@/server/ensure-app-data";
import { LeadModel, TemplateModel } from "@/server/db/models";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await ensureAppData();
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      name?: string;
      subject?: string;
      body?: string;
      categoryTag?: string;
      order?: number;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.subject === "string") patch.subject = body.subject;
    if (typeof body.body === "string") patch.body = body.body;
    if (typeof body.categoryTag === "string") patch.categoryTag = body.categoryTag;
    if (typeof body.order === "number") patch.order = body.order;
    const doc = await TemplateModel.findByIdAndUpdate(id, patch, { new: true }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item: doc });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await ensureAppData();
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const count = await TemplateModel.countDocuments();
    if (count <= 1) {
      return NextResponse.json({ error: "Cannot delete the last template" }, { status: 400 });
    }
    const fallback = await TemplateModel.findOne({ _id: { $ne: id } }).sort({ order: 1 }).select("_id");
    if (!fallback) return NextResponse.json({ error: "No fallback template" }, { status: 500 });
    await LeadModel.updateMany({ templateId: id }, { templateId: fallback._id });
    const doc = await TemplateModel.findByIdAndDelete(id).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
