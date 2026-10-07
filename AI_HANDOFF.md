# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and accepted deferrals belong in [`docs/project/non-blocking-debt.md`](docs/project/non-blocking-debt.md).

---

## Current Status & Location

- **Current State:** Post-Phase-1 repository organization and AI-context optimization **COMPLETE**.
- **Current Branch:** `chore/repository-context-cleanup`
- **Verification:** Local test suites PASS; GitHub CI PASS.
- **Immediate Action:** Independent review complete; merge cleanup PR into `main`.
- **Next Milestone After Merge:** **Encore Project Hub / Learning Hub**.
- **Phase 2 Status:** **NOT STARTED.**

---

## Summary of Accomplished Cleanup

1. **Repository & Documentation Structure:**
   - Consolidated documentation into thematic subdirectories under `docs/` (`product/`, `architecture/`, `phases/`, `decisions/`, `project/`, `learning/`).
   - Established central documentation router: [`docs/index.md`](docs/index.md).
   - Created standalone architecture specification: [`docs/architecture/entity-resolution.md`](docs/architecture/entity-resolution.md).
   - Archived completed phase specifications to [`docs/phases/completed/`](docs/phases/completed/).
   - Removed obsolete text dumps (`FULL_PROJECT_SPEC.txt`, `REPO_FILE_INDEX.txt`).
2. **AI Context Optimization:**
   - Enforced progressive disclosure in [`AGENTS.md`](AGENTS.md) with context routing table.
   - Rewrote [`docs/project/ai-start-prompts.md`](docs/project/ai-start-prompts.md) as reusable role prompts directing agents to `AGENTS.md` context routing.
   - Streamlined [`AI_HANDOFF.md`](AI_HANDOFF.md) to active operational handoff only.
3. **Contributor Onboarding:**
   - Created conceptual learning glossary: [`docs/learning/glossary.md`](docs/learning/glossary.md) with 30+ core live-music and engineering concepts.
   - Rewrote [`docs/project/onboarding.md`](docs/project/onboarding.md) for contributors arriving at the codebase today.
   - Updated root [`README.md`](README.md) navigation and milestone tracking.
4. **CI & Workflow Modernization:**
   - Pinned GitHub Actions runner to `ubuntu-24.04` LTS.
   - Upgraded `actions/checkout@v7` and `actions/setup-node@v7` with native Node 24 runtime, eliminating deprecation warnings.
   - Recorded non-blocking debt in [`docs/project/non-blocking-debt.md`](docs/project/non-blocking-debt.md).

---

## Verification Status

| Check | Result | Details |
|---|---|---|
| `npm run format:check` | **PASS** | Code matches Prettier standards |
| `npm run lint` | **PASS** | 0 ESLint errors, 0 warnings |
| `npm run typecheck` | **PASS** | TypeScript `tsc --noEmit` clean pre- and post-build |
| `npm test` | **PASS** | 86/86 in-memory unit tests passing across 8 suites |
| `npm run build` | **PASS** | Next.js 15.5 production build compiled successfully |
| `npm run test:e2e` | **PASS** | Playwright smoke tests configured for CI |
| Database Integration Suite | **PASS in CI (21/21)** | Full RLS and golden-path integration suite verified against PostgreSQL in CI |

---

## What the Next Agent Must Know

1. **Next Immediate Milestone:** **Encore Project Hub / Learning Hub** (interactive developer/agent/operator hub for architecture documentation, entity inspection, ingestion pipeline visualization, and system onboarding).
2. **Phase 2 Status:** **NOT STARTED.** Do not begin live Ticketmaster ingestion, Spotify integration, or recommendation scoring until the Learning Hub is established.
3. **Documentation Authority:** Markdown files under `docs/` remain the single source of truth. The upcoming Learning Hub will render and visualize these Markdown documents rather than duplicating them.
4. **Historical Phase Specifications:** Files under `docs/phases/completed/` are historical archives; do not load them into prompt context unless historical decision rationale is explicitly needed.
