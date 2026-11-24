# Encore Codebase Audit — Category L & Verification Report
**Auditing Agent:** Agent 4 — Verification & Integration  
**Date:** November 16, 2026  
**Target Commit:** `43d052c` (local `main`), comparing `origin/main` (`3adbf59`) and `encore_index_main_site` (`fe3e77d`)

---

## Executive Summary

As part of the ENCORE repository audit, Agent 4 conducted an exhaustive, independent challenge and verification of the codebase across Category L (Development & Deployment) and cross-cutting architectural claims.

### Key Audit Findings & Headline Realities:
1. **Production Build Clean, But Prettier Check Fails:** `npm run build` compiles cleanly (14 routes, 103 kB shared JS), and `tsc --noEmit` and `next lint` pass with 0 errors. However, `npm run format:check` currently **fails** on 5 files because `.backup/` was added to `.gitignore` but omitted from `.prettierignore`.
2. **Integration Test Reality Check:** When Docker / local Supabase is offline, `npm run test:integration` **fails** (3 test files throw errors). More critically, 5 integration test suites silently execute early `return;` without running any assertions, causing Vitest to mark them as "passed" when zero validation occurred.
3. **E2E Playwright Tests Require Loopback Network & DB:** `npm run test:e2e` cannot run in standard sandbox environments due to loopback network restrictions (`net::ERR_ACCESS_DENIED`), and authenticated tests skip locally when Supabase is down (while throwing in CI).
4. **Spotify Personalization Infrastructure vs Catalog Reality Gap:** The Spotify OAuth flow, token encryption, 60/30/10 recency decay, and scoring factor are fully implemented and unit tested. However, the local catalog contains **0 Spotify artist external IDs** (`artist_external_ids` with `provider = 'spotify'`) across all 244 Colorado concerts. In reality, Spotify listening affinity currently scores 0 events in the live catalog.
5. **Branch Reconciliation & Worktree Drift:** Local `main` is 2 commits behind `origin/main` (lacking PR #16 data cleanup and PR #17 security fix). The branch `encore_index_main_site` / `feature/ui-prototypes-and-spotify-sync` exists in a separate worktree with +28,201 unmerged lines of experimental UI prototypes and skills.
6. **Ticketmaster Ingestion Live Gap:** Adapter, parser, and pipeline are fully tested against JSON fixtures. A live Ticketmaster API key exists in `.env.local`, but live ingestion is not scheduled or executed in CI.

---

## Detailed Category L Audit Inventory

### L-1: CI/CD Workflows & Automation
- **Stable ID:** `DEV-CICD-001`
- **Implementation Status:** `PARTIAL`
- **Exact Evidence:**
  - Workflow: `.github/workflows/ci.yml` (72 lines)
  - Package scripts: `package.json` (`npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:integration`)
- **What Actually Works:**
  - Pull requests and pushes targeting `main` trigger a single unified verification job on pinned `ubuntu-24.04`.
  - Step order is strict: checkout -> Node.js 24 setup -> `npm ci` -> format check -> lint -> pre-build typecheck -> in-memory unit tests -> Playwright Chromium installation -> local Supabase startup & migration reset (`npm run db:start && npm run db:reset`) -> Next.js production build (`npm run build`) -> post-build regression typecheck -> browser E2E tests (`npm run test:e2e`) -> integration tests (`npm run test:integration`) -> Supabase teardown (`npm run db:stop`).
- **What is Missing or Incomplete:**
  - **Zero Continuous Deployment (CD):** No deployment workflows exist for Vercel, Netlify, Fly.io, Cloudflare, or AWS.
  - **No Scheduled Ingestion:** No GitHub Actions cron workflows exist to periodically ingest venue calendars or Ticketmaster events.
  - **Synthetic Catalog Audit Not in CI:** While `npm run audit:synthetic` was added in PR #16, it is not executed as a verification step in `ci.yml`.
  - **No Staging / Preview Environment:** Only local ephemeral Supabase inside the CI runner container is used.
- **Integration Status:** Integrated for PR verification; unintegrated for deployments.
- **Dependencies or Blockers:** Requires cloud hosting provider selection (e.g. Vercel/Supabase Cloud) to establish CD pipeline.
- **Recommended Next Action:** Add deployment workflow (CD) targeting staging/production, add scheduled nightly venue ingestion workflow, and wire `npm run audit:synthetic` into `ci.yml`.

---

### L-2: Unit Test Suite & Inventory
- **Stable ID:** `DEV-UNIT-001`
- **Implementation Status:** `VERIFIED COMPLETE`
- **Exact Evidence:**
  - Config: `vitest.config.ts` (jsdom environment, setupFiles `tests/setup.ts`)
  - Inventory: 50 test files, 645 passed tests on local `main` (51 files, 651 tests on `origin/main` after PR #16)
  - Execution Time: ~28 seconds
  - Coverage: Scrapers (`boulder-venues-parser`, `denver-venues-pipeline`, `cervantes-parser`, `independent-venue-parser`), Entity Resolution (`canonicalization-coordinator`, `entity-resolution`), Recommendation Engine (`recommendation-engine`, `recommendation-factors`, `recommendation-presets`, `discovery-modes`), Spotify (`spotify-client`, `spotify-oauth`, `spotify-crypto`, `spotify-affinity-service`), and UI components (`discover-components`, `taste-components`, `hub-components`).
- **What Actually Works:**
  - 100% in-memory execution without network or database dependencies.
  - Assertions are rigorous: tests assert specific timestamps, UTC/Denver timezone offsets, exact ticket URLs, parsed artist billings, and score values.
  - Zero tautological assertions (no `expect(true).toBe(true)` or blind `expect().toBeTruthy()`).
- **What is Missing or Incomplete:**
  - Minor console noise: React 19 `act(...)` warning logs appear during `discover-components.test.tsx` when state updates occur outside `act()`.
- **Integration Status:** Fully integrated in local development and CI.
- **Dependencies or Blockers:** None.
- **Recommended Next Action:** Wrap remaining asynchronous state transitions in `tests/unit/discover-components.test.tsx` in `act()` to eliminate console noise.

---

### L-3: Integration Test Suite & Dependencies
- **Stable ID:** `DEV-INT-001`
- **Implementation Status:** `IMPLEMENTED / UNVERIFIED (LOCALLY)` / `VERIFIED IN CI`
- **Exact Evidence:**
  - Config: `vitest.integration.config.ts` (Node environment, `fileParallelism: false`)
  - Inventory: 8 test files, 59 tests:
    - `catalog-rls.test.ts` (13 tests)
    - `golden-path.test.ts` (7 tests)
    - `personalized-discover.test.ts` (3 tests)
    - `profiles-rls.test.ts` (7 tests)
    - `recommendation-scoring.test.ts` (3 tests)
    - `spotify-connection-rls.test.ts` (9 tests)
    - `ticketmaster-canonicalization.test.ts` (7 tests)
    - `user-preferences-rls.test.ts` (10 tests)
- **What Actually Works:**
  - When Supabase is running with migrations applied, tests verify actual PostgreSQL RLS enforcement, composite primary keys, check constraints, foreign keys, and atomic canonicalization stored procedures.
  - In PR #16, teardown was hardened with `fetchAllIdsPaginated` and tracking of strictly test-created entity IDs.
- **What is Missing or Incomplete:**
  - **Local Failure When Docker is Offline:** Running `npm run test:integration` without local Supabase running fails with 3 suite errors.
  - **False Positive Silent Passes:** 5 of the 8 suites (`golden-path`, `profiles-rls`, `spotify-connection-rls`, `ticketmaster-canonicalization`, `user-preferences-rls`) execute `if (!isDbAvailable) return;` inside each test case. When Supabase is offline, Vitest treats early returns as passed tests, falsely reporting 50 passing tests.
- **Integration Status:** Fully integrated in CI; requires active Docker daemon and Supabase CLI locally.
- **Dependencies or Blockers:** Requires Docker Desktop / Colima running on the developer workstation.
- **Recommended Next Action:** Standardize integration test behavior when the database is offline: rather than silent `return;`, use `describe.skipIf(!isDbAvailable)` so tests are accurately reported as SKIPPED rather than PASSED.

---

### L-4: End-to-End Test Suite & Browser Automation
- **Stable ID:** `DEV-E2E-001`
- **Implementation Status:** `VERIFIED IN CI` / `BLOCKED LOCALLY IN SANDBOX`
- **Exact Evidence:**
  - Config: `playwright.config.ts` (spawns `npm run start` on port 3000)
  - Inventory: 4 spec files, 11 tests:
    - `tests/e2e/smoke.spec.ts` (7 tests: `/`, `/discover`, `/hub`, `/login`, `/profile/taste`, `/taste`, `/discover/scoring-preview`)
    - `tests/e2e/discover.spec.ts` (1 comprehensive test)
    - `tests/e2e/spotify-taste.spec.ts` (2 tests)
    - `tests/e2e/taste-auth.spec.ts` (1 test)
- **What Actually Works:**
  - In CI on Ubuntu, all 11 tests pass against the compiled Next.js server and local Supabase instance.
  - Public routes render actual DOM elements, headings, status badges, and interactive controls without mock stubs.
  - The Project Hub (`/hub`) renders interactive architecture maps with SVG node connections and inspector panels.
- **What is Missing or Incomplete:**
  - **Local Sandbox Execution Blocked:** In standard macOS terminal sandbox environments, Chromium cannot connect to `http://127.0.0.1:3000` (`net::ERR_ACCESS_DENIED`), causing all browser tests to fail.
  - **Authenticated Tests Require Database:** Authenticated tests skip locally if Supabase is offline. In CI, skipping is strictly forbidden (`throw new Error(...)`).
- **Integration Status:** Passing in GitHub Actions CI.
- **Dependencies or Blockers:** Requires full unsandboxed loopback network permission and running Supabase stack.
- **Recommended Next Action:** Document that Playwright tests must be run unsandboxed or within CI, and ensure local Supabase is started prior to test runs.

---

### L-5: Production Build & Asset Optimization
- **Stable ID:** `DEV-BUILD-001`
- **Implementation Status:** `VERIFIED COMPLETE (BUILD)` / `PARTIAL (FORMATTING)`
- **Exact Evidence:**
  - Build Command: `npm run build` (`next build`)
  - Build Artifacts: `.next/`, 14 compiled routes
  - Lint & Format: `npm run lint` (0 errors), `npm run typecheck` (0 errors), `npm run format:check` (5 errors)
- **What Actually Works:**
  - Next.js 15.5.27 compiles all routes with 0 TypeScript and 0 ESLint errors in 2.6 seconds.
  - Shared First Load JS is lean at 103 kB.
  - Route compilation breakdown:
    - Static: `/` (163 B), `/_not-found` (996 B), `/hub` (17.8 kB), `/manifest.webmanifest` (141 B), `/taste` (141 B).
    - Dynamic: `/discover` (11.2 kB), `/discover/scoring-preview` (4.67 kB), `/login` (1.84 kB), `/profile/taste` (9.04 kB), and 5 API routes.
- **What is Missing or Incomplete:**
  - **`npm run format:check` Fails:** 5 JSON backup files under `.backup/` fail Prettier formatting because `.backup` is listed in `.gitignore` but not `.prettierignore`.
- **Integration Status:** Production build is deploy-ready; formatting check requires one-line configuration fix.
- **Dependencies or Blockers:** None.
- **Recommended Next Action:** Add `.backup` and `scratch/` to `.prettierignore`.

---

### L-6: Working Environment Configuration
- **Stable ID:** `DEV-ENV-001`
- **Implementation Status:** `VERIFIED COMPLETE`
- **Exact Evidence:**
  - Schema files: `lib/env/server.ts`, `lib/env/public.ts`
  - Config files: `.env.example`, `.env.local`
- **What Actually Works:**
  - Strict runtime Zod validation distinguishes server-only variables from browser-exposed public variables.
  - `lib/env/public.ts` validates `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
  - `lib/env/server.ts` validates `SUPABASE_SERVICE_ROLE_KEY` (mandatory), `SPOTIFY_TOKEN_ENCRYPTION_KEY` (must be 64-character hex string), and optional external API keys (`TICKETMASTER_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`).
  - `.env.local` is present in the workspace with all 10 required keys defined and populated.
- **What is Missing or Incomplete:**
  - Production secrets must be loaded via hosting provider environment variables rather than `.env.local`.
- **Integration Status:** Fully integrated.
- **Dependencies or Blockers:** None.
- **Recommended Next Action:** Maintain strict parity between `.env.example` and new phase environment variables.

---

### L-7: Branch Reconciliation & Git Worktree Topology
- **Stable ID:** `DEV-GIT-001`
- **Implementation Status:** `PARTIAL / DIVERGENT`
- **Exact Evidence:**
  - Local branch `main`: at commit `43d052c` (PR #15: Boulder Independent Venues)
  - Remote branch `origin/main`: at commit `3adbf59` (PR #17), ahead by 2 commits (`d35d02a` PR #16 and `3adbf59` PR #17)
  - Branch `encore_index_main_site` / `feature/ui-prototypes-and-spotify-sync`: at commit `fe3e77d`, checked out in active worktree `/Users/juliankotara/.gemini/antigravity/worktrees/Encore-concert-finder/encore_index_main_site`
- **What Actually Works:**
  - `origin/main` is healthy, passing CI, and contains all PRs up to PR #17.
- **What is Missing or Incomplete:**
  - Local `main` working directory is not fast-forwarded to `origin/main`.
  - The prototype branch (`encore_index_main_site`) contains +28,201 unmerged lines (including large design skill folders in `.agents/skills/`, prototype routes in `app/prototypes/`, and prototype test suites). It represents parallel prototype exploration that has not been reconciled or merged into `main`.
- **Integration Status:** Divergent across local `main`, `origin/main`, and prototype worktree.
- **Dependencies or Blockers:** Requires fast-forwarding local `main` and determining whether prototypes in `encore_index_main_site` should be merged, archived, or kept in a dedicated prototype directory.
- **Recommended Next Action:** Fast-forward local `main` to `origin/main` (`git pull --ff-only origin main`). Review prototype worktree for any reusable UX patterns before decommissioning.

---

### L-8: Synthetic vs Real Data Flows & Catalog Cleanliness
- **Stable ID:** `DATA-SYNTH-001`
- **Implementation Status:** `VERIFIED COMPLETE`
- **Exact Evidence:**
  - Script: `scripts/cleanup-synthetic-data.ts`
  - Guardrail: `lib/supabase/destination-guard.ts` (`assertSafeDatabaseTarget`)
  - Fixtures: `tests/fixtures/recommendation-fixtures.ts`, `lib/sources/spotify/synthetic-preview.ts`
  - Scoring Preview Guard: `lib/recommendation/preview-guard.ts` (`isScoringPreviewAllowed`)
- **What Actually Works:**
  - `scripts/cleanup-synthetic-data.ts` operates strictly as a read-only audit diagnostic utility with paginated PostgREST queries (`fetchAllPaginated`). It executes zero delete or write operations.
  - Synthetic data identification is strictly provenance-based (tracking known test source IDs, slug prefixes, and `example.com` domains) without heuristic name matching.
  - Production guardrails are absolute: `isScoringPreviewAllowed()` and `isSyntheticPreviewAllowed()` return `false` in production unless running under automated CI/Playwright runners with explicit preview flags.
  - Real database queries in `lib/recommendation/service.ts` query genuine catalog tables via Supabase repositories.
- **What is Missing or Incomplete:**
  - None. Synthetic data is isolated from production queries.
- **Integration Status:** Fully integrated and verified.
- **Dependencies or Blockers:** None.
- **Recommended Next Action:** Add `npm run audit:synthetic` to GitHub Actions CI to ensure synthetic test pollution never enters database snapshots.

---

### L-9: Database Migrations, Type Safety & Schema Drift
- **Stable ID:** `DATA-MIGR-001`
- **Implementation Status:** `PARTIAL`
- **Exact Evidence:**
  - Migrations: 9 SQL migration files in `supabase/migrations/` (20261002000000 through 20261022180000)
  - Repositories: `lib/repositories/catalog-repository.ts`, `lib/repositories/profile-repository.ts`, `lib/repositories/spotify-connection-repository.ts`
- **What Actually Works:**
  - Migrations run in strict chronological order during `supabase db reset`, applying tables, indexes, constraints, views (`public_sources`), and stored procedures (`apply_canonicalization`).
- **What is Missing or Incomplete:**
  - **No Automated TypeScript Database Types:** The repository does not use `supabase gen types typescript` to generate a `database.types.ts` file.
  - Supabase client queries are untyped at the SDK boundary, relying on manually maintained TypeScript interfaces (e.g., `ArtistRow`, `VenueRow`). If SQL columns change without updating manual interfaces, TypeScript cannot detect the discrepancy at compile time.
- **Integration Status:** Database schema is versioned; type generation is unintegrated.
- **Dependencies or Blockers:** Requires local Supabase or Supabase CLI to generate types.
- **Recommended Next Action:** Add a `db:types` script (`supabase gen types typescript --local > lib/supabase/database.types.ts`) and bind generated types to `createClient<Database>()`.

---

### L-10: Independent Verification & Challenge of Architecture Claims
- **Stable ID:** `AUDIT-CHALLENGE-001`
- **Implementation Status:** `VERIFIED WITH CHALLENGES`
- **Detailed Challenge Findings:**

| Feature Claim | Audit Reality | Verdict |
|---|---|---|
| **Phase 3 Boulder Venues** (Velvet Elk & Roots Music Project) | Scrapers, detail page enrichment, Eventbrite JSON parsing, URL security validation, CLI integration, and 38 unit tests are 100% complete and passing. | **VERIFIED COMPLETE** |
| **Phase 3 Denver Venues** (Cervantes, Larimer, Lost Lake, Globe Hall) | Ingestion pipeline, billing extraction, date/time normalization, and CLI batch runners are complete and passing with 41 unit tests. | **VERIFIED COMPLETE** |
| **Spotify Personalization Algorithm** | Token refresh, AES-256 encryption, 60/30/10 recency decay, and artist scoring factor are complete. | **VERIFIED COMPLETE** |
| **Spotify Concert Personalization in Practice** | **Catalog Gap:** While the algorithm works, 0 out of 579 artists in the catalog have a Spotify external ID. Venue scrapers extract names from HTML without Spotify IDs. Therefore, live Spotify affinity matches 0 events in the real catalog until an artist enrichment service is added. | **CHALLENGE: IMPLEMENTED BUT ZERO LIVE MATCHES** |
| **Ticketmaster Live Ingestion** | Adapter, parser, and canonicalization are verified against JSON fixtures. An API key exists in `.env.local`. However, live ingestion against Ticketmaster has not been executed or scheduled in CI. | **CHALLENGE: UNVERIFIED LIVE** |
| **Integration Test Coverage** | Passes in GitHub Actions CI where Docker is provisioned. Locally, when Docker is offline, 3 test files fail and 5 silently skip without assertions. | **CHALLENGE: CONDITIONAL / FALSE SENSE OF SECURITY LOCALLY** |
| **Z2 Entertainment Venues** (Boulder Theater, Fox Theatre, Aggie Theatre) | Originally slated as next priority in `AI_HANDOFF.md`, but deferred during PR #16 review remediation. Not yet implemented. | **NOT IMPLEMENTED (PLANNED)** |
| **Code Style Verification** | `npm run format:check` currently fails due to unformatted backup files in `.backup/` not being in `.prettierignore`. | **CHALLENGE: FAILING LOCALLY** |

---

## Technical Debt & Deployment Blockers

### Strict Deployment Blockers:
1. **Missing CD Workflow:** No automated deployment pipeline exists to deploy commits on `main` to a staging or production hosting environment.
2. **Missing Production Supabase Instance:** Current verification relies entirely on local ephemeral Supabase Docker containers. Production database migrations, RLS policies, and service role credentials must be provisioned in a hosted Supabase project.

### Priority Technical Debt:
1. **`.prettierignore` Missing `.backup`:** Blocks clean `npm run format:check`. Fix is a simple one-line addition to `.prettierignore`.
2. **Integration Test Silent Returns:** 5 integration test suites return early without assertions when Supabase is offline. They should use `describe.skipIf(!isDbAvailable)` to avoid reporting false passing tests.
3. **Absence of Supabase Database Types:** Manual TypeScript interfaces should be replaced with automated `supabase gen types typescript` to ensure compile-time schema safety.
4. **Spotify Artist Identity Enrichment:** Implement an ingestion-time or background artist enrichment step (via MusicBrainz API or Spotify Web Search API) to resolve venue artist names to canonical Spotify artist IDs so Spotify listening affinities actually match live concert catalog events.
5. **Local `main` Fast-Forward:** Fast-forward local `main` to `origin/main` to integrate PR #16 and PR #17 fixes.
