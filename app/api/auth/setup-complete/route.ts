import { NextResponse } from "next/server";
import { requireCurrentUserId } from "@/server/auth/session";
import { UserModel } from "@/server/db/models";

export async function POST() {
  try {
    const userId = await requireCurrentUserId();
    const updated = await UserModel.findByIdAndUpdate(userId, { setupCompleted: true }, { new: true }).lean();
    if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "UNAUTHENTICATED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

