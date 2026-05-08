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

export type TemplateLite = { _id: string; name: string; body: string; subject: string };

export type MergeFieldLite = { _id: string; key: string; label: string; value: string };
