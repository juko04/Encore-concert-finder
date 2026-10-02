# AGENTS.md

Shared instructions for AI coding agents (ChatGPT/Codex, Google Antigravity, Claude, or others) working in this repository.

## Mission

Build a personalized live-music discovery application that ranks concerts, festivals, and local events by how worthwhile they are for an individual user.

Do not reduce the product to a generic event-search UI. Every major feature should support one of these jobs:

- find something good and inexpensive soon
- find a favorite artist worth paying more to see
- discover nearby small/local shows
- identify festivals/multi-day events worth traveling for
- watch artists/events and alert on meaningful changes

## Current stack

Use unless an ADR/decision document explicitly changes it:

- Next.js
- TypeScript
- Tailwind CSS
- PostgreSQL / Supabase
- Supabase Auth
- Spotify Web API
- Ticketmaster Discovery API as one baseline source
- source adapters for venue/promoter/festival/ticketing pages

## Coding principles

- Prefer TypeScript across frontend, backend, adapters, and workers.
- Keep source-specific scraping code isolated behind adapters.
- Never let page-specific DOM selectors leak into canonical event/domain logic.
- Normalize all sources into common candidate/event types.
- Preserve source provenance for every imported fact.
- Do not silently delete canonical events because one crawler fails.
- Write idempotent ingestion and worker jobs.
- Design for reprocessing raw ingests.
- Prefer explicit and testable recommendation logic over opaque ML.
- Keep price, artist affinity, venue affinity, distance, and timing as independently inspectable features.
- Treat festivals and multi-day events as first-class entities.
- Keep user-private information separate from public event metadata.
- Do not commit secrets, API keys, cookies, OAuth tokens, or personal user exports.

## Scraping rules

Before scraping a source:

1. Prefer a documented API, feed, JSON-LD, schema.org Event markup, RSS, ICS, or embedded structured JSON.
2. If needed, use normal HTTP fetch + HTML parsing.
3. Use Playwright/browser automation only for pages whose data is unavailable otherwise.
4. Respect applicable terms, robots controls, authentication boundaries, and reasonable crawl rates.
5. Do not bypass CAPTCHAs, access controls, paywalls, or anti-bot protections.
6. Do not use fake accounts or authenticated scraping unless explicitly designed and permitted.
7. Use social media primarily as a discovery signal unless an approved official integration exists.
8. Record source URL, fetch time, parser version, content hash, and extraction confidence.

## Data integrity

Canonical events must be traceable back to one or more source records.

Do not overwrite higher-confidence data with lower-confidence data without an explicit field-level merge rule.

Every source adapter should have fixture-based parser tests where feasible.

## Product UX principles

Event cards should answer:

- Why is this recommended?
- How much does it cost?
- How far / how much effort is it?
- How strong is the music match?
- Is anything time-sensitive (presale, on-sale, price change)?

Do not expose a mysterious recommendation score without a human-readable explanation.

## Deferred feature reminder

**Email/newsletter ingestion is intentionally deferred, not rejected.** Revisit it when implementing:

- presale discovery
- notification quality
- promoter announcements
- missing-source coverage
- user integrations

See `docs/14-future-email-ingestion.md`.

## Collaboration workflow

- GitHub is the source of truth.
- Prefer one feature/issue per branch.
- Before large changes, update or reference the relevant spec document.
- Agents should read `START_HERE.md`, `AGENTS.md`, `PROJECT_CONTEXT.md`, `README.md`, and relevant files in `docs/` before implementation.
- Check `AI_HANDOFF.md` before starting work so concurrent agents do not unknowingly overlap.
- Only one agent should own an implementation branch/task at a time; other agents may review it.
- If code and documentation disagree, flag the inconsistency instead of silently inventing new product behavior.
- Major architectural changes should update `docs/12-decisions.md`.

## Phase implementation documentation rule

Every project phase must have a dedicated implementation specification at:

```text
docs/PHASE_<NUMBER>_IMPLEMENTATION.md
```

For example: `docs/PHASE_0_IMPLEMENTATION.md`,
`docs/PHASE_1_IMPLEMENTATION.md`, and `docs/PHASE_2_IMPLEMENTATION.md`.
Each file is the persistent source of truth for its phase. It must give another
agent enough context to implement or review that phase without prior chat history.

### During planning discussions

When a discussion with ChatGPT, Antigravity, or another project agent produces an
accepted, materially relevant decision, clarification, requirement, constraint,
implementation detail, acceptance criterion, architecture change, testing
requirement, or scope change for the active phase, update that phase's
`PHASE_<NUMBER>_IMPLEMENTATION.md` before ending the materially relevant work.

Do not update a phase specification for casual discussion, unaccepted speculation,
or irrelevant conversation. If a decision changes the broader architecture, update
the applicable document in `docs/` as well.

### When a new phase begins

Create a new `docs/PHASE_<NUMBER>_IMPLEMENTATION.md`; never overwrite or repurpose
the prior phase file. Previous phase specifications remain in the repository as
historical records of intended and implemented work.

Every phase specification must include at least:

- phase objective and relevant architectural context
- scope and explicit exclusions
- implementation checklist and affected modules/files
- database or API changes, dependencies, and environment-variable changes
- migration, testing, and CI requirements
- completion commands and definition of done
- known risks/open questions, decisions made during the phase, and approved deviations

### Operational handoff

`AI_HANDOFF.md` represents the current operational state. It must always identify:

- current phase, task, branch, active implementing agent, and phase specification file
- status, completed work, tests run, known issues, unresolved decisions, and next step

Update it whenever ownership changes, implementation finishes, a major blocker is
found, or the project moves to a new phase.

Important project decisions must not live only in chat history. When working in the
repository, update the relevant documentation before ending a materially relevant
discussion.
