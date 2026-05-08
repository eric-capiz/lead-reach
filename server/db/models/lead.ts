import mongoose, { Schema, type InferSchemaType } from "mongoose";

const leadSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    googlePlaceId: { type: String, required: true, trim: true },
    businessName: { type: String, required: true, trim: true },
    category: { type: String, default: "" },
    location: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: null },
    websiteStatus: { type: String, default: "No website" },
    websiteUri: { type: String, default: null },
    googleMapsUrl: { type: String, required: true },
    instagram: { type: String, default: null },
    facebook: { type: String, default: null },
    templateId: { type: Schema.Types.ObjectId, ref: "Template", default: null },
    status: {
      type: String,
      enum: ["sent", "pending", "social_ready"],
      default: "pending",
    },
    isSample: { type: Boolean, default: false },
  },
  { timestamps: true },
);

leadSchema.index({ userId: 1, googlePlaceId: 1 }, { unique: true });

export type LeadDoc = InferSchemaType<typeof leadSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const LeadModel =
  (mongoose.models.Lead as mongoose.Model<LeadDoc>) ||
  mongoose.model<LeadDoc>("Lead", leadSchema);
