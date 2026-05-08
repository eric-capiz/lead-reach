import { NextResponse } from "next/server";
import { ensureAppData } from "@/server/ensure-app-data";
import { TemplateModel } from "@/server/db/models";

export async function GET() {
  try {
    await ensureAppData();
    const items = await TemplateModel.find().sort({ order: 1, name: 1 }).lean();
    return NextResponse.json({ items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureAppData();
    const body = (await req.json()) as {
      name?: string;
      subject?: string;
      body?: string;
      categoryTag?: string;
      order?: number;
    };
    const name = body.name?.trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const doc = await TemplateModel.create({
      name,
      subject: body.subject?.trim() ?? "",
      body: body.body ?? "",
      categoryTag: body.categoryTag?.trim() ?? "",
      order: typeof body.order === "number" ? body.order : 0,
    });
    return NextResponse.json({ item: doc.toObject() }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg.includes("duplicate")) {
      return NextResponse.json({ error: "Template name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
