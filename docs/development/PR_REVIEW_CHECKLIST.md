# Encore — Pull Request Review & Self-Audit Checklist

> **Authoritative Engineering Standards and Review Protocol**  
> Applicable to all human contributors and AI coding agents (Antigravity, ChatGPT, Claude, and peers).  
> **Status:** Mandatory. All pull requests must satisfy this checklist prior to external code review or merge.

---

## Table of Contents

1. [Overview & Review Philosophy](#1-overview--review-philosophy)
2. [Checklist Scope: Always Required vs. Applicable When Relevant](#2-checklist-scope-always-required-vs-applicable-when-relevant)
3. [Architecture & Cross-Layer Data Flow](#3-architecture--cross-layer-data-flow)
4. [Authentication, Authorization & Privacy](#4-authentication-authorization--privacy)
5. [Canonical Identity, Deduplication & Provenance](#5-canonical-identity-deduplication--provenance)
6. [Missing Data & External-Source Integrity](#6-missing-data--external-source-integrity)
7. [Dates, Time Zones & Money](#7-dates-time-zones--money)
8. [Recommendation Scoring Integrity](#8-recommendation-scoring-integrity)
9. [Ingestion & Database Integrity](#9-ingestion--database-integrity)
10. [Synthetic Previews & Development Tooling](#10-synthetic-previews--development-tooling)
11. [External API Integration Reliability](#11-external-api-integration-reliability)
12. [User Interface & Browser Behavior](#12-user-interface--browser-behavior)
13. [Testing & CI Requirements](#13-testing--ci-requirements)
14. [Historical Regression Checklist](#14-historical-regression-checklist)
15. [Mandatory Pre-Review Self-Audit Procedure](#15-mandatory-pre-review-self-audit-procedure)
16. [Definition of Done — Before External Code Review](#16-definition-of-done--before-external-code-review)
17. [Standardized PR Handoff Report Template](#17-standardized-pr-handoff-report-template)

---

## 1. Overview & Review Philosophy

Across Encore PRs #6 through #11, external code reviews repeatedly uncovered preventable issues: identity mismatches, unverified cross-layer data flows, mock-only assumptions, naive timezone handling, accidental foreign currency equivalence, and skipped CI workflows.

This document establishes the permanent, non-negotiable review checklist to eliminate these recurring mistakes.

### Core Principles

1. **A passing build is necessary but not sufficient:** Passing CI or green unit tests does not prove that a feature functions correctly end-to-end, that edge cases are handled, or that security boundaries are enforced.
2. **Never turn unknown data into fabricated certainty:** Missing information (prices, start times, currencies, artist IDs) must be handled neutrally and transparently—never guessed or coerced into arbitrary defaults.
3. **Trace every field through the full application lifecycle:** A field existing in a TypeScript interface does not prove that upstream queries populate it or that downstream UI components receive it.
4. **Honest, verifiable reporting:** Agents must report exact test counts, real CI run URLs, and remaining risks. Never fabricate test outcomes or claim an unavailable test passed.

---

## 2. Checklist Scope: Always Required vs. Applicable When Relevant

To balance rigor with productivity, the checklist distinguishes between universal requirements and domain-specific requirements.

### Always Required for Every PR
- [ ] **Context Preflight:** Read `AGENTS.md`, `AI_HANDOFF.md`, `docs/index.md`, and the active phase specification before writing code.
- [ ] **Complete Diff Self-Audit:** Inspect the full `git diff` against the target base branch before requesting review.
- [ ] **Cross-Layer Data Tracing:** Verify that all data fields touched by the PR are populated and consumed across every layer.
- [ ] **Security Boundaries:** Ensure no secrets, tokens, or private user data are exposed to client bundles, logs, or repository commits.
- [ ] **Relevant Automated Verification:** Execute formatting, linting, strict TypeScript typechecking, and unit tests locally.
- [ ] **CI Verification on Latest Commit:** Verify that GitHub Actions checks succeed on the exact latest commit pushed to the PR branch.
- [ ] **Honest Handoff Report:** Complete the standardized PR handoff report with exact test numbers and identified risks.

### Applicable When Relevant to Touched Subsystems
- **Touches Auth or User Data:** Complete [Section 4: Authentication, Authorization & Privacy](#4-authentication-authorization--privacy).
- **Touches Artists, Venues, or Events:** Complete [Section 5: Canonical Identity, Deduplication & Provenance](#5-canonical-identity-deduplication--provenance).
- **Touches Ingestion, External Sources, or Third-Party Data:** Complete [Section 6: Missing Data & External-Source Integrity](#6-missing-data--external-source-integrity) and [Section 11: External API Integration Reliability](#11-external-api-integration-reliability).
- **Touches Dates, Times, Prices, or Budgets:** Complete [Section 7: Dates, Time Zones & Money](#7-dates-time-zones--money).
- **Touches Recommendation or Ranking:** Complete [Section 8: Recommendation Scoring Integrity](#8-recommendation-scoring-integrity).
- **Touches Database Schemas, RLS, or Ingestion Tables:** Complete [Section 9: Ingestion & Database Integrity](#9-ingestion--database-integrity).
- **Touches Dev Previews or Mock Fixtures:** Complete [Section 10: Synthetic Previews & Development Tooling](#10-synthetic-previews--development-tooling).
- **Touches UI Components, Pages, or Client State:** Complete [Section 12: User Interface & Browser Behavior](#12-user-interface--browser-behavior).

---

## 3. Architecture & Cross-Layer Data Flow

> [!WARNING]
> **A field existing in a TypeScript interface does not prove that the application populates it.**  
> TypeScript interfaces define shape, not runtime behavior. A caller can return `undefined` or omit a joined column without triggering a compilation error if the property is optional or cast.

Every PR that adds or alters data fields must explicitly trace them through the full architecture:

```text
Database Table / View
       │ (SQL SELECT / PostgREST query join)
       ▼
Repository Layer
       │ (Mapping to domain entities)
       ▼
Domain Model & Value Objects
       │ (Typed business representations)
       ▼
Service / Scorer / Pipeline
       │ (Business calculations & transformations)
       ▼
API Route / Server Action
       │ (Boundary validation, serialization, security gating)
       ▼
React Component / Client Hook
       │ (State management, rendering, user interactions)
       ▼
User Experience & Explanations
```

### Verification Items
- [ ] **Source Verification:** The data source (PostgreSQL table, external API, form input) actually provides the field.
- [ ] **Repository Query Joins:** Database queries explicitly include the necessary joined tables or foreign keys (e.g., joining `artist_external_ids` when fetching artists for recommendation scoring).
- [ ] **Domain Model Representation:** Domain entities explicitly model the field with strict nullability (`string | null`, not implicit optional omission).
- [ ] **Caller Parameter Passing:** Intermediary service methods and helper functions pass the field down without dropping it during transformation.
- [ ] **Consumer Interpretation:** Consuming functions inspect the field using the intended semantics, distinguishing between `null`, `undefined`, zero (`0`), and empty strings (`""`).
- [ ] **Serialization Parity:** The field survives Next.js Server Action serialization (plain JSON objects; no lost Date objects, Sets, or Maps).
- [ ] **Persistence & Reload:** Data written to the database is correctly re-fetched and displayed following a hard browser refresh.
- [ ] **Absence Handling:** The system handles the complete absence of the field gracefully with neutral fallbacks, never throwing runtime null-pointer exceptions.
- [ ] **Accurate Explanations:** UI labels and match explanations reflect the true calculation inputs rather than boilerplate strings.
- [ ] **Cross-Layer Regression Test:** An automated integration test verifies the entire path from database query through domain model to client output.

---

## 4. Authentication, Authorization & Privacy

Security and privacy boundaries must be enforced at both the database level and application server level. Client-side checks alone are strictly cosmetic.

### Verification Items
- [ ] **Verified Supabase Identity:** User identification relies exclusively on server-verified session identity (`supabase.auth.getUser()`).
- [ ] **No Client-Supplied User IDs:** The server never trusts `userId`, `user_id`, or `accountId` parameters passed from the browser as proof of ownership.
- [ ] **Row Level Security (RLS) Enforced:** Non-public tables have RLS enabled with explicit `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policies tested against a real PostgreSQL instance.
- [ ] **Zero-Client Service Role Isolation:** Ordinary user requests and Server Actions never use `service_role` credentials to bypass RLS. `service_role` is restricted to administrative cron jobs, background workers, and strictly audited migrations.
- [ ] **Negative Security Tests:** Test suites include explicit negative tests (e.g., User B attempting to view, edit, or delete User A's private preferences or connections).
- [ ] **OAuth State-User Binding:** In OAuth flows (e.g. Spotify), the CSRF `state` and PKCE `code_verifier` are cryptographically bound to the initiating user session.
- [ ] **OAuth Callback Rejection:** Callbacks strictly reject state mismatches, expired requests, replay attempts, and sessions where the logged-in user changed during authorization.
- [ ] **Secret Hygiene:** Tokens, encryption keys, and client secrets are never rendered in HTML, sent in client JSON responses, printed to client logs, or committed to Git.
- [ ] **Safe Redirects:** Authentication and callback redirects validate destination URLs against an allowlist, rejecting open redirect vulnerabilities (`//attacker.com`).
- [ ] **Disconnect Resilience:** Account disconnection and deletion succeed even if token decryption fails or external provider APIs are unreachable.
- [ ] **Immediate Deletion Consistency:** The UI does not announce deletion success until the database deletion transaction successfully commits.
- [ ] **Sanitized Error Responses:** Unhandled database exceptions, SQL error messages, and stack traces are sanitized before reaching the browser, displaying generic client-safe messages while logging detailed diagnostics on the server.

---

## 5. Canonical Identity, Deduplication & Provenance

Encore's core value proposition depends on conservative, accurate live-music entity resolution. False-positive identity merges destroy recommendation trust.

### Verification Items
- [ ] **Authoritative ID Precedence:** Entity resolution matches artists and venues through canonical UUIDs or trusted external provider IDs (e.g. Spotify Artist URI, Ticketmaster Venue ID), never by normalized name alone.
- [ ] **Same-Name Disambiguation:** Two distinct artists sharing the same name (e.g. "Rome", "Ghost", "Genesis") remain separate entities with distinct canonical IDs.
- [ ] **Unresolved Identities Remain Unresolved:** If an artist cannot be disambiguated with high confidence, the candidate is routed to `needs_review` or flagged as unresolved. It is never coerced into an existing record.
- [ ] **Free-Text Safety:** User search input or free-text entry never silently creates canonical artist records in public tables without explicit curation/ingestion pipelines.
- [ ] **Provider Identity Durability:** External provider IDs (e.g. `spotify_artist_id`) survive preference updates, edits, catalog syncs, and page reloads.
- [ ] **Preservation of Existing Identity:** When updating a preference via catalog search, existing verified external provider IDs are preserved unless explicitly overridden by a valid, trusted mapping.
- [ ] **Archived Entity Isolation:** Archiving or deleting a canonical artist does not corrupt user preference tables or cause foreign-key cascade failures. Archived preferences never match new canonical artists.
- [ ] **Database Uniqueness Invariants:** Uniqueness constraints (e.g. `UNIQUE (user_id, canonical_artist_id)`, `UNIQUE (spotify_account_id)`) remain valid and enforced during partial failures.
- [ ] **Exact Record Mutation:** Updating a preference modifies the specific record identified by primary key, never a different record that shares an artist name.
- [ ] **Memory & Postgres Equivalence:** In-memory repository mocks used in unit tests exhibit identical identity resolution and error-handling behavior to the PostgreSQL repository.

---

## 6. Missing Data & External-Source Integrity

> [!IMPORTANT]
> **Never turn unknown data into fabricated certainty.**  
> When external sources or user profiles omit a field, the application must score or present it neutrally, clearly acknowledging the missing information.

### Verification Items
- [ ] **No Free-Admission Fabrication:** A ticket price of `$0` or missing price is **not** automatically treated as free admission. Only events with verified free status (`eventKind === 'free_event'`) receive a free-event score.
- [ ] **Foreign Currency Neutrality:** Prices listed in non-USD currencies (e.g. CAD, EUR, GBP) or missing currency codes yield neutral affordability scores (`50`), not direct numeric comparisons against USD budgets.
- [ ] **Missing Budget Neutrality:** If a user profile has not configured ticket price thresholds, price affordability returns a neutral score (`50`) with an explicit explanatory reason.
- [ ] **Missing Start Times:** An event with a date but no confirmed start time (`startTimePrecision === 'date_only'`) must not be converted to 00:00:00 local time or excluded as past during its event day.
- [ ] **Missing Venue Coordinates:** Missing venue coordinates or unconfigured user locations yield a neutral distance score (`50`), never defaulting to an arbitrary city (such as Denver).
- [ ] **Database Query Failures vs. Empty States:** A failed database read renders a visible error state. It must never silently render a "No upcoming events found" empty state.
- [ ] **Missing Source Attribution:** Ingested events without verified primary sources must never be labeled as "Verified Source" in UI badges.

---

## 7. Dates, Time Zones & Money

Concert discovery is inherently time-sensitive and geographically distributed. Date and currency handling must be mathematically rigorous.

### Verification Items
- [ ] **No Naive UTC String Slicing:** Never use `toISOString().slice(0, 10)` to determine if an event is today or past. Local dates must be computed in the venue's validated IANA timezone.
- [ ] **Validated IANA Timezones:** Venue timezones must be validated against recognized IANA identifiers (e.g. `America/New_York`, `America/Denver`, `Europe/London`). Malformed timezones must fall back safely and deterministically to UTC.
- [ ] **Event-Day Eligibility for Date-Only Events:** Events with `startTimePrecision === 'date_only'` remain eligible for recommendation throughout their local calendar date in the venue's timezone.
- [ ] **Direct Instant Comparisons:** Events with confirmed instant precision (`startTimePrecision === 'instant'`) compare the confirmed start instant directly against the reference instant (`startsAt < referenceInstant`).
- [ ] **Deterministic Reference Instant Support:** All time-sensitive calculation functions accept an optional `referenceInstant` parameter (`Date`) so unit and integration tests run deterministically regardless of the execution clock.
- [ ] **Daylight Saving Time (DST) Transitions:** Calculations around 23:00–01:00 local time handle spring-forward and fall-back DST transitions without shifting the event's calendar date.
- [ ] **User-Local vs. Event-Local Clarity:** UI components clearly distinguish between the event's local start time at the venue and the viewer's local time if they differ.
- [ ] **No Uncontrolled Currency Conversions:** The application never converts foreign currencies using hardcoded or assumed exchange rates. Without a live, trusted exchange rate provider, cross-currency comparisons are scored neutrally.

---

## 8. Recommendation Scoring Integrity

Encore's recommendation engine is deterministic, explainable, and transparent—not a black-box AI model or uncalibrated probability score.

### Verification Items
- [ ] **Strictly Bounded Scores:** All factor scores and composite match scores must be bounded within the documented range: `[0, 100]`.
- [ ] **Deterministic Calculation:** Given identical event data and user preferences, the scoring engine produces identical scores, ranks, and match reasons every time.
- [ ] **Strict Preset Validation:** Presets are validated against an allowlist (`balanced`, `artist_first`, `nearby`, `value`) with own-property checks resisting prototype pollution (`toString`, `__proto__`). Unrecognized presets throw `InvalidScoringPresetError`.
- [ ] **Weight Sum Invariant:** Factor weights for every preset must sum exactly to 100%.
- [ ] **Manual Preference Precedence:** Explicit manual user preferences (`user_artist_preferences`) strictly override external signals (e.g. Spotify top artists).
- [ ] **Inviolable Not-Interested Suppression:** An artist marked `dislike` / "Not Interested" suppresses the concert (`score: 0`, `isSuppressed: true`). Soft weight tuning cannot unsuppress it.
- [ ] **Multi-Artist Lineup Policy:**
  - A Favorite headliner overrides disliked support acts (the concert scores 100 and is not suppressed).
  - A Disliked headliner suppresses the concert regardless of support acts.
  - A Disliked support act under a non-favorite headliner suppresses the concert.
- [ ] **Unmarked Artists Scored Neutrally:** Unmarked/unfamiliar artists receive a neutral discovery score (~40), never treated as disliked.
- [ ] **Explainable Match Reasons:** Every factor contributes human-readable explanation strings matching the actual numerical factor inputs.
- [ ] **Deterministic Sorting & Tie-Breaking:** Event ranking applies deterministic tie-breakers (e.g. composite score desc, headliner score desc, local start date asc, canonical event ID asc).
- [ ] **Full Pipeline Coverage:** Unit and integration tests cover the entire recommendation pipeline from catalog events to sorted recommendations, not just isolated factor helpers.

---

## 9. Ingestion & Database Integrity

Ingestion pipelines and database migrations must maintain data provenance and operational safety.

### Verification Items
- [ ] **Immutable Observations:** Raw ingest payloads (`raw_ingests`) and parsed event candidates (`event_candidates`) are immutable audit records. Never update observation rows in place.
- [ ] **Field-Level Provenance:** Every canonical field update records its source in `event_field_evidence`. Higher-confidence sources are never overwritten by lower-confidence sources without an explicit merge rule.
- [ ] **Atomic Canonicalization:** Database mutations execute inside atomic PostgreSQL transactions via the canonicalization stored procedure. Zero orphaned records on partial failure.
- [ ] **Idempotent Replay:** Re-ingesting the exact same source payload produces zero duplicate canonical events, venues, or artists, and reports accurate reused/skipped counters.
- [ ] **Interrupted Ingestion Safety:** Ingestion pipelines handle mid-run crashes or network disconnects safely, allowing subsequent runs to resume without corrupting state.
- [ ] **Read-Only Dry Runs:** Dry-run modes never perform write operations against database tables.
- [ ] **Database Destination Guard:** Ingestion scripts and migrations verify the target database URL to prevent accidental writes to production or remote databases during local testing.
- [ ] **Migration Forward-Compatibility:** Migrations include safety checks (`IF NOT EXISTS`, safe defaults) and never drop production tables or columns without an approved deprecation phase.

---

## 10. Synthetic Previews & Development Tooling

Mock fixtures and preview tools are essential for development but must never compromise production data integrity.

### Verification Items
- [ ] **Explicit Fixture Labeling:** Synthetic fixture responses are explicitly labeled in their response metadata (`isSyntheticDemo: true`).
- [ ] **Multi-Layer Environment Gating:** Development preview routes (e.g. `/discover/scoring-preview`, synthetic Spotify taste preview) are protected by server-side guards (`NODE_ENV !== 'production'`).
- [ ] **Production Route 404:** In production environments, dev-only preview pages invoke Next.js `notFound()`, returning a standard 404 response.
- [ ] **Server Action Gating:** Server actions supporting preview views independently verify environment authorization and reject calls in production.
- [ ] **Controlled CI Execution:** If production-build Next.js runs in CI for Playwright tests, preview features require explicit opt-in flags (e.g., `CI === 'true' && ENABLE_RECOMMENDATION_DEV_PREVIEW === 'true'`).
- [ ] **No Silent Fallback to Fixtures:** If a live database query or live API call fails, the application must **not** silently fall back to synthetic fixtures. It must report the real error.
- [ ] **Isolated Client State:** React state for simulated selections or preview preferences is kept strictly separate from persisted user data.
- [ ] **Authoritative UI Badging:** The UI renders prominent badges distinguishing between synthetic demo data and live database data based on server response metadata.

---

## 11. External API Integration Reliability

Interactions with external APIs (Spotify, Ticketmaster, future aggregators) must be resilient, rate-limited, and compliant.

### Verification Items
- [ ] **Strict Response Validation:** External API responses are validated against runtime Zod schemas before being processed by domain logic.
- [ ] **HTTP Error Discrimination:** Client adapters distinguish between 401 (Unauthorized), 403 (Forbidden), 429 (Rate Limited), and 5xx (Server Error).
- [ ] **Rate Limiting & Backoff:** API clients enforce conservative inter-request spacing and respect HTTP `Retry-After` headers on 429 responses.
- [ ] **No Live API Calls in CI:** CI workflows and automated unit/integration tests never make live HTTP requests to external services. All external APIs must use deterministic mocks or recorded fixtures.
- [ ] **Credential Lifecycle Handling:** Token expiration triggers automatic refresh. If refresh fails due to temporary network issues, the connection is not prematurely marked expired or revoked.
- [ ] **Reauthorization Detection:** Permanent token revocation (e.g. user revoked Spotify app permissions) flags the connection for reauthorization without crashing the page.
- [ ] **Account Conflict Prevention:** Linking a third-party account (e.g. Spotify) enforces a strict 1-to-1 relationship with Encore accounts (`UNIQUE(spotify_account_id)`). Conflicts are reported clearly.

---

## 12. User Interface & Browser Behavior

A rendered component does not prove that a user workflow succeeds. UI interactions must be verified across their complete operational lifecycle.

### Verification Items
- [ ] **Complete Workflow Verification:** Test scenarios verify the full lifecycle:
  `Sign In → Add Item → Refresh Browser & Confirm Persistence → Edit Item → Delete Item → Sign Out → Confirm Private Isolation`.
- [ ] **Robust Selectors:** E2E tests use durable `data-testid` attributes or semantic accessible roles, avoiding brittle CSS class selectors or text-substring matches.
- [ ] **Loading, Empty, and Error States:** Components render dedicated states for data loading, empty results, operational errors, and success feedback.
- [ ] **No Swallowed Errors:** Server action errors and mutation failures are surfaced clearly to the user, not silently caught and ignored in client hooks.
- [ ] **Optimistic Update Rollback:** If an optimistic UI update fails on the server, client state rolls back to the previous authoritative server state and displays an error message.
- [ ] **Double-Submission Prevention:** Action buttons disable during pending mutations, preventing accidental duplicate records or conflicting requests.
- [ ] **Responsive & Accessible Design:** Interactive elements are keyboard-navigable, have accessible names/labels, and function correctly on standard mobile viewports (390px width).
- [ ] **Functional Interactive Controls:** Every button, toggle, dropdown, or modal advertised on the page performs its expected action when clicked.

---

## 13. Testing & CI Requirements

Encore enforces a four-tier testing hierarchy. Each tier has a specific scope and must not be mocked out or substituted.

```text
┌─────────────────────────────────────────────────────────┐
│               1. Unit Tests (Vitest)                    │
│   Pure domain logic, scoring factors, validation, zod   │
├─────────────────────────────────────────────────────────┤
│         2. PostgreSQL Integration Tests (Vitest)        │
│   Real local Supabase: RLS policies, migrations, joins  │
├─────────────────────────────────────────────────────────┤
│           3. Browser E2E Tests (Playwright)             │
│   Real Next.js app + headless Chromium: user workflows  │
├─────────────────────────────────────────────────────────┤
│           4. GitHub Actions CI Pipeline                 │
│   Reproducible Ubuntu-24.04 runner: all checks green    │
└─────────────────────────────────────────────────────────┘
```

### Verification Items
- [ ] **Unit Tests (`npm test`):**
  - Verify pure logic, edge cases, boundary conditions, and invalid inputs.
  - Zero network or database dependencies. Run in under 10 seconds.
- [ ] **PostgreSQL Integration Tests (`npm run test:integration`):**
  - Execute against an isolated local Supabase instance running migrations.
  - Validate real RLS behavior across authenticated and anonymous roles.
  - Validate foreign-key cascades, uniqueness constraints, and complex SQL joins.
  - **Invariant:** Never use an in-memory mock repository as a substitute for a required database integration test.
- [ ] **Browser E2E Tests (`npm run test:e2e`):**
  - Execute using Playwright against the Next.js application.
  - Validate end-to-end browser interactions, cookies, navigation, and rendering.
  - In CI, ensure required database-backed tests run against local Supabase rather than skipping.
- [ ] **GitHub Actions Verification:**
  - Verify that the workflow on GitHub Actions passes completely green on the latest commit.
  - Confirm Supabase CLI initializes credentials correctly before tests run.
  - Confirm post-build TypeScript typechecks pass without regression.
- [ ] **No Fabricated Verification:**
  - Never report that a test passed when it was skipped.
  - Never report CI results from an older commit as proof for current changes.
  - Record exact counts: Passed, Failed, Skipped.

---

## 14. Historical Regression Checklist

The following table summarizes recurring failures identified across Encore PRs #6–#11 and the mandatory checks required to prevent them.

| # | Historical Failure Encountered | Root Cause | Mandatory Preventive Check |
|---|---|---|---|
| 1 | OAuth state not bound to initiating user (PR #10) | State parameter checked without verifying session user ID | Verify OAuth handshake cookie binds `state`, `code_verifier`, and `userId`. Test callback with mismatched user session. |
| 2 | Spotify artist ID lost after browser reload (PR #10) | ID stored only in React state; omitted from database mutation | Test add → reload → verify provider ID persisted in database and returned by repository. |
| 3 | Same-name artist collision (PR #9, #10) | Resolved by normalized name instead of canonical/provider ID | Test two distinct artists with identical names; confirm both maintain separate preferences and scores. |
| 4 | Archived artist preference collision (PR #9) | Deleting canonical artist broke preference uniqueness constraints | Test archiving/deleting canonical artist; verify existing preferences are not erased and new artists do not collide. |
| 5 | Disconnect without token deletion (PR #10) | Disconnect failed early if encryption key was unavailable | Test disconnect route without encryption secret; verify database connection record is permanently deleted. |
| 6 | Synthetic preview data mistaken for live data (PR #10, #11) | UI rendered fixtures without checking server response source | Inspect `isSyntheticDemo` response metadata; assert distinct UI badge renders for synthetic vs. live data. |
| 7 | CI silently skipped authenticated Playwright test (PR #9, #10) | Test skipped when Supabase env vars were unset in CI | Configure CI workflow to start Supabase before Playwright; test must fail-closed if database is unavailable. |
| 8 | Event date mismatch across timezones (PR #11) | Naive `toISOString().slice(0, 10)` checked UTC instead of local date | Test event day boundaries across Mountain, Pacific, Eastern, and Japan timezones with date-only events. |
| 9 | Incompatible currency scored as USD (PR #11) | $35 CAD compared directly against $50 USD budget | Test CAD/EUR ticket price against USD budget; assert neutral affordability score (50) is returned. |
| 10 | $0 ticket assumed to be free admission (PR #11) | Checked `minPrice === 0` without verifying `eventKind` | Test $0 price with `eventKind !== 'free_event'`; assert neutral score (50) rather than 100. |
| 11 | Catalog repository omitted joined provider IDs (PR #11) | Domain interface had field, but PostgREST query didn't join it | Trace data flow from SQL query to domain summary; test that `spotifyArtistId` is populated in returned events. |
| 12 | Raw database error leaked to UI (PR #11) | Server action caught exception and passed `.message` to client | Verify server action catches database errors, logs details on server, and returns sanitized generic message to client. |
| 13 | Favorite artist outranked beyond radius (PR #11) | Distance decay slope was steeper for favorite elasticity | Test favorite artist beyond radius; assert score exceeds non-favorite artist at identical distance. |
| 14 | Ingestion replay counters misleading (PR #7, #8) | Skipped/reused counters did not track partial duplicates | Test re-running identical ingestion payload; verify created=0, reused=N, skipped=0. |

---

## 15. Mandatory Pre-Review Self-Audit Procedure

Before requesting peer review, external review, or user signoff, the implementing agent must execute the following 14-step self-audit:

```text
 1. Run git diff against the intended base branch (e.g., origin/main).
 2. Inspect every modified and newly created production file line by line.
 3. Trace data flow: confirm callers supply all fields required by touched functions.
 4. Verify security: confirm no service_role leaks, no unsanitized errors, no exposed tokens.
 5. Verify database integrity: confirm RLS policies, foreign keys, and atomic mutations.
 6. Verify missing-data behavior: confirm unknown prices/times/locations score neutrally.
 7. Verify entity resolution: confirm canonical ID precedence and same-name disambiguation.
 8. Verify UI state: confirm loading, error, empty states, and optimistic update rollbacks.
 9. Run code quality checks: Prettier (format:check), ESLint (lint), TypeScript (typecheck).
10. Run unit test suite: npm test (verify 100% pass rate).
11. Run PostgreSQL integration suite: npm run test:integration (against local Supabase).
12. Run browser E2E suite: npm run test:e2e (verify browser interactions).
13. Push branch and inspect actual GitHub Actions CI run for the latest commit SHA.
14. Complete the Standardized PR Handoff Report with exact test numbers and known limitations.
```

---

## 16. Definition of Done — Before External Code Review

A pull request is **Done** and ready for independent code review when and only when:

- [ ] **Scope Fidelity:** The implementation strictly satisfies the active phase specification without unauthorized scope creep or premature future-phase scaffolding.
- [ ] **Engineering Invariants Preserved:** All invariants in `AGENTS.md` (canonical identity, immutable observations, field provenance, atomic transactions, RLS, no test weakening) are intact.
- [ ] **Cross-Layer Data Traced:** Every newly introduced or modified field is populated at the source, mapped by the repository, passed by the service, and consumed by the UI.
- [ ] **Required Tests Present:** Unit tests, PostgreSQL integration tests, and Playwright E2E tests cover both happy paths and negative boundary conditions.
- [ ] **Zero Regressions:** All existing test suites pass without deletion of assertions or silencing of constraints.
- [ ] **Clean Code Quality:**
  - `npm run format:check` passes with zero formatting errors.
  - `npm run lint` passes with zero errors and zero warnings.
  - `npm run typecheck` passes with zero TypeScript compiler errors.
- [ ] **Clean Production Build:** `npm run build` compiles with zero Next.js build errors or static generation warnings.
- [ ] **Green GitHub Actions CI:** The CI workflow on the remote repository succeeds on the exact commit submitted for review.
- [ ] **Self-Audit Complete:** The implementing agent has completed the 14-step self-audit and confirmed no new bugs were introduced during remediation.
- [ ] **Standardized Handoff Report Filed:** The standardized handoff report template is completed in full and delivered in the PR description or handoff comment.

---

## 17. Standardized PR Handoff Report Template

Copy and paste the template below into your pull request description or handoff summary:

````markdown
# Pull Request Handoff Report

## PR Identity
- **PR Number & URL:** [PR #XX](https://github.com/juko04/Encore-concert-finder/pull/XX)
- **Branch:** `feature/...`
- **Base Branch:** `main`
- **Latest Commit SHA:** `<commit-sha>`

## Implementation Summary
- **Key Changes:** <bulleted list of implemented capabilities>
- **Architectural Alignment:** <reference to active phase spec and ADRs>
- **Files Created / Modified:** <summary of key files touched>
- **Database Migrations:** <migration files added, or "None">

## Security & Data Integrity
- **Authentication / Authorization:** <verified Supabase session, ownership checks>
- **Row Level Security (RLS):** <policies verified, negative access tests passing>
- **Identity & Provenance:** <canonical ID matching, external provider preservation>
- **Secrets & Error Sanitization:** <no tokens exposed, sanitized error messages>

## Cross-Layer Verification
- **Data Paths Traced:** <trace from DB query -> domain model -> server action -> component>
- **Boundary & Edge Cases Covered:** <missing data, foreign currency, local timezone, same-name artists>
- **Synthetic vs. Live Isolation:** <how preview fixtures are isolated from production>

## Automated Verification Results

| Check | Command | Result | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|---|
| **Code Formatting** | `npm run format:check` | PASS / FAIL | | | | Prettier |
| **Linting** | `npm run lint` | PASS / FAIL | | | | ESLint (0 warnings) |
| **Typecheck** | `npm run typecheck` | PASS / FAIL | | | | Strict TypeScript |
| **Unit Tests** | `npm test` | PASS / FAIL | | | | Vitest in-memory |
| **Integration Tests** | `npm run test:integration` | PASS / FAIL | | | | Real PostgreSQL / RLS |
| **Browser E2E Tests** | `npm run test:e2e` | PASS / FAIL | | | | Playwright Chromium |
| **Production Build** | `npm run build` | PASS / FAIL | | | | Next.js output |
| **GitHub Actions CI** | Push to branch | PASS / FAIL | | | | [Run URL](https://...) |

## Self-Audit Findings & Remediations
- **Issues Discovered During Self-Audit:** <issues caught and resolved before review>
- **Remediations Applied:** <how those issues were fixed>
- **Remaining Known Limitations:** <any non-blocking edge cases or deferred items>
- **Non-Blocking Debt Incurred:** <items logged to docs/project/non-blocking-debt.md>

## Review & Merge Readiness
- **Ready for Independent Code Review:** Yes / No
- **Merge Blockers:** None
- **Next Immediate Action:** <await independent review / peer inspection>
````
