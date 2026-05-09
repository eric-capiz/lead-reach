import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { AppSettingsModel, UserModel } from "@/server/db/models";
import { createSessionToken, setSessionCookie } from "@/server/auth/session";
import { connectDB } from "@/server/db/connect";

export async function POST(req: Request) {
  try {
    await connectDB();
    const body = (await req.json()) as { username?: string; password?: string };
    const username = body.username?.trim();
    const password = body.password ?? "";

    if (!username)
      return NextResponse.json({ error: "username required" }, { status: 400 });
    if (typeof password !== "string" || !password) {
      return NextResponse.json({ error: "password required" }, { status: 400 });
    }

    const usernameLower = username.toLowerCase();
    const existing = await UserModel.findOne({ usernameLower });
    if (existing)
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 },
      );

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await UserModel.create({
      usernameLower,
      passwordHash,
      setupCompleted: false,
    });

    const token = createSessionToken(String(user._id));
    await setSessionCookie(token);

    await AppSettingsModel.create({
      userId: user._id,
      locationAddress: "",
      radiusMiles: 50,
      websiteFilter: "no_website",
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
