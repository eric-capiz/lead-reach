import { NextResponse } from "next/server";
import { MergeFieldModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

export async function GET() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const items = await MergeFieldModel.find({ userId }).sort({ key: 1 }).lean();
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const body = (await req.json()) as { key?: string; label?: string; value?: string };
    const key = body.key?.trim().toLowerCase().replace(/\s+/g, "");
    const label = body.label?.trim();
    if (!key || !label) {
      return NextResponse.json({ error: "key and label required" }, { status: 400 });
    }
    const doc = await MergeFieldModel.create({
      userId,
      key,
      label,
      value: body.value ?? "",
    });
    return NextResponse.json({ item: doc.toObject() }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg.includes("duplicate")) {
      return NextResponse.json({ error: "Key already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
