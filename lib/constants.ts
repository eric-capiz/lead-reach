export const APP_NAME = "LeadReach";

export const LEAD_STATUS = ["sent", "pending", "social_ready"] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

export const WEBSITE_FILTERS = ["no_website", "any", "has_website"] as const;
export type WebsiteFilter = (typeof WEBSITE_FILTERS)[number];
