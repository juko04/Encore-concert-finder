# AI Handoff

Use this file only for the **current active handoff** between contributors/agents. Replace its contents when a new major task begins. Durable product decisions belong in `docs/12-decisions.md` or another specification document.

## Current phase

Phase 0 — Repository and foundations

## Current task

Phase 0 review remediation complete. All MUST FIX and SHOULD FIX review findings have been resolved and verified.

## Current phase specification

`docs/PHASE_0_IMPLEMENTATION.md`

## Status

Remediation complete and review-ready — awaiting re-review by ChatGPT / repository owner before opening PR and merging to `main`.

## Owner / branch

- Active implementing agent: Antigravity
- Current branch: `chore/bootstrap-foundation`
- Issue/PR: Ready for PR to `main`

## Remediation work completed

1. **Hardened `.env*` Secret Ignoring**:
   - Replaced specific environment file listings in `.gitignore` with generic `.env*` matching in all directories.
   - Added explicit tracking retention for `.env.example` and nested templates (`!.env.example`, `!**/.env.example`).
   - Verified with `git check-ignore` that `.env`, `.env.local`, `.env.production`, `.env.development`, `.env.test`, and `supabase/.env.production` are ignored while `.env.example` remains tracked.
2. **Server-Only Admin Client Boundary Enforced**:
   - Added `import 'server-only';` as the first import in `lib/supabase/admin.ts`.
   - Installed `server-only` package into `package.json` and committed in `package-lock.json`.
   - Added regression test in `tests/unit/supabase.test.ts` to statically and behaviorally verify build-time and runtime protection against importing the admin client into browser/Client Component graphs.
3. **Event-Source Domain Contract Aligned**:
   - Added stable `id` and `acquisitionMethod` to `EventSourceAdapter` contract in `lib/domain/source.ts`.
   - Recorded `AcquisitionMethod` across `CrawlContext`, `RawIngest`, and `SourceProvenance`.
   - Updated `EventSourceAdapter` methods to `fetch(context): Promise<RawIngest[]>` and `parse(rawIngests): Promise<EventCandidate[]>`, enabling multi-record ingestion, pagination, and multi-request flows.
   - Updated `tests/fixtures/fake-source-adapter.ts` and `tests/fixtures/fake-source-response.json` to demonstrate multi-page raw ingestion.
4. **Removed Premature Festival-Specific Domain Modeling**:
   - Removed `FestivalDetails` interface and detailed lineup structures from `lib/domain/event-candidate.ts`.
   - Removed lossy festival fixtures; replaced with a clean multi-day concert residency.
   - Clarified that detailed festival performance and schedule modeling is intentionally deferred to Phase 5, while generic multi-day dates (`startsAt`, `endsAt`) and `isFestival` flags remain supported.
5. **Post-Build TypeScript Validation Verified**:
   - Verified that `npm run typecheck` succeeds both before and after `npm run build`.
   - Added a post-build `npm run typecheck` step to `.github/workflows/ci.yml` to prevent regression of generated route types.
6. **Deterministic Supabase CLI in CI**:
   - Replaced unpinned `supabase/setup-cli@v1` with repository-pinned npm CLI commands (`npm run db:start`, `npm run db:reset`, `npm run db:stop`).
7. **Database-Backed RLS Security Behavior Test**:
   - Created integration test in `tests/integration/profiles-rls.test.ts` (`npm run test:rls`).
   - Verifies with two real authenticated users:
     - User A can insert, read, and update own profile.
     - User B cannot read User A's profile (0 rows returned under SELECT policy).
     - User B cannot update User A's profile (0 rows affected under UPDATE policy).
     - User B cannot insert a profile with User A's ID (rejected by WITH CHECK policy).
     - Unauthenticated requests are denied.
   - Test runs in CI against the containerized Supabase instance, with graceful local explanation when Docker is not present.

## Files added or changed in remediation

- Security & Env: `.gitignore`, `lib/supabase/admin.ts`, `tests/unit/supabase.test.ts`
- Domain Layer: `lib/domain/source.ts`, `lib/domain/event-candidate.ts`
- Fixtures & Tests: `tests/fixtures/fake-source-adapter.ts`, `tests/fixtures/fake-source-response.json`, `tests/unit/source-adapter.test.ts`, `tests/integration/profiles-rls.test.ts`, `tests/setup.ts`, `vitest.config.ts`
- Tooling & CI: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`
- Documentation: `docs/PHASE_0_IMPLEMENTATION.md`, `AI_HANDOFF.md`

## Validation performed

- [x] `git check-ignore -v .env .env.local .env.production .env.development .env.test supabase/.env.production`: all verified ignored
- [x] `git check-ignore .env.example`: verified NOT ignored (exit code 1)
- [x] `npm run format:check`: passed (all code files match Prettier style)
- [x] `npm run lint`: passed (zero ESLint errors or warnings)
- [x] `npm run typecheck`: passed (zero TypeScript errors)
- [x] `npm test`: passed (4 unit test suites, 17 tests passed)
- [x] `npm run test:e2e`: passed (Playwright Chromium smoke test verified landing page)
- [x] `npm run build`: passed (Next.js production build succeeded)
- [x] `npm run typecheck` (post-build): passed (zero TypeScript errors with generated route types present)
- [x] `npm run test:rls`: passed (executes RLS suite; verifies credentials and checks database availability; required in CI)

## Known issues / unresolved decisions

- Local Docker container runtime (Docker Desktop or Podman) is required to run `npm run db:start` / `npm run db:reset` / `npm run test:rls` locally; CI runner automatically provides Docker and executes database startup, reset, and RLS test.
- Launch geography, heavier crawler runtime, raw ingest retention policy, and notification provider remain open product decisions for subsequent phases.

## Recommended next step

1. ChatGPT re-review on branch `chore/bootstrap-foundation`.
2. Open pull request into `main` and verify all CI checks pass.
3. Merge `chore/bootstrap-foundation` into `main`.
4. Proceed to Phase 1 (`feature/ticketmaster-ingestion`).
