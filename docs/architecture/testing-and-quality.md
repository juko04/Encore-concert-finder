# 15 — Testing and Quality

## Minimum checks for pull requests

Before submitting or reviewing pull requests, contributors and agents must follow the mandatory self-audit protocol in [`docs/development/PR_REVIEW_CHECKLIST.md`](../development/PR_REVIEW_CHECKLIST.md).

Minimum automated checks:
- Code formatting (`npm run format:check`)
- ESLint (`npm run lint`)
- TypeScript typecheck (`npm run typecheck`)
- Fast in-memory unit tests (`npm test`)
- Source-adapter parser tests for touched adapters
- Next.js production build (`npm run build`)
- Playwright browser tests (`npm run test:e2e`)
- PostgreSQL integration tests (`npm run test:integration` when local Supabase is available)

## Source adapter tests

Scrapers are brittle by nature. Each direct source adapter should ideally include sanitized HTML/JSON fixtures representing the source page.

Test:
- normal upcoming event
- support acts
- multi-day dates
- sold-out status
- missing optional price
- canceled/rescheduled event when represented
- markup variation where known

A parser test should not hit the live internet.

## Deduplication tests

Include cases such as:
- same artist/date/venue from Ticketmaster + promoter
- same festival from ticketing provider + official festival site
- same artist playing two shows at same venue on consecutive dates
- similarly named but different artists
- venue aliases

Prefer false negatives to dangerous false-positive merges early in development. Candidate records can be reconciled later; incorrectly merging two real events is harder to recover from.

## Recommendation tests

Use deterministic fixture users.

Examples:
- favorite artist at moderate price outranks unknown artist at same price
- cheap nearby unknown artist can outrank expensive favorite in Cheap Adventure mode
- `too_expensive` feedback changes price preference but not artist taste
- disliked venue reduces venue feature without destroying artist affinity
- festival day with most favorite artists scores above weak day when pass prices are comparable

## Integration tests

Important flows:
- onboarding -> taste profile -> feed
- save/dismiss event
- create watch rule
- festival detail + day scores
- Ticketmaster candidate -> canonical event

## Browser tests

Use Playwright for the app itself, independent of whether Playwright is needed by source crawlers.

Initial end-to-end tests:
- discovery page renders
- filters/modes change results
- event detail opens
- feedback persists
- festival lineup renders

## Observability tests

Simulate source failure and verify:
- canonical events are not mass deleted
- source health changes
- failure is logged/visible

## CI

GitHub Actions should eventually run:

```text
install
lint
typecheck
unit tests
build
```

Keep live-network crawler checks out of required PR CI. Run them separately as scheduled smoke tests.
