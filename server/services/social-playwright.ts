/**
 * Shared Playwright launch helpers for social discovery (SERP, Ad Library, FB verify).
 */

import { chromium, type Browser } from "playwright";

function socialBrowserAllowed(): boolean {
  if (process.env.SOCIAL_BROWSER === "0") return false;
  if (process.env.VERCEL === "1" && process.env.SOCIAL_BROWSER_FORCE !== "1") return false;
  return true;
}

const LAUNCH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

/**
 * Launch Chromium. Tries system Chrome first, then Playwright's bundled browser.
 * Never throws; callers treat null as browser unavailable.
 */
export async function launchSocialBrowser(): Promise<Browser | null> {
  if (!socialBrowserAllowed()) {
    console.warn("[social-playwright] skipped (SOCIAL_BROWSER=0 or Vercel)");
    return null;
  }

  // Prefer system Chrome by default; bundled Chromium is blocked more often on SERPs/FB
  const preferBundled =
    process.env.PLAYWRIGHT_CHROME_CHANNEL === "0" ||
    process.env.PLAYWRIGHT_CHROME_CHANNEL === "bundled";

  const attempts: Array<{ label: string; opts: Parameters<typeof chromium.launch>[0] }> = preferBundled
    ? [
        { label: "bundled", opts: { headless: true, args: LAUNCH_ARGS } },
        { label: "channel:chrome", opts: { headless: true, channel: "chrome", args: LAUNCH_ARGS } },
      ]
    : [
        { label: "channel:chrome", opts: { headless: true, channel: "chrome", args: LAUNCH_ARGS } },
        { label: "bundled", opts: { headless: true, args: LAUNCH_ARGS } },
      ];

  for (const a of attempts) {
    try {
      const browser = await chromium.launch(a.opts);
      return browser;
    } catch (e) {
      console.warn(`[social-playwright] launch failed (${a.label}):`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

export const SOCIAL_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
