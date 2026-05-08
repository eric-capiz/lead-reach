import { NextResponse } from "next/server";
import { ensureAppData } from "@/server/ensure-app-data";

export async function GET() {
  try {
    await ensureAppData();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Bootstrap failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
