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

/** "Barbers" -> "barber", "Cleaning Services" -> "cleaning service". */
function singularLower(categoryName: string): string {
  const t = categoryName.trim().toLowerCase();
  if (!t) return "local business";
  if (t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.endsWith("sses") || t.endsWith("ches") || t.endsWith("shes")) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function defaultSubject(categoryName?: string): string {
  const noun = categoryName ? singularLower(categoryName) : "";
  return noun ? `Quick website idea for your ${noun}` : "Quick website idea for {{businessName}}";
}

export function defaultEmailBody(categoryName?: string): string {
  const noun = categoryName ? singularLower(categoryName) : "local business";
  return [
    "Hi {{businessName}},",
    "",
    `I came across your ${noun} and noticed you might not have a website yet — or that the one you have could be working harder for you.`,
    "",
    `I build simple, fast websites for local businesses that make it easy for customers to find you, see what you offer, and get in touch. I'd be glad to put together a quick mockup so you can see exactly what it would look like, at no cost and with no obligation.`,
    "",
    "Would you be open to a short conversation this week?",
    "",
    "Best,",
    "{{myName}}",
    "{{portfolioLink}}",
  ].join("\n");
}

export function defaultDmBody(categoryName?: string): string {
  const noun = categoryName ? singularLower(categoryName) : "local business";
  return [
    `Hi {{businessName}}! I build websites for local ${noun}s and put together a quick mockup idea for yours.`,
    "Happy to send it over — no charge, no strings. Want me to share it?",
    "",
    "— {{myName}}",
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
