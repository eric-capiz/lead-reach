/**
 * Avoid downloading ~170MB Chromium on Vercel (serverless social scrape uses HTTP-only;
 * Playwright is optional and gated by SOCIAL_BROWSER_FORCE there).
 * Local `npm install` still runs `playwright install chromium`.
 */
const { execSync } = require("node:child_process");

if (process.env.VERCEL === "1" || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  console.log("[postinstall] Skipping Playwright browser download (Vercel or PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).");
  process.exit(0);
}

execSync("npx playwright install chromium", { stdio: "inherit" });
