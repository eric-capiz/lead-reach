import type { LeadStatus } from "@/lib/constants";

export type LeadApi = {
  _id: string;
  businessName: string;
  category: string;
  location: string;
  phone: string;
  email: string | null;
  websiteStatus: string;
  websiteUri: string | null;
  googleMapsUrl: string;
  instagram: string | null;
  facebook: string | null;
  status: LeadStatus;
  templateId: string | null;
  templateName?: string | null;
  updatedAt?: string;
  isSample?: boolean;
};

export type TemplateLite = {
  _id: string;
  name: string;
  /** Email body. */
  body: string;
  /** Short body used for Instagram / Facebook DMs. */
  dmBody: string;
  subject: string;
  /** Matches Places run category name (case insensitive). Use `general` for default. */
  categoryTag?: string;
  /** Set when auto-created for a category; that category's removal deletes this template. */
  categoryId?: string | null;
  /** Part of the seeded baseline: content is editable, but it can't be deleted. */
  isDefault?: boolean;
  /** When true, used for category runs that don't match any template name/tag. */
  useWhenNoCategoryMatch?: boolean;
};

export type MergeFieldLite = { _id: string; key: string; label: string; value: string };
