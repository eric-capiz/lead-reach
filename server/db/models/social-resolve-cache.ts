import mongoose, { Schema, type InferSchemaType } from "mongoose";

/** Shared cache by Google Place ID so the same POI never reruns heavy search pipelines. */
const socialResolveCacheSchema = new Schema(
  {
    placeId: { type: String, required: true, trim: true, unique: true, index: true },
    facebook: { type: String, default: null },
    instagram: { type: String, default: null },
  },
  { timestamps: true },
);

export type SocialResolveCacheDoc = InferSchemaType<typeof socialResolveCacheSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SocialResolveCacheModel =
  (mongoose.models.SocialResolveCache as mongoose.Model<SocialResolveCacheDoc>) ||
  mongoose.model<SocialResolveCacheDoc>("SocialResolveCache", socialResolveCacheSchema);
