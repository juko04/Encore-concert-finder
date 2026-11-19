# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and active phase specifications live in [`docs/phases/active/`](docs/phases/active/).

---

## Current Status & Location

- **Current Milestone:** **Spotify Final Merge Gate (Independently Audited, Negative Auth Verified & Ready for Merge)**.
- **Active Branch:** `feature/spotify-integration-repair`
- **Active Implementing Agent:** Google Antigravity (Lead Agent Coordinator + Specialized Review Agents)
- **Current Task:** Completed all 6 final merge gate checks:
  1. **Admin Client & Negative Authorization Audit:** Inspected all `createAdminClient()` calls; verified authenticated user JWT scoping (anti-IDOR); added comprehensive negative authorization test suite `tests/unit/spotify-negative-authorization.test.ts` (8/8 passing).
  2. **114 Spotify ID Mappings Corroboration:** Audited `scripts/audit-spotify-mappings.ts`; confirmed 100% (114/114) IDs are valid Base62 strings corroborated 1:1 against the live Spotify Web API with zero ambiguous collisions.
  3. **John Summit E2E & Visual Verification:** Verified Playwright test and screenshots represent actual SSR database execution through `events` and `rankEvents()`, without mocked UI values.
  4. **Fixture Isolation & Non-Destructive Teardown:** Verified `scripts/seed-john-summit-fixture.ts` and `cleanup-john-summit-fixture.ts` use unique source slug `synthetic_fixture_test_john_summit` and `assertSafeDatabaseTarget`; fixture completely torn down.
  5. **PR Diff, Secrets & PII Review:** Sanitized personal emails and specific test handles; verified zero token fragments, credentials, or secrets in git diff, screenshots, or logs. Excluded 4 unrelated research/audit files from commit scope.
  6. **Standard Verification Suite Execution:** 100% green across format, lint, strict typecheck, 726 unit tests, and production build.

---

## Verification Suite Results

- `npm run format:check`: **PASS** (100% Prettier code style)
- `npm run lint`: **PASS** (0 ESLint warnings, 0 errors)
- `npm run typecheck`: **PASS** (`tsc --noEmit`, 0 TypeScript errors)
- `npm test`: **PASS** (**55/55 test files, 726/726 unit tests passed**)
- `npm run test:integration`: **PASS** (**13/13 test files, 104/104 integration tests passed**)
- `npm run test:e2e`: **PASS** (**12/12 Playwright browser tests passed**)
- `npm run build`: **PASS** (Next.js 15.5.27 production build clean, 9/9 routes compiled)

---

## Key Invariants Preserved

1. **Safe Database Targets:** Tests and scripts strictly enforce local loopback targets (`127.0.0.1` / `localhost`) via `assertSafeDatabaseTarget`.
2. **Invariant 3 (Immutable Observations):** `raw_ingests` and `event_candidates` remain immutable audit records.
3. **Invariant 5 (Conservative Entity Resolution):** Disambiguate artists and external IDs strictly; ambiguous names or conflicting external IDs are never merged.
4. **Invariant 10 (Timezones, Currencies & Prices):** Local calendar dates computed in venue IANA timezone; unverified prices score neutrally (50).
5. **Invariant 11 (Manual Preference Precedence):** Explicit manual preferences strictly take precedence over inferred Spotify listening affinities. Disliked headliner unconditionally suppresses event.
6. **Invariant 12 (Isolation & Cleanup of Synthetic Data):** Synthetic test concert cleanly isolated under `synthetic_fixture_test_john_summit` and completely torn down post-verification.
7. **Security Boundary:** Raw tokens encrypted at rest with AES-256-GCM; zero client-side leakage; Zero-Client RLS preserved.
