import { NextResponse } from "next/server";
import { requireCurrentUserId } from "@/server/auth/session";

export async function GET() {
  try {
    await requireCurrentUserId();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bootstrap failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
