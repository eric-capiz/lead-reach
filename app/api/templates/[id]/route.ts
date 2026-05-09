import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { LeadModel, TemplateModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as {
      name?: string;
      subject?: string;
      body?: string;
      categoryTag?: string;
      useWhenNoCategoryMatch?: boolean;
      order?: number;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.subject === "string") patch.subject = body.subject;
    if (typeof body.body === "string") patch.body = body.body;
    if (typeof body.categoryTag === "string") patch.categoryTag = body.categoryTag;
    if (typeof body.order === "number") patch.order = body.order;
    if (typeof body.useWhenNoCategoryMatch === "boolean") {
      patch.useWhenNoCategoryMatch = body.useWhenNoCategoryMatch;
      if (body.useWhenNoCategoryMatch) {
        await TemplateModel.updateMany(
          { userId, _id: { $ne: id } },
          { $set: { useWhenNoCategoryMatch: false } },
        );
      }
    }
    const doc = await TemplateModel.findOneAndUpdate({ _id: id, userId }, patch, { new: true }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item: doc });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const count = await TemplateModel.countDocuments({ userId });
    if (count <= 1) {
      return NextResponse.json({ error: "Cannot delete the last template" }, { status: 400 });
    }
    const fallback = await TemplateModel.findOne({ _id: { $ne: id }, userId }).sort({ order: 1 }).select("_id");
    if (!fallback) return NextResponse.json({ error: "No fallback template" }, { status: 500 });
    await LeadModel.updateMany({ templateId: id, userId }, { templateId: fallback._id });
    const doc = await TemplateModel.findOneAndDelete({ _id: id, userId }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
