# Concert Finder / Encore (working title)

This repository is the shared product and engineering specification for a personalized concert, festival, and live-music discovery application.

The working product goal is simple:

> Help a user decide which live-music experiences are actually worth attending, based on taste, past attendance, venue preferences, price sensitivity, distance, timing, and lineup quality.

This is **not** intended to be another generic event calendar. The product should combine:

- personalized concert recommendations
- cheap/local discovery
- larger shows worth planning for
- festival and multi-day event intelligence
- ticket/on-sale/watch alerts
- resilient event ingestion from APIs plus official public web sources

Email/newsletter ingestion is intentionally deferred for now, but must remain on the roadmap and should be reconsidered when alerts, presales, and missing event coverage are implemented.

## Current technical direction

- Frontend / web app: Next.js + TypeScript
- Styling: Tailwind CSS
- Database: PostgreSQL via Supabase
- Authentication: Supabase Auth
- Music taste: Spotify Web API
- Baseline event inventory: Ticketmaster Discovery API
- Supplemental ingestion: official promoter, venue, festival, and ticketing pages
- Scraping: fetch/HTTP + structured-data parsing + Cheerio; Playwright only when necessary
- Background work: scheduled jobs/workers
- Deployment: Vercel for web; Supabase for database/auth; worker deployment to be chosen during implementation
- Initial delivery format: responsive web app / PWA before any native mobile app

## Start here

New contributors and AI agents should begin with `START_HERE.md`, then read `AGENTS.md` and `PROJECT_CONTEXT.md`.

## Documentation map

- `START_HERE.md` — repository onboarding and first steps
- `AGENTS.md` — shared instructions for AI coding agents and human contributors
- `PROJECT_CONTEXT.md` — condensed context and decisions from the original product conversation
- `AI_START_PROMPTS.md` — startup prompts for ChatGPT Personal, Antigravity, and Claude
- `AI_HANDOFF.md` — current cross-agent handoff state
- `CONTRIBUTING.md` — branch, validation, documentation, and secret-handling conventions
- `GITHUB_SETUP.md` — beginner-friendly instructions for putting this packet into GitHub
- `docs/01-product-vision.md` — product scope, user jobs, primary screens
- `docs/02-system-architecture.md` — application and service architecture
- `docs/03-data-model.md` — entities and database schema
- `docs/04-ingestion-and-scraping.md` — APIs, crawlers, normalization, verification, deduplication
- `docs/05-source-registry.md` — current event-source list and acquisition strategy
- `docs/06-recommendation-engine.md` — scoring and personalization logic
- `docs/07-festivals.md` — festival / multi-day behavior
- `docs/08-alerts-and-watchlists.md` — watches, on-sales, price alerts
- `docs/09-security-privacy-and-compliance.md` — privacy, secrets, scraping safety, data handling
- `docs/10-api-and-module-plan.md` — proposed internal modules and API routes
- `docs/11-roadmap.md` — phased implementation plan
- `docs/12-decisions.md` — decisions already made vs. open questions
- `docs/13-agent-collaboration.md` — recommended workflow for ChatGPT/Codex + Antigravity + GitHub
- `docs/14-future-email-ingestion.md` — deferred email/newsletter ingestion design

## Product principles

1. **Explain recommendations.** A user should understand why a show was recommended.
2. **Price is personal.** A $70 ticket can be a good value for a favorite artist and a bad value for an unknown artist.
3. **Local discovery matters.** Small venues, bars, outdoor events, and inexpensive shows are first-class use cases.
4. **Festivals are not just long concerts.** Lineup depth, day-by-day value, travel, and pass types must be modeled explicitly.
5. **Use multiple data sources.** APIs provide breadth; official venue/promoter/festival sites provide depth and freshness.
6. **Verify before trusting.** Social or weak sources may discover an event, but stronger first-party sources should verify it.
7. **Do not overbuild ML early.** Start with transparent, tunable ranking formulas and learn from explicit feedback.
8. **Store raw source evidence.** Preserve source snapshots so parsers can be fixed and re-run later.
9. **Keep the architecture portable.** The recommendation engine and data model should not depend on any single ticketing provider.
10. **Build web-first.** Prove discovery and recommendation quality before building native mobile apps.
