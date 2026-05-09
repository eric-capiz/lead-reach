import mongoose, { Schema, type InferSchemaType } from "mongoose";

const templateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
    categoryTag: { type: String, default: "" },
    /** When true, Places runs use this template if no template name/tag matches the category (only one per user). */
    useWhenNoCategoryMatch: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

templateSchema.index({ userId: 1, name: 1 }, { unique: true });

export type TemplateDoc = InferSchemaType<typeof templateSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const TemplateModel =
  (mongoose.models.Template as mongoose.Model<TemplateDoc>) ||
  mongoose.model<TemplateDoc>("Template", templateSchema);
