import mongoose from "mongoose";
import { MergeFieldModel, TemplateModel } from "@/server/db/models";

export const OWNER_MERGE_PROFILE: { key: string; label: string; value: string }[] = [
  { key: "myname", label: "Your name", value: "Eric Capiz" },
  { key: "phone", label: "Phone", value: "443-307-3937" },
  { key: "email", label: "Email", value: "ericcapiz@gmail.com" },
  { key: "portfoliolink", label: "Portfolio URL", value: "https://ericcapiz.com" },
  { key: "linkedinlink", label: "LinkedIn URL", value: "https://linkedin.com/in/eric-capiz" },
];

const SAMPLE_PROJECT_TOKEN = /\{\{\s*sampleProjectLink\s*\}\}/gi;

export async function syncOwnerMergeFieldsAndCleanup(userId: mongoose.Types.ObjectId | string): Promise<void> {
  // Clean up any legacy sample merge field remnants for this user only.
  await MergeFieldModel.deleteMany({ userId, key: "sampleprojectlink" });

  for (const field of OWNER_MERGE_PROFILE) {
    const exists = await MergeFieldModel.exists({ userId, key: field.key });
    if (!exists) {
      await MergeFieldModel.create({ ...field, userId });
    }
  }

  await MergeFieldModel.updateMany(
    { userId, key: "phone", value: "(555) 010-4421" },
    { $set: { value: "443-307-3937", label: "Phone" } },
  );

  await MergeFieldModel.updateMany(
    { userId, key: "portfoliolink", value: { $regex: /portfolio\.example/i } },
    { $set: { value: "https://ericcapiz.com", label: "Portfolio URL" } },
  );

  const templates = await TemplateModel.find({ userId, body: SAMPLE_PROJECT_TOKEN }).select("_id body");
  for (const t of templates) {
    const body = t.body.replace(SAMPLE_PROJECT_TOKEN, "https://ericcapiz.com");
    if (body !== t.body) {
      t.body = body;
      await t.save();
    }
  }
}
