# 11 — Roadmap

## Phase 0 — Repository and foundations

- initialize Next.js + TypeScript
- Tailwind
- Supabase project
- environment configuration
- lint/typecheck/test baseline
- database migrations
- CI on pull requests
- seed/dev data

## Phase 1 — Real event inventory

Goal: a usable event browser with canonical data.

- source registry model
- Ticketmaster ingestion
- raw ingest store
- event candidate model
- canonical event model
- artist/venue entities
- baseline deduplication
- basic Discover UI

## Phase 2 — Personalized ranking

- Spotify OAuth
- Spotify artist/taste ingestion
- user preferences
- artist affinity
- price preference curve
- distance scoring
- explanation generation
- This Weekend
- Cheap & Nearby
- Worth Planning For

## Phase 3 — Direct public source adapters

Start with a small test set:
- AEG/promoter source
- major venue calendar
- independent venue calendar

Then:
- adapter fixtures/tests
- change detection
- crawler health monitoring
- parser-failure safeguards
- source corroboration

Expand only where direct sourcing improves coverage/freshness.

## Phase 4 — Concert history and learning

- manual concert history entry
- venue affinity
- event feedback
- too-expensive / too-far correction logic
- attendance confirmations
- ranking tuning

## Phase 5 — Festivals

- festival/event-day/performance schema
- lineup parsing
- lineup match
- daily match
- ticket/pass modeling
- festival cards/detail view
- later: trip-cost estimates

## Phase 6 — Watchlists and alerts

- artist/event watches
- on-sale/presale changes
- price thresholds
- lineup changes
- in-app notifications
- outbound notification channel

**At this phase, explicitly revisit email/newsletter ingestion.**

## Phase 7 — Broader discovery

- more independent venues
- free/community event calendars
- approved social signals
- better related-artist discovery
- price history insights

## Phase 8 — Product hardening

- PWA installation
- accessibility
- performance
- monitoring
- privacy/account deletion
- production crawler controls
- source legal/terms review

## Phase 9 — Possible future work

- email/newsletter ingestion
- calendar integration
- festival schedule optimizer
- native app if justified
- collaborative plans with friends
- travel/lodging integrations
- richer price analytics
