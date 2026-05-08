import mongoose, { Schema, type InferSchemaType } from "mongoose";

const appSettingsSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    locationAddress: { type: String, default: "El Paso, TX" },
    radiusMiles: { type: Number, default: 50 },
    websiteFilter: {
      type: String,
      enum: ["no_website", "any", "has_website"],
      default: "no_website",
    },
  },
  { timestamps: true },
);

export type AppSettingsDoc = InferSchemaType<typeof appSettingsSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AppSettingsModel =
  (mongoose.models.AppSettings as mongoose.Model<AppSettingsDoc>) ||
  mongoose.model<AppSettingsDoc>("AppSettings", appSettingsSchema);
