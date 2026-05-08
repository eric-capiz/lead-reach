import mongoose from "mongoose";
import { connectDB } from "@/server/db/connect";
import { AppSettingsModel } from "@/server/db/models";

export async function ensureUserSeeded(
  userId: mongoose.Types.ObjectId | string,
): Promise<void> {
  await connectDB();

  // Minimal noncontent bootstrap so routes relying on settings can operate.
  const existing = await AppSettingsModel.findOne({ userId }).select("_id");
  if (!existing) {
    await AppSettingsModel.create({
      userId,
      locationAddress: "",
      radiusMiles: 50,
      websiteFilter: "no_website",
    });
  }
}

export async function ensureSeeded(): Promise<void> {
  await connectDB();
}
