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

If `AUTH_SECRET` is not set, the app falls back to a derived secret. For production, set an explicit strong secret.

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

## Scripts

- `npm run dev` start local dev server
- `npm run build` production build + type check
- `npm run start` run built app
- `npm run lint` run linting
- `npm run db:test` Mongo connection test script

## TODO

1. Social scraping
2. Decide outreach send flow:
 - keep copy and paste + manual sending, or
 - let the bot send messages directly
3. Safeguard Google API usage/pricing before deployment:
 - confirm current free tier/quotas (estimated ~10,000/month)
 - enforce limits/alerts
4. Deploy to Vercel
