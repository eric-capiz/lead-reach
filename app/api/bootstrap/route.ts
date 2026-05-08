import { NextResponse } from "next/server";
import { requireCurrentUserId } from "@/server/auth/session";
import { ensureUserSeeded } from "@/server/services/seed-defaults";

export async function GET() {
  try {
    const userId = await requireCurrentUserId();
    await ensureUserSeeded(userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bootstrap failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
