# Encore V2 — Pull Request Diff & Architecture Report

**Pull Request:** [#20](https://github.com/juko04/Encore-concert-finder/pull/20)  
**Title:** `feat(v2): Encore V2 Unified Index UI, Ticketmaster V2 Engine & Colorado Venue Coverage`  
**Base Branch:** `main` (commit `3adbf59`)  
**Feature Branch:** `feature/encore-v2-index-ticketmaster` (commit `f189a7e`)  
**Incorporated Baseline:** `feature/spotify-integration-repair` (commit `4009277`)  
**Repository:** `juko04/Encore-concert-finder`  

---

## 1. Executive Summary & Diff Statistics

This Pull Request unifies live concert discovery across Colorado and the Mountain West by combining three foundational systems:
1. **Encore Index Visual Design & Production Route Migration:** Transforms the approved editorial Index prototype into the real production application across `/`, `/concerts/[id]`, `/search`, `/saved`, and `/preferences`, wired to real Supabase database events.
2. **Ticketmaster V2 Discovery Engine:** Enterprise-grade ingestion client with dynamic recursive temporal date bisection (<950 events threshold, sub-day bisection support), header-synchronized 5,000 req/day quota guard with circuit breaker at 4,750, response-derived fee status, and elimination of unsupported query parameters.
3. **Colorado Venue Coverage (Z2 Entertainment Shared Adapter):** Multi-venue scraping adapter onboarding Boulder Theater, Fox Theatre, Aggie Theatre (Fort Collins), and Chautauqua Auditorium with live Webflow extraction, relative URL resolution, and sold-out inventory preservation.
4. **Final Implementation Audit Remediation:** Eliminates speculative fees, preserves `billingPosition: 'unknown'` for unverified attraction roles, replaces synthetic watchlist counters with local browser disclosures, and proves live Ticketmaster and Z2 ingestion with 100% idempotency.

### Summary Metrics

```
========================================================================================
PERSPECTIVE A: Incremental Encore V2 Implementation (on top of Spotify baseline 4009277)
========================================================================================
Files Changed:     76 files
Insertions (+):    12,560 lines
Deletions (-):     241 lines
Net Delta:         +12,319 lines

========================================================================================
PERSPECTIVE B: Full PR #20 Diff against origin/main (including Spotify foundation)
========================================================================================
Files Changed:     106 files
Insertions (+):    25,310 lines
Deletions (-):     305 lines
Net Delta:         +25,005 lines
========================================================================================
```

---

## 2. Commit History in PR #20

| Commit SHA | Type | Subject | Scope / Architectural Impact |
|---|---|---|---|
| `4009277` | `feat(spotify)` | live oauth activation, catalog enrichment, anti-idor security & e2e verification | Verified Spotify baseline: OAuth PKCE, AES-256-GCM token encryption, 114 corroborated Spotify IDs, multi-range listening affinity scoring |
| `89dcd72` | `feat(v2)` | unified index UI migration, ticketmaster v2 engine & colorado venue coverage | Core Encore V2 implementation: Index UI routes, Ticketmaster V2 bisection/quota guard, Z2 adapter, multi-source rolling sync, Playwright index flow tests |
| `e165adf` | `fix(e2e)` | specify exact match for All Shows mode chips to prevent strict mode collisions | Resolves Playwright strict mode collision between mode chip and empty state button |
| `dc7a969` | `fix(integration)` | ensure test user exists in auth.users and handle unconfigured Spotify credentials in CI | Hardens PostgreSQL integration test setup for headless CI environments |
| `74d183b` | `docs` | record final green CI verification in AI_HANDOFF | Updates operational status to green CI across all workflows |
| `f189a7e` | `fix(audit-remediation)` | resolve ticketmaster api params, prove live ingestion, and audit index truthfulness | Critical audit remediation: strips unsupported TM query params, removes fake fees, parses feeStatus, sets unknown artist roles, audits watchlist truthfulness, adds live ingestion proof script |

---

## 3. Subsystem Diff Breakdown

### A. App Router Production Routes (`app/`)
*Replaces legacy placeholders and promotes the Index prototype to the primary application.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `app/page.tsx` | Modified | +140 / -10 | Replaces placeholder homepage with `IndexFeedContainer`, fetching live canonical events from Supabase via `getPublicDiscoverData({ limit: 100 })`. |
| `app/concerts/[id]/page.tsx` | Added | +157 | Editorial concert detail page with venue location, map links, full lineup performers, factor breakdown, and live ticket links. |
| `app/search/page.tsx` | Added | +43 | Full catalog search page rendering `SearchClient` with multi-filter controls. |
| `app/saved/page.tsx` | Added | +32 | Watchlist and ticket alert desk rendering `SavedWatchlistClient`. |
| `app/preferences/page.tsx` | Added | +192 | Music taste management desk with explicit artist preferences and Spotify connection status. |
| `app/api/catalog/search/route.ts` | Added | +100 | Server-side search API endpoint supporting real-time keyword, venue, and price queries. |

### B. Index UI Component Suite (`components/index/`)
*Modular, accessible UI library supporting grid/list layouts, audio previews, and local watchlists.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `Header.tsx` | Added | +225 | Site header with navigation tabs, "ENCORE // INDEX" branding, and live watchlist count badge. |
| `EventCard.tsx` | Added | +261 | High-density editorial concert card with artist image, date badge, venue, price, and watchlist toggle. |
| `EventListItem.tsx` | Added | +191 | Compact row layout for high-density listing views. |
| `IndexFeedContainer.tsx` | Added | +419 | Main catalog feed container with discovery mode chips (`All Shows`, `This Weekend`, `Cheap & Nearby`, `Worth Planning For`) and grid/list view switcher. |
| `ConcertDetailClient.tsx` | Added | +726 | Concert detail view with artist bio, venue details, lineup performers (`Lineup performer` for unknown roles), and ticket CTAs. |
| `SearchClient.tsx` | Added | +655 | Interactive search interface with live text filter, venue selector, price range sliders, and free-only filter. |
| `SavedWatchlistClient.tsx` | Added | +201 | Local browser watchlist desk with tabbed views, local storage disclosures, and zero fake metrics. |
| `AudioPreviewPlayer.tsx` | Added | +177 | Compact inline audio player for 30-second Spotify track previews. |
| `UndoToast.tsx` | Added | +90 | Toast component supporting single-click undo for saved show removals. |
| `formatters.ts` | Added | +261 | Utilities for dates, timezones, currency, and editorial match score display. |
| `icons.tsx` | Added | +697 | SVG icons for UI controls, mode chips, and navigation. |
| `types.ts` | Added | +439 | Shared TypeScript interfaces and adapter types (`IndexEventItem`, `ConcertDetailProps`). |
| `useWatchlist.ts` | Added | +197 | Custom React hook managing local browser watchlist state in `localStorage`. |

### C. Ticketmaster V2 Ingestion Engine (`lib/sources/ticketmaster/`)
*Enterprise-reliable client with date bisection, quota safety, and response fee transparency.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `client.ts` | Modified | +115 / -24 | Stripped unsupported `allInclusivePricing` query param; added API key whitespace trimming; added `syncHeaders()` capturing provider rate limits. |
| `parser.ts` | Modified | +60 / -48 | Removed speculative `estimatedFees`; parses `feeStatus` from `event.ticketing.allInclusivePricing.enabled`; assigns `billingPosition: 'unknown'` to attractions. |
| `partitioner.ts` | Added | +407 | Recursive temporal date bisection (<950 events threshold, sub-day bisection, maxDepth guard, explicit truncation telemetry). |
| `quota-guard.ts` | Added | +353 | Quota guard tracking 5,000 req/day limit, circuit breaker at 4,750, automatic UTC midnight reset, header synchronization, and optional file persistence. |
| `types.ts` | Modified | +37 / -14 | Cleaned `TicketmasterPriceRangeSchema` to match genuine Discovery API fields; updated query param types. |
| `errors.ts` | Added | +31 | Specialized error classes (`TicketmasterQuotaExceededError`, `TicketmasterApiError`). |
| `adapter.ts` | Modified | +3 / -3 | Removed unsupported request params from `TicketmasterSourceAdapter`. |

### D. Colorado Venue Coverage & Ingestion Pipeline (`lib/sources/venue/`)
*Unified multi-venue adapter for Z2 Entertainment and multi-horizon sync runner.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `z2-entertainment/adapter.ts` | Added | +128 | Source adapter for Z2 calendar (`z2ent.com/events`) onboarding 4 major Colorado venues. |
| `z2-entertainment/parser.ts` | Added | +609 | HTML parser extracting events from Webflow collection lists, resolving relative URLs, detecting sold-out statuses. |
| `z2-entertainment/types.ts` | Added | +129 | Schemas and TypeScript interfaces for Z2 raw events and candidate mappings. |
| `z2-entertainment/index.ts` | Added | +3 | Module exports for Z2 adapter. |
| `source-registry.ts` | Modified | +53 / -3 | Registered Z2 Entertainment as an active Colorado venue source. |
| `scripts/sync-all-sources.ts` | Added | +381 | Unified multi-horizon sync runner (`near-term`, `mid-term`, `long-term`, `full`) with quota safety. |
| `scripts/verify-live-ingestion.ts` | Added | +347 | Automated live verification script proving live TM + Z2 fetch and 100% idempotency against local database. |

### E. Entity Resolution & Domain Integrity (`lib/`)
*Ensures canonical persistence integrity, sold-out propagation, and accurate artist roles.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `canonicalization-coordinator.ts` | Modified | +15 / -4 | Preserves `billingPosition: 'unknown'` when not provided; propagates candidate `inventoryStatus` to ticket links. |
| `lib/domain/event-candidate.ts` | Modified | +3 / -0 | Added `feeStatus?: 'all_inclusive' | 'fees_excluded' | 'unknown'` to `CandidatePrice`. |
| `lib/domain/catalog.ts` | Modified | +3 / -0 | Added `inventoryStatus` to `CanonicalEventSummary`. |
| `lib/recommendation/service.ts` | Modified | +103 / -17 | Pushes scheduled status down to catalog queries; handles empty/filter-empty results truthfully; defaults limit to 50. |
| `lib/repositories/catalog-repository.ts` | Modified | +145 / -22 | Adds server-side `searchQuery` across events, venues, and artists with pagination. |

### F. Test Suites (`tests/`)
*Full test coverage across unit, integration, and end-to-end browser workflows.*

| File | Status | Lines Changed | Description |
|---|---|---|---|
| `tests/unit/index-components.test.tsx` | Added | +557 | 17 unit tests for Index components, adapters, watchlist hook, undo toast, and saved client. |
| `tests/unit/index-formatters.test.ts` | Added | +160 | Unit tests for date formatting, price display, and match score calculations. |
| `tests/unit/index-search-and-recommendations.test.ts` | Added | +743 | Unit tests verifying search filtering, mode filtering, and recommendation factors. |
| `tests/unit/ticketmaster-bisection.test.ts` | Added | +438 | 15 unit tests verifying recursive date partitioning, sub-day bisection, and truncation tracking. |
| `tests/unit/ticketmaster-quota.test.ts` | Added | +295 | 13 unit tests verifying quota limits, circuit breaker, reset time, and header synchronization. |
| `tests/unit/ticketmaster-adapter.test.ts` | Modified | +63 / -48 | 35 unit tests verifying client, adapter, unknown artist roles, and feeStatus parsing. |
| `tests/unit/z2-adapter.test.ts` | Added | +219 | Unit tests for Z2 Entertainment source adapter. |
| `tests/unit/z2-parser.test.ts` | Added | +403 | Unit tests for Z2 HTML parsing, venue disambiguation, and sold-out detection. |
| `tests/unit/app-routes.test.tsx` | Added | +470 | Unit tests for App Router pages and routes. |
| `tests/e2e/index-flow.spec.ts` | Added | +114 | 4 Playwright browser E2E tests for Home, Search, Saved, and Preferences flows. |
| `tests/fixtures/z2-events-response.html` | Added | +212 | Realistic fixture of Z2 Entertainment Webflow calendar markup. |
| `tests/integration/spotify-live-audit.test.ts` | Modified | +28 / -3 | Scoped provider assertion to `provider = 'spotify'` and allowed internationalized URL prefixes. |

---

## 4. Full File-by-File Diff Table

Below is the complete file listing comparing `feature/encore-v2-index-ticketmaster` against the Spotify baseline (`4009277`):

| File Path | Status | +/- Lines | Core Responsibility |
|---|:---:|:---:|---|
| `.gitignore` | `M` | +2 / -0 | Adds `.ticketmaster-quota.json` to runtime ignores |
| `AI_HANDOFF.md` | `M` | +53 / -40 | Current operational status and handoff notes |
| `ENCORE_V2_COMBINED_IMPLEMENTATION_REPORT.md` | `A` | +291 / -0 | Full Milestone 0–6 implementation report |
| `ENCORE_V2_FINAL_REMEDIATION_REPORT.md` | `A` | +256 / -0 | Audit remediation report with live ingestion proof |
| `app/api/catalog/search/route.ts` | `A` | +100 / -0 | Real-time catalog search API endpoint |
| `app/concerts/[id]/page.tsx` | `A` | +157 / -0 | Production concert detail route |
| `app/page.tsx` | `M` | +140 / -10 | Production index homepage with live Supabase feed |
| `app/preferences/page.tsx` | `A` | +192 / -0 | Production user preferences route |
| `app/saved/page.tsx` | `A` | +32 / -0 | Production saved watchlist route |
| `app/search/page.tsx` | `A` | +43 / -0 | Production catalog search route |
| `components/catalog/EventCard.tsx` | `M` | +7 / -2 | Passes inventoryStatus to concert card badge |
| `components/index/AudioPreviewPlayer.tsx` | `A` | +177 / -0 | 30s Spotify preview audio player |
| `components/index/ConcertDetailClient.tsx` | `A` | +726 / -0 | Detail client with lineup and ticket actions |
| `components/index/EventCard.tsx` | `A` | +261 / -0 | Index visual design concert card |
| `components/index/EventListItem.tsx` | `A` | +191 / -0 | High-density list item layout |
| `components/index/Header.tsx` | `A` | +225 / -0 | Index navigation header with live badge |
| `components/index/IndexFeedContainer.tsx` | `A` | +419 / -0 | Feed container with mode chips and view toggle |
| `components/index/SavedWatchlistClient.tsx` | `A` | +201 / -0 | Watchlist desk with truthful local disclosures |
| `components/index/SearchClient.tsx` | `A` | +655 / -0 | Catalog search client with multi-filters |
| `components/index/UndoToast.tsx` | `A` | +90 / -0 | Undo notification toast |
| `components/index/formatters.ts` | `A` | +261 / -0 | Formatting utilities for index components |
| `components/index/icons.tsx` | `A` | +697 / -0 | SVG icons for index visual design |
| `components/index/index.ts` | `A` | +13 / -0 | Module barrel exports |
| `components/index/types.ts` | `A` | +439 / -0 | TypeScript interfaces for index components |
| `components/index/useWatchlist.ts` | `A` | +197 / -0 | React hook for localStorage watchlist |
| `docs/screenshots/encore-v2-index-home.png` | `A` | Bin (100KB) | Visual snapshot: Index Home Feed |
| `docs/screenshots/encore-v2-index-preferences.png` | `A` | Bin (83KB) | Visual snapshot: Preferences Desk |
| `docs/screenshots/encore-v2-index-saved.png` | `A` | Bin (72KB) | Visual snapshot: Saved Watchlist Desk |
| `docs/screenshots/encore-v2-index-search.png` | `A` | Bin (93KB) | Visual snapshot: Search Interface |
| `docs/screenshots/john-summit-card-detail.png` | `M` | Bin (63KB) | Visual snapshot: John Summit Concert Detail |
| `docs/screenshots/john-summit-discover-personalized.png` | `M` | Bin (79KB) | Visual snapshot: Personalized Discover Card |
| `lib/domain/catalog.ts` | `M` | +3 / -0 | Adds inventoryStatus to CanonicalEventSummary |
| `lib/domain/event-candidate.ts` | `M` | +3 / -0 | Adds feeStatus to CandidatePrice |
| `lib/entity-resolution/canonicalization-coordinator.ts` | `M` | +15 / -4 | Preserves unknown roles; persists inventory status |
| `lib/recommendation/service.ts` | `M` | +103 / -17 | Pushes scheduled status down; default limit 50 |
| `lib/repositories/catalog-repository.ts` | `M` | +145 / -22 | Server-side searchQuery across events/venues/artists |
| `lib/repositories/interfaces.ts` | `M` | +6 / -0 | Adds searchQuery to EventListFilters |
| `lib/repositories/memory-repositories.ts` | `M` | +72 / -3 | In-memory search filtering support for tests |
| `lib/sources/ticketmaster/adapter.ts` | `M` | +3 / -3 | Removes unsupported query params from adapter |
| `lib/sources/ticketmaster/client.ts` | `M` | +115 / -24 | Strips query params; trims key; syncs headers |
| `lib/sources/ticketmaster/errors.ts` | `M` | +31 / -0 | Custom Ticketmaster error taxonomy |
| `lib/sources/ticketmaster/index.ts` | `M` | +2 / -0 | Exports partitioner and quota guard |
| `lib/sources/ticketmaster/parser.ts` | `M` | +60 / -48 | Parses feeStatus; sets unknown billingPosition |
| `lib/sources/ticketmaster/partitioner.ts` | `A` | +407 / -0 | Sub-day date bisection engine with truncation tracking |
| `lib/sources/ticketmaster/quota-guard.ts` | `A` | +353 / -0 | Header-synced quota guard with circuit breaker |
| `lib/sources/ticketmaster/types.ts` | `M` | +37 / -14 | Strips unsupported params; strict price range schema |
| `lib/sources/venue/index.ts` | `M` | +1 / -0 | Exports Z2 Entertainment adapter |
| `lib/sources/venue/ingestion-pipeline.ts` | `M` | +11 / -2 | Venue ingestion pipeline enhancements |
| `lib/sources/venue/source-registry.ts` | `M` | +53 / -3 | Registers Z2 Entertainment source |
| `lib/sources/venue/types.ts` | `M` | +4 / -2 | Venue crawler typing updates |
| `lib/sources/venue/z2-entertainment/adapter.ts` | `A` | +128 / -0 | Z2 Entertainment source adapter |
| `lib/sources/venue/z2-entertainment/index.ts` | `A` | +3 / -0 | Module exports |
| `lib/sources/venue/z2-entertainment/parser.ts` | `A` | +609 / -0 | Z2 Webflow calendar HTML parser |
| `lib/sources/venue/z2-entertainment/types.ts` | `A` | +129 / -0 | Z2 candidate and raw event schemas |
| `package.json` | `M` | +1 / -0 | Adds `sync:all` npm run script |
| `scripts/ingest-venue.ts` | `M` | +6 / -3 | Supports Z2 source slug |
| `scripts/sync-all-sources.ts` | `A` | +381 / -0 | Multi-source rolling synchronization CLI |
| `scripts/verify-live-ingestion.ts` | `A` | +347 / -0 | Live ingestion verification runner |
| `tests/e2e/discover.spec.ts` | `M` | +14 / -4 | Seeds events for today; tests guest discover flow |
| `tests/e2e/index-flow.spec.ts` | `A` | +114 / -0 | Playwright E2E tests for Index user flows |
| `tests/e2e/smoke.spec.ts` | `M` | +33 / -3 | Updates smoke tests for Index routes |
| `tests/fixtures/z2-events-response.html` | `A` | +212 / -0 | Z2 Entertainment calendar HTML fixture |
| `tests/integration/john-summit-recommendation.test.ts` | `M` | +18 / -0 | Integration test teardown hardening |
| `tests/integration/spotify-catalog-enrichment.test.ts` | `M` | +3 / -1 | Integration test assertion updates |
| `tests/integration/spotify-live-audit.test.ts` | `M` | +28 / -3 | Scopes to spotify provider; allows intl URL prefixes |
| `tests/integration/spotify-live-auth.test.ts` | `M` | +23 / -3 | Integration test auth error handling |
| `tests/integration/spotify-live-recommendations.test.ts` | `M` | +48 / -3 | Teardown scoping in recommendation integration |
| `tests/unit/app-routes.test.tsx` | `A` | +470 / -0 | Route rendering unit tests |
| `tests/unit/canonicalization-coordinator.test.ts` | `M` | +110 / -3 | Tests sold-out status and unknown role preservation |
| `tests/unit/index-components.test.tsx` | `A` | +557 / -0 | 17 unit tests for Index components |
| `tests/unit/index-formatters.test.ts` | `A` | +160 / -0 | Unit tests for formatters |
| `tests/unit/index-search-and-recommendations.test.ts` | `A` | +743 / -0 | Unit tests for search and recommendation service |
| `tests/unit/ticketmaster-adapter.test.ts` | `M` | +63 / -48 | 35 unit tests for Ticketmaster adapter and client |
| `tests/unit/ticketmaster-bisection.test.ts` | `A` | +438 / -0 | 15 unit tests for date partitioning |
| `tests/unit/ticketmaster-quota.test.ts` | `A` | +295 / -0 | 13 unit tests for quota guard and header sync |
| `tests/unit/z2-adapter.test.ts` | `A` | +219 / -0 | Unit tests for Z2 adapter |
| `tests/unit/z2-parser.test.ts` | `A` | +403 / -0 | Unit tests for Z2 HTML parser |

---

## 5. Verification Suite Alignment

| Suite | Status | Execution Time | Results |
|---|:---:|:---:|---|
| **Formatting** (`npm run format:check`) | **PASS** | 4.10s | 100% Prettier compliant across all 150+ project files |
| **Linting** (`npm run lint`) | **PASS** | 3.80s | 0 ESLint warnings, 0 errors |
| **Typecheck** (`npm run typecheck`) | **PASS** | 1.80s | `tsc --noEmit`, 0 TypeScript errors |
| **Unit Tests** (`npm test`) | **PASS** | 5.85s | **63/63 test files passed, 858/858 tests passed** |
| **Integration Tests** (`npm run test:integration`) | **PASS** | 21.11s | **13/13 test files passed, 104/104 tests passed** |
| **Playwright E2E** (`npx playwright test`) | **PASS** | 21.30s | **16/16 browser tests passed in Chromium** |
| **Production Build** (`npm run build`) | **PASS** | 8.80s | Clean Next.js 15.5.27 production build (18 routes) |
| **Live Ingestion Runner** (`verify-live-ingestion.ts`) | **PASS** | 4.20s | 303 canonical events; Pass 2 100% idempotent (0 duplicates) |
