/** Helpers for deciding which leads still need Facebook or Instagram enrichment. */

export function hasLeadSocialUrl(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function leadSearchableBase(lead: {
  businessName?: unknown;
  location?: unknown;
}): string {
  const parts = [lead.businessName, lead.location].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return parts.join(" ").trim();
}

/** True if the lead is missing at least one social URL and has a name or location to search with. */
export function leadNeedsSocialEnrichment(lead: {
  facebook?: unknown;
  instagram?: unknown;
  businessName?: unknown;
  location?: unknown;
}): boolean {
  if (hasLeadSocialUrl(lead.facebook) && hasLeadSocialUrl(lead.instagram)) return false;
  return leadSearchableBase(lead).length > 0;
}
