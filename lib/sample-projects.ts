/**
 * Maps a lead's business category to the closest portfolio sample project,
 * so generated outreach can show relevant work. URLs are Eric's live sites.
 */

const SAMPLE_PROJECTS: { url: string; label: string } = {
  url: "https://ericcapiz.com",
  label: "my portfolio",
};

const CATEGORY_MAP: { match: RegExp; url: string }[] = [
  // Visual / portfolio-style businesses
  { match: /photograph|artist|gallery|studio/i, url: "https://florist-ec.vercel.app" },
  // Food & drink
  { match: /baker|food truck|restaurant|taqueria|cater|donut|coffee|pizza/i, url: "https://bakery-ec.vercel.app" },
  // Beauty & personal care
  { match: /nail|salon|barber|spa|beauty/i, url: "https://luxenails-site.vercel.app" },
  // Auto
  { match: /auto|mechanic|car detail|auto body|tire/i, url: "https://mechanic-five.vercel.app" },
  // Outdoor / home services
  { match: /landscap|lawn|fence|roof|pressure wash|garden/i, url: "https://landscape-ec.vercel.app" },
  // Flowers & gifts
  { match: /florist|flower/i, url: "https://florist-ec.vercel.app" },
];

export function sampleProjectFor(category: string): string {
  const c = (category || "").trim();
  for (const entry of CATEGORY_MAP) {
    if (entry.match.test(c)) return entry.url;
  }
  return SAMPLE_PROJECTS.url;
}
