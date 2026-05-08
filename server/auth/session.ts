import crypto from "crypto";
import { cookies } from "next/headers";
import type { UserDoc } from "@/server/db/models";
import { UserModel } from "@/server/db/models";
import { connectDB } from "@/server/db/connect";

const COOKIE_NAME = "leadreach_session";

type SessionPayload = {
  userId: string;
  exp: number; // unix ms
};

function base64UrlEncode(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function authSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.MONGODB_URI ||
    "dev_only_change_me_in_production"
  );
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("hex");
}

export function createSessionToken(userId: string): string {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  const payload: SessionPayload = { userId, exp };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function decodeSessionToken(token: string): SessionPayload | null {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const raw = base64UrlDecode(payloadB64).toString("utf8");
    const parsed = JSON.parse(raw) as SessionPayload;
    if (!parsed?.userId || typeof parsed.userId !== "string") return null;
    if (!parsed?.exp || typeof parsed.exp !== "number") return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<UserDoc | null> {
  await connectDB();
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = decodeSessionToken(token);
  if (!payload) return null;
  const user = await UserModel.findById(payload.userId).lean<UserDoc>();
  if (!user) return null;
  return user;
}

export async function requireCurrentUserId(): Promise<string> {
  // This must be called from a server context where `cookies()` is available.
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) throw new Error("UNAUTHENTICATED");
  const payload = decodeSessionToken(token);
  if (!payload?.userId) throw new Error("UNAUTHENTICATED");
  return payload.userId;
}

