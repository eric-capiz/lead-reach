import { NextResponse } from "next/server";
import { CategoryModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { ensureUserSeeded } from "@/server/services/seed-defaults";

export async function GET() {
  try {
    const userId = await requireCurrentUserId();
    await ensureUserSeeded(userId);
    const items = await CategoryModel.find({ userId }).sort({ order: 1, name: 1 }).lean();
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireCurrentUserId();
    await ensureUserSeeded(userId);
    const body = (await req.json()) as { name?: string; order?: number };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const doc = await CategoryModel.create({
      userId,
      name,
      order: typeof body.order === "number" ? body.order : 0,
    });
    return NextResponse.json({ item: doc.toObject() }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg.includes("duplicate")) {
      return NextResponse.json({ error: "Category already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
