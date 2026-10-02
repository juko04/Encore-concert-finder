# Phase 0 — Repository and Foundations Implementation Specification

## Status

Completed and review-ready. This specification is the persistent source of truth for Phase 0.

## Objective

Create a reproducible, secure, testable Next.js foundation for Encore without
starting product features or external event integrations. The result must support
safe Phase 1 event-inventory implementation and review by agents without relying on
prior chat history.

## Relevant architectural context

- Encore is a personalized concert, festival, and live-music discovery application,
  not a generic event calendar.
- The selected stack is Next.js App Router, TypeScript, Tailwind CSS, PostgreSQL via
  Supabase, and Supabase Auth.
- The first delivery format is a responsive PWA. Phase 0 establishes its installable
  shell; offline behavior is deferred to hardening.
- Future event acquisition uses APIs plus permitted official public sources, but no
  event acquisition begins in this phase.
- Source-specific details must remain behind common adapter interfaces. Shared domain
  types must not depend on database-row or UI representations.
- Supabase Auth owns identity. Product profile data belongs in `public.profiles`,
  keyed to `auth.users`, and user-private tables require RLS.
- Event instants will use `timestamptz` and retain IANA time zones when event modeling
  begins. No event database tables are part of this phase.

## Scope

- Root-level Next.js App Router, TypeScript, and Tailwind scaffold, preserving all
  existing repository documentation.
- Responsive minimal landing/smoke page only.
- PWA shell: `app/manifest.ts`, application icons, theme metadata, and mobile viewport
  configuration.
- Common TypeScript contracts for source adapters and their source/candidate payloads.
- Supabase CLI local-development structure and one profile/RLS migration.
- Browser, server, and server-only admin Supabase client factories.
- Environment-variable example, secret isolation, and lazy runtime validation.
- Formatting, linting, type checking, unit tests, one browser smoke test, and
  pull-request CI.
- Deterministic local fixtures for tests/dev preview; fixtures must not come from live
  sources.

## Explicit exclusions

- Ticketmaster, Spotify, and every other external API integration.
- Any event ingestion, scheduled job, queue, crawler, scraper, Cheerio parser, source
  adapter implementation, or live-network request.
- Canonical event, artist, venue, ticket, raw-ingest, candidate persistence, entity
  resolution, deduplication, price history, or source-registry database tables.
- Recommendation calculation, preference UI, explainability UI, authentication UI,
  Spotify OAuth, festival features, alerts, notifications, maps, and watchlists.
- Service-worker caching, offline behavior, push notifications, and email/newsletter
  ingestion.

Playwright is permitted only for testing the Encore web application; it must not be
used for source acquisition in Phase 0.

## Implementation checklist

- [x] Add `package.json`, lockfile, TypeScript config, Next.js config, Tailwind setup,
  ESLint setup, Prettier setup, and `.nvmrc` pinning Node 24 LTS.
- [x] Use npm and commit `package-lock.json`. Do not run a generator destructively in
  the non-empty repository root; preserve all documentation files.
- [x] Add `app/layout.tsx`, `app/page.tsx`, `app/manifest.ts`, required icons, and
  global Tailwind styles. Keep the page intentionally minimal and responsive.
- [x] Add strict, database-independent domain contracts: `SourceType`, `CrawlContext`,
  `RawIngest`, `EventCandidate`, source provenance, and `EventSourceAdapter`.
- [x] Add a unit test using an in-memory fake adapter to demonstrate the common
  contract without a real source, HTTP fetch, or parser.
- [x] Run `supabase init` and commit `supabase/config.toml`.
- [x] Add one timestamped migration that creates `public.profiles` with an `id`
  foreign key to `auth.users(id)` and cascade deletion, enables RLS, and defines
  own-row select, insert, and update policies. Do not add an automatic profile trigger
  or product inventory schema in this phase.
- [x] Add Supabase browser/server/admin factory modules. The admin module must be
  server-only and must never be imported by browser code.
- [x] Add `.env.example`, keep real `.env*` files ignored, and validate environment
  variables only when the corresponding client factory is called.
- [x] Add deterministic fixtures under `tests/fixtures/` or `lib/dev/`; do not seed
  invented canonical data into Supabase.
- [x] Add Vitest unit-test setup and a single Playwright test that verifies the landing
  page loads.
- [x] Add GitHub Actions PR CI for formatting, linting, type checking, unit tests,
  browser smoke test, production build, and migration reset.
- [x] Update `AI_HANDOFF.md` with actual ownership, branch, work completed, validation,
  and outstanding issues when implementation begins and ends.

## Intended repository shape

```text
app/
  layout.tsx
  manifest.ts
  page.tsx
components/
  foundation/
lib/
  domain/
    event-candidate.ts
    source.ts
  env/
    public.ts
    server.ts
  supabase/
    admin.ts
    browser.ts
    server.ts
tests/
  e2e/
  fixtures/
  unit/
supabase/
  config.toml
  migrations/
  seed.sql
.github/workflows/
  ci.yml
```

The exact filenames may vary when they preserve these boundaries. Do not create
future product directories merely as empty placeholders.

## Dependencies

Use current compatible versions, captured by `package-lock.json` rather than manually
pinned speculative versions.

### Runtime dependencies

- `next`, `react`, `react-dom`
- `@supabase/supabase-js`, `@supabase/ssr`
- `zod`

### Development dependencies

- `typescript`, `eslint`, the current Next.js ESLint configuration
- `prettier`, `eslint-config-prettier`, `prettier-plugin-tailwindcss`
- `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`,
  `@testing-library/user-event`, `@vitest/coverage-v8`
- `@playwright/test`
- `supabase`

Do not add a PWA plugin, ORM, scraping library, Spotify SDK, Ticketmaster client, or
job/queue dependency. Next.js App Router provides the manifest capability needed for
this phase.

## Environment-variable changes

Create `.env.example` with blank values only:

```dotenv
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- Only `NEXT_PUBLIC_*` variables may be available to browser code.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and reserved for trusted future jobs or
  administration; it must not be used in browser code.
- Do not add Spotify, Ticketmaster, crawler, notification, or email credentials.
- A clean clone must be able to run formatting, linting, type checking, tests, and
  production build without real cloud credentials; Supabase configuration must be
  parsed lazily by the corresponding client module.

## Database and API changes

Database change: one `public.profiles` migration only. It establishes the private-user
data security boundary, but introduces no product feature or API route.

No API routes, server actions, event tables, external API clients, or authentication
screens are authorized in Phase 0.

## Migration requirements

- Use the Supabase CLI convention: `supabase/migrations/`.
- Migration must be reproducible from an empty local Supabase database.
- Commit `supabase/config.toml` and the migration; never commit local credentials.
- `supabase db reset` must apply the migration successfully.
- Do not link, reset, or modify a production Supabase project while validating Phase 0.

## Testing requirements

- Unit test the source-adapter contract with deterministic in-memory data.
- Add a browser smoke test for the landing page.
- Configure Vitest for one-shot CI execution and optional V8 coverage.
- Keep tests deterministic and free of live-network calls.
- Validate the migration against the local Supabase stack.

## CI requirements

GitHub Actions must run on pull requests using Node 24 and npm caching:

- `npm ci`
- formatting check
- lint
- typecheck
- unit tests
- Playwright Chromium smoke test
- production build
- local Supabase startup and migration reset

Install Playwright's required Chromium/browser dependencies in the browser-test job.
Keep live-source checks out of required PR CI.

## Completion commands

The following must pass before Phase 0 is ready for review:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run db:start
npm run db:reset
```

`db:start` and `db:reset` require a Docker-compatible local container runtime. Stop
the local stack after validation if it is not otherwise needed.

## Definition of done

- The repository has the described Next.js, TypeScript, Tailwind, PWA-shell,
  Supabase, testing, and CI foundations.
- A clean clone can reproduce dependencies and pass the applicable checks without
  secrets or live external-event access.
- The only database schema is the secured profile boundary; no Phase 1 inventory work
  is present.
- Shared adapter/domain contracts are typed, tested, and database-independent.
- No secrets are committed, and no server-only secret can be imported into browser
  code.
- `AI_HANDOFF.md` accurately records the implementation branch, owner, validation,
  and remaining work.
- The implementation stays within the exclusions above.

## Known risks and open questions

- The exact geographic launch region remains undecided.
- Heavier crawler worker runtime, raw-ingest retention, initial direct-source adapters,
  and notification delivery remain deferred decisions.
- Local Supabase validation requires Docker-compatible tooling, which must be available
  both locally and in the CI database job.
- The initial phase intentionally has no login UI or profile-creation trigger; a later
  feature phase must define the user-onboarding/profile lifecycle before it is exposed.

## Decisions made during Phase 0 planning

- Use Node 24 LTS and npm with a committed lockfile.
- Use native Next.js App Router manifest support; defer service-worker caching and
  offline behavior.
- Use `public.profiles` plus RLS as the initial Supabase migration, rather than a
  duplicate application `users` identity table.
- Use `timestamptz` plus IANA time zones when event persistence begins.
- Keep only interface-level source foundation types; do not start actual ingestion.
- Use the standard Supabase CLI `supabase/` directory for committed configuration and
  migrations.

## Approved deviations

None. Any deviation from this specification must be recorded here before implementation
continues, along with its rationale and any necessary update to broader architecture
documents.
