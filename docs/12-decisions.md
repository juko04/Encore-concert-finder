# 12 — Decisions and Open Questions

## Decided

### Product
- Personalized "worth going to" recommender, not generic calendar.
- Must support cheap spontaneous local discovery and favorite-artist planning.
- Festivals and multi-day events are first-class.
- Recommendations must be explainable.
- Price tolerance depends on affinity; there is not one universal ticket-price ceiling.
- Venue preference/history is a meaningful signal.

### Data
- Multi-source ingestion is core architecture.
- APIs plus official public websites.
- Social is primarily a discovery/verification signal at first.
- Preserve raw ingestion evidence.
- Normalize and deduplicate into canonical events.
- Track source confidence/provenance.

### Technology
- Real web app, not single static HTML file.
- Next.js + TypeScript.
- Tailwind.
- PostgreSQL/Supabase.
- Supabase Auth owns identity. Product profile data lives in a separate table keyed to
  `auth.users`, and user-private tables require row-level security from the first migration.
- PWA before native apps.
- TypeScript/Node source adapters/workers.
- Cheerio/HTTP before Playwright.
- Store event instants as `timestamptz` and preserve an IANA time zone for event-local
  date/time interpretation.

### Initial external integrations
- Spotify for taste profile.
- Ticketmaster as baseline event inventory.
- direct official venue/promoter/festival pages to improve depth/freshness.

### Deferred
- Email/newsletter ingestion is deferred but should be revisited during alerts/presales/source-coverage work.

## Open questions

- Final product name.
- Exact deployment/runtime for heavier crawlers.
- Exact geographic launch region for MVP.
- Whether users manually enter old concerts, import them, or both.
- Preferred map provider.
- Notification provider/channel for first production release.
- Which 3–5 direct source adapters should be implemented immediately after Ticketmaster.
- Exact user controls for price willingness and travel radius.
- How aggressively related artists/genre similarity should influence unknown-artist discovery.
- Whether resale prices should be displayed and, if so, from which authorized sources.
- How long raw source snapshots should be retained.
