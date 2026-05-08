import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { UserModel } from "@/server/db/models";
import { createSessionToken, setSessionCookie } from "@/server/auth/session";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    const username = body.username?.trim();
    const password = body.password ?? "";

    if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });
    if (typeof password !== "string" || !password) {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }

    const usernameLower = username.toLowerCase();
    const user = await UserModel.findOne({ usernameLower });
    if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const token = createSessionToken(String(user._id));
    await setSessionCookie(token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

