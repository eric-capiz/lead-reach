import mongoose, { Schema, type InferSchemaType } from "mongoose";

const mergeFieldSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    value: { type: String, default: "" },
  },
  { timestamps: true },
);

mergeFieldSchema.index({ key: 1 }, { unique: true });

export type MergeFieldDoc = InferSchemaType<typeof mergeFieldSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const MergeFieldModel =
  (mongoose.models.MergeField as mongoose.Model<MergeFieldDoc>) ||
  mongoose.model<MergeFieldDoc>("MergeField", mergeFieldSchema);
