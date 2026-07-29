import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { CategoryModel, LeadModel, TemplateModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { escapeRegex } from "@/lib/escape-regex";
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
    const body = (await req.json()) as { name?: string; order?: number };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const clash = await CategoryModel.findOne({ _id: { $ne: id }, userId })
        .where("name")
        .regex(new RegExp(`^${escapeRegex(name)}$`, "i"));
      if (clash) return NextResponse.json({ error: `"${clash.name}" already exists` }, { status: 409 });
      patch.name = name;
    }
    if (typeof body.order === "number") patch.order = body.order;
    const doc = await CategoryModel.findOneAndUpdate({ _id: id, userId }, patch, { new: true }).lean();
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
    const target = await CategoryModel.findOne({ _id: id, userId }).lean();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (target.isDefault) {
      return NextResponse.json(
        { error: "Default categories can't be deleted. You can rename it or edit its templates instead." },
        { status: 400 },
      );
    }

    const doc = await CategoryModel.findOneAndDelete({ _id: id, userId }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Templates auto-created for this category go with it. Hand-made templates have a null
    // categoryId and are left alone.
    const linked = await TemplateModel.find({ userId, categoryId: id }).select("_id").lean();
    const linkedIds = linked.map((t) => t._id);

    if (linkedIds.length) {
      const fallback = await TemplateModel.findOne({ userId, _id: { $nin: linkedIds } })
        .sort({ order: 1 })
        .select("_id")
        .lean();
      await LeadModel.updateMany(
        { userId, templateId: { $in: linkedIds } },
        { $set: { templateId: fallback?._id ?? null } },
      );
      await TemplateModel.deleteMany({ userId, _id: { $in: linkedIds } });
    }

    return NextResponse.json({ ok: true, deletedTemplates: linkedIds.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
