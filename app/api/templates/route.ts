import { NextResponse } from "next/server";
import { TemplateModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

export async function GET() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const items = await TemplateModel.find({ userId }).sort({ order: 1, name: 1 }).lean();
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
    const body = (await req.json()) as {
      name?: string;
      subject?: string;
      body?: string;
      categoryTag?: string;
      useWhenNoCategoryMatch?: boolean;
      order?: number;
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const useWhenNoCategoryMatch = Boolean(body.useWhenNoCategoryMatch);
    const doc = await TemplateModel.create({
      userId,
      name,
      subject: body.subject?.trim() ?? "",
      body: body.body ?? "",
      categoryTag: body.categoryTag?.trim() ?? "",
      useWhenNoCategoryMatch,
      order: typeof body.order === "number" ? body.order : 0,
    });
    if (useWhenNoCategoryMatch) {
      await TemplateModel.updateMany(
        { userId, _id: { $ne: doc._id } },
        { $set: { useWhenNoCategoryMatch: false } },
      );
    }
    return NextResponse.json({ item: doc.toObject() }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg.includes("duplicate")) {
      return NextResponse.json({ error: "Template name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
