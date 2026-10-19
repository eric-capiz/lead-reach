/**
 * Starter copy for auto-created templates. Every user gets editable defaults so a Places run
 * always has something to attach, and a new category never leaves a gap.
 */

/** Seeded for users who have no categories yet. */
export const DEFAULT_CATEGORY_NAMES = [
  "Barbers",
  "Florists",
  "Bakeries",
  "Cleaning Services",
  "Mechanics",
] as const;

/** Name + tag used for the catch-all template that covers unmatched categories. */
export const GENERAL_TEMPLATE_NAME = "General";

/** Kept for potential category-aware copy in the future. */
export function singularLower(categoryName: string): string {
  const t = categoryName.trim().toLowerCase();
  if (!t) return "local business";
  if (t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.endsWith("sses") || t.endsWith("ches") || t.endsWith("shes")) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function defaultSubject(_categoryName?: string): string {
  return "Quick idea for {{businessName}}";
}

export function defaultEmailBody(_categoryName?: string): string {
  return [
    "Hi {{businessName}},",
    "",
    "Found you online, great work. But you do not show up when people Google your services in {{city}}. Your competitors do.",
    "",
    "That is customers you are missing. I build simple websites for local businesses. Here is one I did, similar style to what I would make for you: {{sampleProject}}",
    "",
    "Pricing is simple. $100 plus domain costs gets you 1 to 2 pages with a contact form. You own everything.",
    "",
    "Reply if you want to see a free mockup. No pressure.",
    "",
    "{{myName}}",
    "{{portfolioLink}}",
  ].join("\n");
}

export function defaultDmBody(_categoryName?: string): string {
  return [
    "Hi {{businessName}}! Found you online, love what you do. Quick thought: you do not show up on Google when people search for your services nearby, and that is customers you are missing.",
    "",
    "I build simple $100 websites for local businesses (plus domain). Here is a sample of my work: {{sampleProject}}",
    "",
    "Want me to mock one up for you? Free, no pressure.",
    "",
    "- {{myName}}",
  ].join("\n");
}

export function defaultTemplateFor(categoryName: string) {
  return {
    name: categoryName,
    subject: defaultSubject(categoryName),
    body: defaultEmailBody(categoryName),
    dmBody: defaultDmBody(categoryName),
    categoryTag: categoryName,
  };
}

export function generalTemplateDefaults() {
  return {
    name: GENERAL_TEMPLATE_NAME,
    subject: defaultSubject(),
    body: defaultEmailBody(),
    dmBody: defaultDmBody(),
    categoryTag: GENERAL_TEMPLATE_NAME.toLowerCase(),
  };
}
