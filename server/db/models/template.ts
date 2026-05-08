import mongoose, { Schema, type InferSchemaType } from "mongoose";

const templateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
    categoryTag: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

templateSchema.index({ name: 1 }, { unique: true });

export type TemplateDoc = InferSchemaType<typeof templateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const TemplateModel =
  (mongoose.models.Template as mongoose.Model<TemplateDoc>) ||
  mongoose.model<TemplateDoc>("Template", templateSchema);
