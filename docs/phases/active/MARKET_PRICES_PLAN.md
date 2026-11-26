# Market Prices ("From $X") — Implementation Plan

**Status:** Approved by the owner 2026-11-26, as written. PR A (migration, adapter, matcher, dry-run report) is implemented on `feat/market-prices-seatgeek` and verified against fixtures and local Postgres. The live dry-run gate (§11) still needs a SeatGeek API client id. **Paused 2026-11-26 by the owner** (SeatGeek account setup not working yet); resume when a client id is available.
**Scope:** A new price-only source. It adds a "from $X" price to shows that have no listed price. It does not create events, change canonical fields, or change scoring in v1.

---

## 1. Problem

Only 256 of 1,248 upcoming Ticketmaster listings (20%) include `priceRanges`. Every price received is already persisted (0 dropped; see `docs/project/non-blocking-debt.md` §5.7).

- **Mission Ballroom:** 0 of 53 upcoming shows priced. Ticketmaster omits prices, and the venue site returns 403 to automated requests.
- **Festivals:** 63 of 100 festival groups have no price on any day.

Users see "Check ticket prices" where a starting price would answer the real question: roughly what will this cost?

## 2. Goal and non-goals

**Goal:** For shows without a listed price, show the lowest price currently available on a ticket marketplace, clearly labelled, with a link to where it comes from.

**Non-goals (v1):**
- No change to `events.min_price` / `max_price`. Those stay face value from the seller.
- No change to the price factor, budgets, or the "Listed price up to $X" filter.
- No new canonical events, artists or venues from the marketplace. It is enrichment only.
- No scraping of any marketplace or venue site.

## 3. Source choice: SeatGeek Platform API

The SeatGeek Platform API (`https://api.seatgeek.com/2`, docs at https://seatgeek.github.io/) provides:
- `/events` with per-event `stats`: `lowest_price`, `average_price`, `highest_price`, `listing_count`.
- Geolocated search (`lat`, `lon`, `range`), date filters, and `listing_count.gt=0`.
- Taxonomy filters (concerts, music festivals).
- Auth with a `client_id` query parameter or HTTP Basic auth.

**Alternatives rejected:**
- **StubHub, Vivid Seats, TickPick:** no public developer API.
- **Third-party "ticket data" APIs (e.g. tickets.dev, ticketsdata.com):** they read marketplace pages by scraping, which conflicts with `docs/architecture/ingestion.md` ("Do not … defeat anti-bot systems") and the marketplaces' terms.
- **Venue sites (Mission Ballroom/AXS):** blocked (403). We do not work around blocks.
- **Ticketmaster event-detail calls:** they return the same data as search, so no prices.

## 4. Terms constraints (SeatGeek Platform Terms, https://seatgeek.com/api-terms)

- **Attribution:** show the SeatGeek logo, linked to SeatGeek, everywhere SeatGeek data is displayed. Design it as a small "SeatGeek" mark next to the price.
- **Fees:** SeatGeek may charge or change fees, require supplemental terms, or change or remove the API without notice. Put the feature behind a flag (`ENCORE_MARKET_PRICES=1`) and fail quietly back to "Check ticket prices".
- **Prohibited uses:** no secondary-marketplace or competitive use, and no scraping of the SeatGeek site. Encore only shows a reference price and links out.
- **Who agrees:** the owner accepts the terms when creating the API key. The agent cannot create accounts.

## 5. Data model (one migration)

**`market_price_observations`** — append-only, never updated in place (Invariant 3):

| Column | Notes |
|---|---|
| `id`, `event_id` (FK events), `source_id` (FK sources) | source slug `seatgeek-platform`, `source_type = 'ticketing'` (the existing type list has no 'aggregator') |
| `raw_ingest_id` (FK raw_ingests) | the API page this came from (provenance) |
| `marketplace_event_id`, `marketplace_url` | SeatGeek event id and public page |
| `lowest_price`, `average_price`, `highest_price` | numeric, nullable, ≥ 0 |
| `listing_count` | integer ≥ 0 |
| `currency` | 3 letters; only `USD` is displayed (Invariant 10: never convert) |
| `observed_at` | when fetched |
| `match_method`, `match_confidence`, `parser_version` | how the event was matched |

- **Append-only guard:** a trigger rejects every UPDATE and any direct DELETE; rows only leave by cascade from their event, source or raw ingest. Unique key `(raw_ingest_id, marketplace_event_id, event_id, observed_at)`, so re-writing is idempotent but an unchanged page seen later still records a fresh sighting.
- **`market_prices_current` view:** the latest observation per event and source, only if `observed_at` is within 72 h and `listing_count > 0`.
- **RLS:** anon and authenticated users read the view only. Writes are `service_role` only.
- **Field evidence:** not used in v1, because no canonical field is set. If market prices ever fill canonical fields, they must go through `event_field_evidence`.

## 6. Ingestion

- **Adapter:** `lib/sources/seatgeek/` with `client.ts`, `parser.ts`, `matcher.ts` and `pipeline.ts`.
  - Reads `SEATGEEK_CLIENT_ID` from env. It is never committed or logged.
  - Has a per-run request budget and runs at about 1 request per second.
  - Retries with backoff.
  - 401/403 stops the run with a clear status instead of retrying.
- **Query:** for each state passed with `--states=` (the same list `scripts/sync-all-sources.ts` uses for Ticketmaster; no hardcoded geography), call `/events`:
  - `venue.state=<code>` (geolocated `lat`/`lon`/`range` is the fallback if state filtering is too coarse)
  - `taxonomies.name=concert` and music festivals
  - `datetime_utc.gte/lte` covering a 90-day horizon
  - `listing_count.gt=0`
  - `per_page=100`, paginated
- **Raw storage:** each API page goes to `raw_ingests` (hash plus payload) before parsing, so the parser can be re-run.
- **Script:** `npm run sync:market-prices`. It is a dry run by default and prints the match report. `--write` persists observations. Later it becomes an optional step in `scripts/sync-all-sources.ts`, behind the flag.
- **Cadence:** daily, because resale prices move.
- **Safety:** reuse the existing destination guard, so a test run can never write to a non-local database.

## 7. Matching (conservative, Invariant 5)

A SeatGeek event attaches to a canonical event only when the match is unambiguous. Otherwise it is skipped and counted in the report, never guessed.

1. **Candidates:** canonical events on the same local date in the venue's IANA timezone, at a venue within 1 mi of SeatGeek's venue coordinates or matching by normalized name or alias.
2. **One candidate at that venue and date:** match if the headliner or title shares a normalized artist name with SeatGeek's performers, or the title-token overlap is at least 0.6.
3. **Several candidates (early/late shows):** require a start time within 90 minutes **and** a performer-name match.
4. **Festivals:** a SeatGeek pass event matches a festival group when the date ranges overlap and the names are similar. Attach it to the group's primary event.
5. **Anything else:** no write; logged as `unmatched` or `ambiguous` with the reason.

No canonical artist, venue or event is created or edited.

## 8. Display

**Price precedence everywhere:**
1. Listed face value (`events.min_price`/`max_price`), shown as now.
2. Otherwise the market price: **"From $48"** plus a small SeatGeek mark that links to the SeatGeek event page (attribution).
3. Otherwise "Check ticket prices".

**Concert page:** "Resale from $48 · avg $72 · 120 listings · updated 3 h ago", with a secondary "See on SeatGeek ↗" link. The main ticket button is unchanged.

**Other rules:**
- Hidden when stale (more than 72 h old) or when the currency is not USD.
- Wording says "from" or "resale from", never presented as face value.

## 9. Scoring (decision needed)

The recommendation is **display only in v1**. A resale floor can sit well below or far above face value, so using it in the price factor or budget filters would mislead. Revisit once the coverage numbers are known; if it is ever used, it should be a labelled "estimated" input.

## 10. Testing

- **Fixtures:** recorded SeatGeek responses with the client id stripped. Unit tests cover the parser, all matcher branches (single show, early/late ambiguity, festival pass, stale, non-USD) and the price-precedence formatter.
- **Integration (local Supabase):**
  - the migration applies;
  - observations are immutable (update and direct delete rejected; event delete cascades);
  - RLS lets anon read only the view;
  - the view excludes stale rows.
- **E2E:** fixture rows render "From $X" with the attribution link.
- **CI:** no live SeatGeek calls. A local smoke test (one request) runs only when `SEATGEEK_CLIENT_ID` is set.

## 11. Delivery (three PRs, after approval)

| PR | Contents |
|---|---|
| A | Migration, adapter, matcher, dry-run report. **Gate:** report the match rate on the local catalog (Mission Ballroom and festivals called out) before any UI work. *Built 2026-11-26; awaiting a live dry run.* Baseline from the fixture dry run: 517 unpriced CO shows in the next 90 days (24 at Mission Ballroom, 12 festival groups). |
| B | Display, attribution and price precedence. |
| C | Scheduling, docs, and the `sources.md` and decision-log entries. |

**Success measure:** share of upcoming unpriced shows that gain a current market price. The target is ≥ 50% overall and most Mission Ballroom shows. If PR A's dry run falls far short, stop and report.

## 12. Owner decisions (approved 2026-11-26)

1. **Approved:** SeatGeek Platform API as a price-only source under these rules, tried first.
2. **Approved:** labels "From $X" on cards and "Resale from $X" on the concert page.
3. **Approved:** market prices are display-only in v1 (§9).
4. **Not used:** scraping-based ticket-data vendors (e.g. tickets.dev, TicketsData). Revisit only by explicit owner decision after SeatGeek coverage is measured (see `docs/decisions/index.md`).

**Remaining owner step:** get a key. Sign in at https://seatgeek.com/account/develop, register an app, accept the API terms, and put the client id in `.env.local` as `SEATGEEK_CLIENT_ID=…`. Never commit it, and do not paste it into chat.
