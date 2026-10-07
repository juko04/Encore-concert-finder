# Encore (Concert Finder)

> A personalized live-music discovery platform that ranks concerts, festivals, and local events by how worthwhile they are for an individual fan.

Encore combines music taste, venue preferences, price sensitivity, distance, and timing into transparent, explainable recommendations. It is designed to find cheap and spontaneous local shows, identify major artist dates worth traveling for, and understand festival lineups day-by-day.

---

## Quick Navigation for Beginners & Contributors

If you are new to the codebase, start here:

- **New to the concepts?** Read the [Beginner & Conceptual Glossary](docs/learning/glossary.md) for plain-English explanations of entity resolution, canonical events, Supabase, RLS, and more.
- **Looking for documentation?** The [Documentation Map (`docs/index.md`)](docs/index.md) routes you to every architectural and product specification.
- **Want to know current project status?** Check the active [Operational Handoff (`AI_HANDOFF.md`)](AI_HANDOFF.md).
- **Contributing or AI instructions?** Read [Shared Agent Guidelines (`AGENTS.md`)](AGENTS.md) and [Contributing Guide (`CONTRIBUTING.md`)](CONTRIBUTING.md).

---

## Project Status & Completed Milestones

| Milestone | Status | Description |
|---|---|---|
| **Phase 0 — Foundation** | **COMPLETE** | Next.js 15, TypeScript, Tailwind, Supabase RLS, unit/integration CI pipelines. ([Details](docs/phases/completed/PHASE_0_IMPLEMENTATION.md)) |
| **Phase 1 — Canonical Inventory** | **COMPLETE** | Ingestion models, immutable raw observations, entity resolution (artists, venues, events), and field-level provenance in PostgreSQL. ([Details](docs/phases/completed/PHASE_1_IMPLEMENTATION.md)) |
| **Post-Phase 1 Tooling** | **ACTIVE** | Repository organization & AI context optimization. |
| **Encore Project Hub** | **PLANNED** | Interactive documentation, entity inspector, and pipeline visualizer (next milestone). |
| **Phase 2 — Live Ingestion** | **PLANNED** | Live Ticketmaster API ingestion and recommendation scoring scaffolding. |

---

## Where Everything Lives

```text
├── app/                  # Next.js App Router (pages and layouts, e.g. /discover)
├── components/           # Reusable UI components (foundation and catalog)
├── docs/                 # Authoritative project knowledge base (see docs/index.md)
│   ├── product/          # Product vision, user jobs, festivals, future features
│   ├── architecture/     # Data model, ingestion, entity resolution, security
│   ├── phases/           # Completed historical specs and active phase slots
│   ├── decisions/        # Settled architectural decisions and ADRs
│   ├── project/          # Roadmap, agent collaboration, onboarding, acceptance criteria
│   └── learning/         # Beginner glossary and educational materials
├── lib/                  # Core application domain & business logic
│   ├── domain/           # Pure domain types, candidate models, and value objects
│   ├── entity-resolution/# ArtistResolver, VenueResolver, EventMatcher, FieldMerge
│   ├── repositories/     # Catalog, candidate, and raw ingest repository implementations
│   └── supabase/         # Browser, server, and admin Supabase client factories
├── supabase/             # PostgreSQL database migrations and seed data
└── tests/                # Automated test suites
    ├── unit/             # Fast in-memory unit tests (domain, resolvers, components)
    ├── integration/      # Real Supabase/PostgreSQL RLS and golden-path integration tests
    ├── e2e/              # Playwright browser smoke tests
    └── fixtures/         # Deterministic crawler and candidate test fixtures
```

---

## Getting Started

### Prerequisites
- Node.js 24 (`nvm use` if using nvm)
- npm 10+
- Docker (optional, required only for running local Supabase integration tests)

### Installation
```bash
git clone https://github.com/juko04/Encore-concert-finder.git
cd Encore-concert-finder
npm ci
```

### Running the App
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application shell, or [http://localhost:3000/discover](http://localhost:3000/discover) to explore the concert discovery view.

### Running Verification Tests
```bash
npm test                 # Run fast in-memory unit tests
npm run lint             # Check ESLint rules
npm run typecheck        # Strict TypeScript type check (tsc --noEmit)
npm run format:check     # Check Prettier code formatting
npm run build            # Compile production Next.js build
npm run test:e2e         # Run browser smoke tests
```

When local Supabase / Docker is running:
```bash
npm run db:start         # Start local PostgreSQL / Supabase Docker container
npm run test:integration # Run full database integration & RLS test suite
npm run db:stop          # Stop local Supabase container
```

---

## Architectural Principles

1. **Explain Every Recommendation:** Transparent, human-readable reasons accompany every score.
2. **Immutable Observations:** Sources are never edited in place; every crawl produces an immutable audit record.
3. **Traceable Field-Level Provenance:** Every canonical attribute traces back to its source, raw ingest, and candidate observation.
4. **Strong Identity Disambiguation:** External IDs (Spotify, MusicBrainz) take precedence over normalized names to prevent false artist merges.
5. **Atomic Canonicalization:** All catalog mutations execute inside atomic database transactions (`apply_canonicalization`).
6. **Web-First & Resilient:** Proven on responsive web before native mobile apps; designed to handle multiple independent source feeds without crashing.

For more details, visit the [Documentation Map](docs/index.md).
