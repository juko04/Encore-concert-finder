# AGENTS.md

Shared instructions and context-routing rules for AI coding agents (ChatGPT, Antigravity, Claude, and peers) working in this repository.

---

## 1. Mission

Encore is a personalized live-music discovery application that ranks concerts, festivals, and local events by how worthwhile they are for an individual user based on taste, past attendance, venue affinity, price sensitivity, distance, and timing.

It is **not** a generic event calendar or ticketing directory. Every major feature supports one of these core user jobs:
- Find something good and inexpensive soon
- Find a favorite artist worth paying more to see
- Discover nearby small/local shows and unfamiliar artists
- Identify festivals and multi-day events worth traveling for
- Watch artists/events and receive alerts on meaningful changes

---

## 2. Context Routing (Read Minimum Necessary)

Do not load the entire repository documentation into prompt context. Practice progressive disclosure:

| If working on... | Read these authoritative files: |
|---|---|
| **Any task (always)** | [`AI_HANDOFF.md`](AI_HANDOFF.md) and [`docs/index.md`](docs/index.md) |
| **Database, schema, RLS, migrations** | Active phase spec, [`docs/architecture/data-model.md`](docs/architecture/data-model.md), [`docs/architecture/security.md`](docs/architecture/security.md) |
| **Ingestion, scrapers, crawlers** | Active phase spec, [`docs/architecture/ingestion.md`](docs/architecture/ingestion.md), [`docs/architecture/sources.md`](docs/architecture/sources.md) |
| **Entity resolution, deduplication, matching** | Active phase spec, [`docs/architecture/entity-resolution.md`](docs/architecture/entity-resolution.md) |
| **UI, pages, components** | Active phase spec, [`docs/product/vision.md`](docs/product/vision.md) |
| **Architectural decisions & tradeoffs** | [`docs/decisions/index.md`](docs/decisions/index.md), [`docs/project/non-blocking-debt.md`](docs/project/non-blocking-debt.md) |
| **Historical implementation context** | [`docs/phases/completed/`](docs/phases/completed/) *(only when strictly necessary)* |

---

## 3. Non-Negotiable Engineering Invariants

1. **Repository as Source of Truth:** Durable architecture and product decisions must be recorded in Markdown under `docs/`. Never let decisions live only in chat history.
2. **Phase Boundary Discipline:** Do not invent architecture, scaffold integrations, or implement features outside the current phase scope.
3. **Immutable Source Observations:** Raw ingests (`raw_ingests`) and parsed candidate observations (`event_candidates`) are immutable audit records. Never update or mutate existing observation rows in place.
4. **Field-Level Provenance:** Every canonical attribute must remain traceable to its source via `event_field_evidence`. Never overwrite higher-confidence data with lower-confidence data without an explicit field merge rule.
5. **Conservative Entity Resolution:** Normalized names are not universal identity keys. Disambiguate artists and venues carefully; canonical artist IDs and external IDs take strict precedence over matching names. If ambiguous, route to `needs_review`.
6. **No Hardcoded Geographies:** Colorado is an initial testing region, not an architectural constant. Never hardcode Denver, Colorado, or Mountain Time defaults into schemas, domain logic, or fallbacks.
7. **Atomic Persistence:** Canonicalization mutations must execute within atomic database transactions (via the PostgreSQL stored procedure). Zero orphaned entities on partial failures.
8. **No Test Weakening:** Never silently loosen database constraints, delete assertions, or mock out real boundaries to make CI pass.
9. **Secrets & Security:** Never commit credentials, cookies, tokens, or `.env.local`. Secure all non-public tables with RLS and restrict sensitive stored procedures to `service_role`.

---

## 4. Engineering Workflow & Verification

### Branch & PR Discipline
- One task per branch. Never commit directly to `main`.
- Only one agent owns an active implementation branch at a time; peer agents review.
- Never merge a branch without green CI and independent code review.

### Standard Verification Commands
Run before submitting code for review:
```bash
npm run format:check     # Verify Prettier styling
npm run lint             # Check ESLint rules
npm run typecheck        # Strict TypeScript typecheck (tsc --noEmit)
npm test                 # Run fast in-memory unit tests (86+ tests)
npm run build            # Compile Next.js production build
npm run test:e2e         # Run Playwright browser smoke tests
```
When Docker / local Supabase is available:
```bash
npm run test:integration # Run PostgreSQL-backed integration suite
```

---

## 5. Phase Documentation & Handoff Rules

### Phase Specifications
- Every project phase has a dedicated implementation specification.
- Active phase specifications live in [`docs/phases/active/`](docs/phases/active/).
- When discussions yield accepted design decisions or scope changes, update the active phase specification before finishing the turn.
- Completed phase specifications archive permanently to [`docs/phases/completed/`](docs/phases/completed/); never overwrite historical phase records.

### Operational Handoff (`AI_HANDOFF.md`)
- `AI_HANDOFF.md` represents current operational state. It must stay concise and contain only:
  - Current phase, task, branch, and active owner
  - Current status, test verification results, blockers, and next immediate action
- Update `AI_HANDOFF.md` whenever ownership transitions, implementation completes, or blockers arise.
