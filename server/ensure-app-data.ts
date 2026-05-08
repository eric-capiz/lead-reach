import { connectDB } from "@/server/db/connect";
import { ensureSeeded } from "@/server/services/seed-defaults";

export async function ensureAppData(): Promise<void> {
  await connectDB();
  await ensureSeeded();
}
