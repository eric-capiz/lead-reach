import { NextResponse } from "next/server";
import { CategoryModel, TemplateModel } from "@/server/db/models";
import { requireCurrentUserId } from "@/server/auth/session";
import { defaultTemplateFor } from "@/server/services/default-templates";
import { escapeRegex } from "@/lib/escape-regex";
import { connectDB } from "@/server/db/connect";

export async function GET() {
  try {
    await connectDB();
    const userId = await requireCurrentUserId();
    const items = await CategoryModel.find({ userId }).sort({ order: 1, name: 1 }).lean();
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
    const body = (await req.json()) as { name?: string; order?: number };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    // The unique index is exact, so "Barbers" and "barbers" would both be accepted without this.
    const clash = await CategoryModel.findOne({ userId }).where("name").regex(
      new RegExp(`^${escapeRegex(name)}$`, "i"),
    );
    if (clash) {
      return NextResponse.json({ error: `"${clash.name}" already exists` }, { status: 409 });
    }

    const doc = await CategoryModel.create({
      userId,
      name,
      order: typeof body.order === "number" ? body.order : 0,
    });

    // Every category ships with its own editable template so a run never lands without one.
    const fields = defaultTemplateFor(name);
    if (await TemplateModel.exists({ userId, name: fields.name })) {
      fields.name = `${fields.name} Outreach`;
    }
    let template = null;
    try {
      template = await TemplateModel.create({
        userId,
        ...fields,
        categoryId: doc._id,
        order: await TemplateModel.countDocuments({ userId }),
      });
    } catch {
      // A name clash here should not fail category creation; the user can add a template by hand.
    }

    return NextResponse.json(
      { item: doc.toObject(), template: template ? template.toObject() : null },
      { status: 201 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg.includes("duplicate")) {
      return NextResponse.json({ error: "Category already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
