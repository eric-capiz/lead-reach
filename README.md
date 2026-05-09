# LeadReach

LeadReach is a private outreach workspace for finding local businesses, qualifying leads, and managing message templates for outreach campaigns.

The app combines:
- Google Places + Geocoding search runs
- Per user lead ownership and workflow tracking
- Reusable email templates and merge fields
- A polished dashboard for daily outreach operations

## Purpose

LeadReach is designed to help a user quickly:
- Search by category/name + location
- Filter leads by website presence
- Save qualified leads to MongoDB
- Assign templates and track outreach status
- Keep all data isolated per account

## Core Features

- **Authentication**
 - Username/password login and registration
 - Case insensitive usernames, case sensitive passwords
 - Passwords stored as bcrypt hashes
 - Session based auth via secure httpOnly cookie
 - Post registration setup modal reminder

- **Per user data isolation**
 - User owned records for:
 - `leads`
 - `templates`
 - `mergefields`
 - `categories`
 - `appsettings`
 - API routes are scoped to the authenticated `userId`
 - Users cannot read/write each other’s records

- **Lead workflow**
 - Places run returns, filters, and upserts leads
 - Duplicate prevention per user (`userId + googlePlaceId`)
 - Lead card actions:
 - mark contacted
 - assign template
 - copy generated message
 - delete lead
 - Bulk delete all leads with confirmation modal

- **Template and merge field management**
 - Create, edit, delete templates
 - Styled in app create/delete confirmation modals
 - Merge fields editable per user
 - **Places runs and templates:** When you run a **category** search, each lead gets the template whose **name** matches that category (same label as in your category list; comparison ignores case and extra spaces). If nothing matches, the app uses (in order): optional **category tag** on a template, the single template marked **“Use when no category matches”** (your general / catch‑all email), or a heuristic “general” template (e.g. category tag `general`, or a name like `General outreach`). It does **not** silently pick the first template in the list for unknown categories. **Name‑only** Places runs still resolve against that default / general logic and then first‑by‑order if needed.

- **Search UX**
 - Configurable location, radius, and website filter
 - “Use my location” fills readable location (ZIP or city when available)
 - ZIP or city or address manual input supported
 - Run settings persist as “last used” after each bot run

## Tech Stack

- Next.js (App Router)
- React + TypeScript
- Mongoose + MongoDB
- Google Maps APIs:
 - Places API (New)
 - Geocoding API
- Tailwind CSS styling

## Project Structure (high level)

- `app/` pages and API routes
- `components/dashboard/` dashboard UI and lead/template management
- `components/auth/` login/register public home
- `server/db/models/` Mongoose schemas
- `server/services/` Google Places and geocoding integration
- `server/auth/` session helpers

## Environment Variables

Copy `.env.example` to `.env.local` and set values:

```env
MONGODB_URI=
GOOGLE_API_KEY=
```

Optional (recommended for production):

```env
AUTH_SECRET=
```

If `AUTH_SECRET` is not set, the app falls back to other env-derived values for signing sessions (fine for local dev only). For production (including Vercel), set an explicit strong secret.

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

[http://localhost:3000](http://localhost:3000)

Build check:

```bash
npm run build
```

## Initialization Behavior

- No automatic demo or sample content is seeded.
- No automatic bootstrap user is created.
- On registration, the app creates:
 - the user account
 - a minimal per user `appsettings` document
- Routes assume authenticated users and user owned data (no legacy post hoc seed bootstrap layer).

## Operational Notes

- The Mongo database name (e.g. `test`) is configurable via `MONGODB_URI` and does not affect app behavior.
- Collection data is intentionally user partitioned by `userId` rather than separate per user collections.
- All destructive actions (template/lead delete, bulk lead delete) use in app confirmation modals.

### Deployment (e.g. Vercel)

- Set **Production** env vars: `MONGODB_URI`, `GOOGLE_API_KEY`, and preferably `AUTH_SECRET`.
- **MongoDB Atlas:** allow inbound from your host’s IPs. Serverless platforms use changing egress IPs; many setups use **`0.0.0.0/0`** in Atlas Network Access and rely on strong DB credentials + secrets.
- **Build:** Playwright’s Chromium install is skipped on Vercel (`VERCEL=1`) so installs stay fast; optional social browser fallback is off there unless you force it. After `npm install` locally, run `npx playwright install chromium` once if you use Playwright features on your machine.

## Scripts

- `npm run dev` start local dev server
- `npm run build` production build + type check
- `npm run start` run built app
- `npm run lint` run linting
- `npm run db:test` Mongo connection test script

## TODO

1. ~~Social scraping~~ — shipped (Yahoo SERP + optional Playwright fallback; per-place cache; batch “Get socials” by leads page size).
2. **Outreach send flow** (not built yet) — decide and implement: keep copy/paste + manual sending, and/or let the app send messages (e.g. email provider integration).
3. ~~Google API safeguards~~ — done (quotas/limits and pre-deploy usage checks in place).
4. ~~**Deploy to Vercel**~~ — MVP supported (env vars + Atlas access; see Deployment above).
