# START HERE

This repository contains the shared product and engineering context for the Concert Finder project (working title: Encore).

## What to do first

1. Put the contents of this folder at the root of the new GitHub repository.
2. Commit the documentation before any application code is generated.
3. Open the repository locally in VS Code.
4. Give each AI assistant the matching prompt in `AI_START_PROMPTS.md`.
5. Keep GitHub + the local repository as the source of truth. Do not depend on any one chat history.

## Recommended AI roles

- **ChatGPT Personal:** product/architecture lead and code reviewer.
- **Antigravity:** primary implementation agent for multi-file coding tasks.
- **Claude:** independent reviewer, test/risk analyst, and targeted refactoring assistant.

These are defaults, not hard restrictions. The important rule is that only one agent should own a given implementation branch/task at a time.

## Read order for any agent

1. `AGENTS.md`
2. `README.md`
3. `PROJECT_CONTEXT.md`
4. `docs/12-decisions.md`
5. `docs/11-roadmap.md`
6. Documents relevant to the current task
7. The active `docs/PHASE_<NUMBER>_IMPLEMENTATION.md` file
8. `AI_HANDOFF.md` if work is already in progress

Phase specifications are persistent implementation records. Read the active phase
file before planning, implementing, or reviewing work, and update it when an
accepted material decision changes that phase. See `AGENTS.md` for the required
phase-documentation and handoff rules.

## First engineering milestone

Do not begin with scraping dozens of sites.

Phase 0 should establish:

- Next.js + TypeScript application
- Tailwind CSS
- Supabase/Postgres configuration
- environment variable handling
- linting, formatting, type checking, and tests
- CI for pull requests
- initial database migration structure
- shared domain types
- source-adapter interface
- local seed/dev data

After Phase 0 is stable, begin Ticketmaster ingestion and canonical event modeling.

## Important deferred feature

Email/newsletter ingestion is **deferred, not rejected**. Revisit it when implementing alerts, presales, promoter-announcement coverage, and source gaps. Do not build the MVP around email access.
