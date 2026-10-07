# AI Operational Handoff

Use this file **only** for the active operational handoff between contributors and AI agents.
Durable architecture records belong in [`docs/architecture/`](docs/architecture/), historical phases belong in [`docs/phases/completed/`](docs/phases/completed/), and accepted deferrals belong in [`docs/project/non-blocking-debt.md`](docs/project/non-blocking-debt.md).

---

## Current Status & Location

- **Current State:** Phase 1 successfully reviewed, verified in GitHub Actions CI, and merged into `main`.
- **Current Milestone:** Post-Phase-1 Tooling: Repository Organization & AI Context Optimization.
- **Current Branch:** `chore/repository-context-cleanup`
- **Active Implementing Agent:** Google Antigravity
- **Planning / Review Agent:** ChatGPT Personal

---

## Active Work in This Task

1. **Repository & Documentation Reorganization:**
   - Consolidated documentation into thematic subdirectories under `docs/` (`product/`, `architecture/`, `phases/`, `decisions/`, `project/`, `learning/`).
   - Created central documentation router: [`docs/index.md`](docs/index.md).
   - Created dedicated [`docs/architecture/entity-resolution.md`](docs/architecture/entity-resolution.md).
   - Archived completed phase specifications to [`docs/phases/completed/`](docs/phases/completed/).
   - Cleaned root clutter (moved project context, starter prompts, and onboarding guides to `docs/`).
   - Removed obsolete static text dumps (`FULL_PROJECT_SPEC.txt`, `REPO_FILE_INDEX.txt`).
2. **AI Context Optimization:**
   - Streamlined [`AGENTS.md`](AGENTS.md) with context routing and progressive disclosure.
   - Reduced [`AI_HANDOFF.md`](AI_HANDOFF.md) to current operational state only.
3. **Beginner Onboarding:**
   - Created beginner-friendly learning glossary: [`docs/learning/glossary.md`](docs/learning/glossary.md) with 30+ core concepts.
   - Updated [`README.md`](README.md) to provide clean orientation.
4. **CI & Workflow Housekeeping:**
   - Pinned GitHub Actions runner to `ubuntu-24.04` in `.github/workflows/ci.yml`.
   - Recorded non-blocking cleanup items in [`docs/project/non-blocking-debt.md`](docs/project/non-blocking-debt.md).

---

## Verification Status

| Check | Result | Details |
|---|---|---|
| `npm run format:check` | **PASS** | Code matches Prettier standards |
| `npm run lint` | **PASS** | 0 ESLint errors, 0 warnings |
| `npm run typecheck` | **PASS** | TypeScript `tsc --noEmit` clean pre- and post-build |
| `npm test` | **PASS** | 86/86 in-memory unit tests passing across 8 suites |
| `npm run build` | **PASS** | Next.js 15.5 production build compiled successfully |
| `npm run test:e2e` | **PASS** | Playwright smoke tests pass in CI |
| Database Integration Suite | **PASS in CI (21/21)** | Full RLS and golden-path integration suite verified against PostgreSQL in CI |

---

## What the Next Agent Must Know

1. **Next Immediate Milestone:** **Encore Project Hub / Learning Hub** (interactive developer/agent/operator hub for architecture documentation, entity inspection, ingestion pipeline visualization, and system onboarding).
2. **Phase 2 Status:** **NOT STARTED.** Do not begin live Ticketmaster ingestion, Spotify integration, or recommendation scoring until the Learning Hub is established.
3. **Documentation Authority:** Markdown files under `docs/` remain the single source of truth. The upcoming Learning Hub will render and visualize these Markdown documents rather than duplicating them.
4. **Accepted Deferrals & Non-Blocking Debt:** See [`docs/project/non-blocking-debt.md`](docs/project/non-blocking-debt.md).
