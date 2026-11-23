# 11 — Roadmap

## Phase 0 — Repository and foundations

- initialize Next.js + TypeScript
- Tailwind
- PWA shell: web manifest, icons, theme metadata, and responsive mobile baseline
- Supabase project
- environment configuration
- lint/typecheck/test baseline
- Supabase migration and local-development workflow
- one private-profile migration with row-level-security policies; no event inventory schema yet
- CI on pull requests
- deterministic local fixture/dev data (not real event ingestion)

## Phase 1 — Canonical inventory and ingestion foundation

Goal: a usable event browser with canonical data.

- source registry model
- raw ingest store
- event candidate model
- canonical event model
- artist/venue entities
- baseline deduplication
- deterministic fixture-only canonical inventory proof
- optional basic Discover UI backed only by deterministic canonical data

## Phase 2 — First live source and personalized ranking

- Ticketmaster Discovery API as the first real source proving the Phase 1
  ingestion model
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

### Product Principles & Access Architecture (Phase 2 & Phase 8)

The product architecture enforces four core tenets:

1. **Public Browsing (PR #20 Core Deliverable):**
   - Public visitors can freely explore, search, filter, and inspect canonical concert inventory, venue details, and ticketing options without creating an account or signing in.
   - PR #20 establishes the live public Index view (`/`) backed by Ticketmaster and independent venue adapters.

2. **Invite-Only Personalization & Access Gating (Phase 2 / Phase 8):**
   - Deep personalization features—such as tailored match scores, "Worth It" rankings, custom price curve evaluations, and saved events—are unlocked upon authentication.
   - Account creation is invite-only and allowlist-gated during closed beta to maintain quality and platform compliance.

3. **Optional Spotify Integration (PR #20 Core Principle):**
   - Spotify OAuth is completely optional. Users have full access to personalized recommendations by manually managing their artist preferences (Favorite, Liked, Disliked) and setting custom taste profiles directly in the app.
   - The multi-factor scoring engine functions with complete parity whether taste data originates from Spotify or manual user selections.

4. **Persistent Per-User Imported Spotify Artists (Data Durability Invariant):**
   - When a user imports their top artists or library from Spotify, the resolved preferences are durably written to `user_artist_preferences` in PostgreSQL.
   - Disconnecting Spotify, removing Spotify account authorization, or encountering Spotify API allowlist limits does **not** purge or reset these preferences. Imported artists remain permanently attached to the user profile until explicitly edited or deleted by the user.

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

- PWA offline behavior and installation validation
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
