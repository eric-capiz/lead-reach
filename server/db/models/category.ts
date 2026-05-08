import mongoose, { Schema, type InferSchemaType } from "mongoose";

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

categorySchema.index({ name: 1 }, { unique: true });

export type CategoryDoc = InferSchemaType<typeof categorySchema> & { _id: mongoose.Types.ObjectId };

export const CategoryModel =
  (mongoose.models.Category as mongoose.Model<CategoryDoc>) ||
  mongoose.model<CategoryDoc>("Category", categorySchema);
