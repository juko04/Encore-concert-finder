# AI Handoff

Use this file only for the **current active handoff** between contributors/agents. Replace its contents when a new major task begins. Durable product decisions belong in `docs/12-decisions.md` or another specification document.

## Current phase

Phase 0 — Repository and foundations

## Current task

Phase 0 implementation complete and ready for review.

## Current phase specification

`docs/PHASE_0_IMPLEMENTATION.md`

## Status

Complete and review-ready — awaiting review by ChatGPT / repository owner before merging to `main`.

## Owner / branch

- Active implementing agent: Antigravity
- Current branch: `chore/bootstrap-foundation`
- Issue/PR: Ready for PR to `main`

## Work completed

- Established Next.js 15 App Router, React 19, TypeScript strict mode, and Tailwind CSS foundations without disturbing existing repository documentation.
- Pinned Node 24 LTS via `.nvmrc` and configured npm scripts and lockfile (`package.json`, `package-lock.json`).
- Built PWA shell with `app/manifest.ts`, responsive mobile viewport metadata in `app/layout.tsx`, and application icons in `public/`.
- Created minimal responsive landing/smoke page in `app/page.tsx` with foundational components in `components/foundation/`.
- Implemented database-independent shared domain contracts in `lib/domain/source.ts` and `lib/domain/event-candidate.ts`:
  - `SourceType`, `AcquisitionMethod`, `SourceProvenance`, `CrawlContext`, `RawIngest`, `EventCandidate`, and `EventSourceAdapter`.
  - First-class support for festival multi-day structure and stage/lineup details.
- Implemented in-memory deterministic fixture adapter (`tests/fixtures/fake-source-adapter.ts`) and sample payload (`tests/fixtures/fake-source-response.json`).
- Configured Supabase CLI local development structure (`supabase/config.toml`, `supabase/seed.sql`) and created initial timestamped migration `supabase/migrations/20261002000000_create_profiles.sql` defining `public.profiles` referencing `auth.users(id)` with cascade deletion and own-row RLS policies (SELECT, INSERT, UPDATE).
- Implemented Supabase client factories (`lib/supabase/browser.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`) with strict server-only protection for admin client.
- Implemented lazy Zod environment variable validation (`lib/env/public.ts`, `lib/env/server.ts`) and committed clean `.env.example` with blank values only.
- Configured Prettier, ESLint flat config (`eslint.config.mjs`), and Vitest test suite with v8 coverage.
- Added comprehensive unit tests in `tests/unit/` (17 tests covering source adapter contract, lazy env validation, Supabase factories, and foundation components).
- Configured Playwright with Chromium desktop project and added browser smoke test in `tests/e2e/smoke.spec.ts`.
- Configured GitHub Actions CI workflow in `.github/workflows/ci.yml` running format check, lint, typecheck, unit tests, Playwright Chromium smoke test, production build, and local Supabase startup and migration reset.

## Files added or changed

- Application & Components: `app/globals.css`, `app/layout.tsx`, `app/manifest.ts`, `app/page.tsx`, `components/foundation/Container.tsx`, `components/foundation/StatusBadge.tsx`
- Domain: `lib/domain/source.ts`, `lib/domain/event-candidate.ts`
- Environment & Supabase: `lib/env/public.ts`, `lib/env/server.ts`, `lib/supabase/admin.ts`, `lib/supabase/browser.ts`, `lib/supabase/server.ts`, `.env.example`
- Database: `supabase/config.toml`, `supabase/seed.sql`, `supabase/migrations/20261002000000_create_profiles.sql`, `supabase/.gitignore`
- Tests & Fixtures: `vitest.config.ts`, `playwright.config.ts`, `tests/setup.ts`, `tests/fixtures/fake-source-adapter.ts`, `tests/fixtures/fake-source-response.json`, `tests/unit/source-adapter.test.ts`, `tests/unit/env.test.ts`, `tests/unit/supabase.test.ts`, `tests/unit/components.test.tsx`, `tests/e2e/smoke.spec.ts`
- Tooling & CI: `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`, `.gitignore`, `.github/workflows/ci.yml`
- Documentation: `docs/PHASE_0_IMPLEMENTATION.md`, `AI_HANDOFF.md`

## Validation performed

- [x] `npm ci`: passed without errors (560 packages installed matching lockfile)
- [x] `npm run format:check`: passed (all matched files formatted cleanly)
- [x] `npm run lint`: passed (zero ESLint errors or warnings)
- [x] `npm run typecheck`: passed (zero TypeScript compiler errors with strict mode enabled)
- [x] `npm test`: passed (4 test files, 17 tests passed)
- [x] `npm run test:coverage`: passed (v8 coverage generated)
- [x] `npm run test:e2e`: passed (Playwright Chromium smoke test verified HTTP 200, title, branding, PWA badges)
- [x] `npm run build`: passed (Next.js production build succeeded with static prerendering of `/`, `/_not-found`, and `/manifest.webmanifest`)
- [x] `npm run db:start`: verified local dependency check (`DockerLifecycleInspectError: docker: command not found`). CI workflow runs `supabase start` and `supabase db reset` in GitHub Actions ubuntu runner.

## Known issues / unresolved decisions

- A local Docker-compatible container runtime (Docker Desktop or Podman) is required to run `npm run db:start` and `npm run db:reset` locally; CI handles this automatically.
- Launch geography, heavier crawler runtime, raw ingest storage retention, and notification provider remain open product decisions for later phases.

## Recommended next step

1. Review by ChatGPT / repository maintainer on branch `chore/bootstrap-foundation`.
2. Open pull request into `main` and confirm GitHub Actions CI passes all jobs.
3. Merge `chore/bootstrap-foundation` into `main`.
4. Proceed to Phase 1 (`feature/ticketmaster-ingestion`) and create `docs/PHASE_1_IMPLEMENTATION.md`.
