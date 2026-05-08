import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { MergeFieldModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const userId = await requireCurrentUserId();
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const body = (await req.json()) as { key?: string; label?: string; value?: string };
    const patch: Record<string, unknown> = {};
    if (typeof body.key === "string") patch.key = body.key.trim().toLowerCase().replace(/\s+/g, "");
    if (typeof body.label === "string") patch.label = body.label.trim();
    if (typeof body.value === "string") patch.value = body.value;
    const doc = await MergeFieldModel.findOneAndUpdate({ _id: id, userId }, patch, { new: true }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ item: doc });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const userId = await requireCurrentUserId();
    const { id } = await ctx.params;
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const doc = await MergeFieldModel.findOneAndDelete({ _id: id, userId }).lean();
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
