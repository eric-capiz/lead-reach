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
      templateId?: string | null;
      status?: "sent" | "pending" | "social_ready";
      email?: string | null;
      instagram?: string | null;
      facebook?: string | null;
      businessName?: string;
      category?: string;
      phone?: string;
    };
    const patch: Record<string, unknown> = {};
    if (body.templateId === null) patch.templateId = null;
    else if (typeof body.templateId === "string" && mongoose.isValidObjectId(body.templateId)) {
      const tplOk = await TemplateModel.exists({ _id: body.templateId, userId });
      if (!tplOk) {
        return NextResponse.json({ error: "Template not found for this user" }, { status: 400 });
      }
      patch.templateId = body.templateId;
    }
    if (body.status === "sent" || body.status === "pending" || body.status === "social_ready") {
      patch.status = body.status;
    }
    if ("email" in body) patch.email = body.email?.trim() || null;
    if ("instagram" in body) patch.instagram = body.instagram?.trim() || null;
    if ("facebook" in body) patch.facebook = body.facebook?.trim() || null;
    if ("instagram" in body || "facebook" in body) {
      console.log("[api/leads PATCH] Social fields", {
        id,
        instagram: patch.instagram,
        facebook: patch.facebook,
      });
    }
    if (typeof body.businessName === "string") patch.businessName = body.businessName.trim();
    if (typeof body.category === "string") patch.category = body.category.trim();
    if (typeof body.phone === "string") patch.phone = body.phone.trim();
    const doc = await LeadModel.findOneAndUpdate({ _id: id, userId }, patch, { new: true })
      .populate("templateId", "name")
      .lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const t = doc.templateId as unknown as { name?: string } | null;
    return NextResponse.json({
      item: { ...doc, templateName: t?.name ?? null },
    });
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
    const doc = await LeadModel.findOneAndDelete({ _id: id, userId }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
