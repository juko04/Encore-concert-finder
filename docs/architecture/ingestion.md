# 04 — Ingestion and Scraping

## Strategy

Use multiple complementary acquisition methods.

APIs are preferred when reliable and permitted, but the product should not depend on APIs alone because local/small venue coverage and announcement freshness may be incomplete.

## Ingestion ladder

For each source, attempt in this order:

1. documented API
2. structured public feed (RSS, ICS, JSON feed)
3. JSON-LD / schema.org Event
4. embedded structured JSON used by the public page
5. normal HTTP fetch + HTML parsing (Cheerio)
6. Playwright/browser rendering only when data is not otherwise available

## Do not

- bypass CAPTCHAs
- bypass login or access controls
- defeat anti-bot systems
- impersonate users with fake accounts
- scrape private/authenticated social content
- assume a public web page grants unrestricted reuse rights

## Raw ingestion pipeline

```text
SOURCE
  -> FETCH
  -> RAW_INGEST
  -> PARSE
  -> EVENT_CANDIDATE
  -> ENTITY RESOLUTION
  -> DUPLICATE MATCH
  -> SOURCE CORROBORATION
  -> CANONICAL EVENT
```

## Why raw snapshots matter

Retaining source snapshots allows:
- parser bug fixes without refetching
- auditability
- detecting changed source data
- replaying old inputs through new parser versions

## Source adapter responsibilities

Each adapter should:
- fetch one or more public pages/API pages
- emit raw ingestion records
- parse to common candidate types
- include source URL and source IDs
- expose basic health metrics

It should not:
- decide personalized ranking
- write directly to user recommendation tables
- contain venue-specific logic outside that adapter

## Change detection

Maintain:
- `content_hash`
- last fetched time
- last changed time

When possible, avoid reparsing unchanged content.

If a source supports ETag/Last-Modified, use conditional requests.

## Suggested crawl cadence

These are starting heuristics, not fixed requirements:

- major promoter announcement pages: every 2–4 hours
- venue event calendars: every 4–8 hours
- festivals near lineup/on-sale announcements: every 2–6 hours
- low-volume/static venue pages: daily
- static venue metadata: weekly/monthly

Back off automatically when sources fail.

## Source health

Track per source:

```text
last_attempt_at
last_success_at
http_failures
parse_failures
events_found
new_events_found
changed_events_found
expected_volume_baseline
health_status
```

Heuristic parser-break detection example:

- source normally returns 80–120 future events
- suddenly returns 0 with HTTP 200
- mark `SUSPECT_PARSER_FAILURE`
- do not delete canonical events automatically

## Normalization

Normalize:
- artist names
- venue names
- city/state
- dates/time zones
- price/currency
- age restrictions
- ticket status
- event types

Preserve the original source text alongside normalized fields.

### URL normalization

Normalize URLs conservatively for matching: normalize scheme/host casing, remove
default ports and trailing slashes, and remove fragments plus known tracking
parameters (`utm_*`, `gclid`, and `fbclid`). Preserve unknown provider-specific
query parameters, which may carry signed, affiliate, or event-specific meaning.
Retain the sanitized source URL for auditability.

## Entity resolution

Artist matching signals:
- exact provider ID
- normalized name
- Spotify/Ticketmaster ID mapping
- alias table
- lineup context

Venue matching signals:
- known provider ID
- normalized name
- street/city when public
- coordinates

## Deduplication

A probable duplicate can be identified with weighted features:

- same/near venue
- same date/time
- overlapping artists
- similar event title
- same ticket URL or provider ID

Never rely on event title alone.

Store merge confidence and supporting sources.

## Source confidence

Illustrative starting confidence values:

```text
official artist site        1.00
official festival site      1.00
official venue site         0.98
official promoter site      0.98
primary ticket provider     0.95
official artist social      0.90
official venue social       0.90
reputable local listing     0.75
unverified social mention   0.35
```

These are tunable priors, not absolute truth.

## Social strategy

Social media should initially be used primarily for discovery/verification signals, not as the canonical datastore.

Preferred:
- official platform APIs where available and allowed
- official public links surfaced by artist/promoter sites
- public announcement pages mirrored on official sites

Avoid building the MVP around brittle logged-in browser scraping of Instagram/X/etc.

## Field-level conflict resolution

When sources disagree:
- prefer newer, higher-confidence first-party evidence
- retain all source evidence
- do not destroy old observations
- mark meaningful unresolved conflict for investigation

Examples:
- changed venue
- rescheduled date
- canceled show
- changed lineup

---

## Production Scheduling & Quota Governance (ISS-B & ISS-A)

### Ticketmaster Quota Constraints
Ticketmaster Discovery API v2 enforces strict account-wide rate limits:
- **Daily Quota:** 5,000 requests per 24-hour UTC window.
- **Burst Rate:** 5 requests per second.

### Single-Runner Serialized Execution Architecture
Independent serverless or cloud runners cannot coordinate local filesystem state without centralized locking. To prevent race conditions, uncoordinated quota exhaustion, and 429 penalties in production:

1. **Serialized Workflow Concurrency:** Scheduled jobs in CI/CD (e.g. GitHub Actions) MUST configure a repository-wide concurrency group (`concurrency: { group: 'ticketmaster-ingestion', cancel-in-progress: false }`). Only one ingestion runner executes at any moment.
2. **Rolling Temporal Horizons:** Rather than requesting 365 days across all geographies daily:
   - **Near-term (0–14 days):** Daily sync (high frequency, small page yield, bounded request budget).
   - **Mid-term (15–60 days):** Bi-weekly sync (Wednesdays/Sundays).
   - **Long-term (61–365 days):** Weekly sync (Saturdays).
3. **Bounded Request Budgets (`--max-requests=N`):** Every scheduled ingestion run specifies an explicit upper request ceiling (e.g. 250 requests for near-term, 500 for full baseline). Once reached, further regions or tour searches are gracefully deferred to subsequent runs.
4. **Fail-Closed Quota Guard (`TicketmasterQuotaGuard`):**
   - File locks use PID-based liveness verification (`process.kill(pid, 0)`). Dead process locks are reclaimed; active processes are respected.
   - Lock acquisition timeouts, corrupt storage files, and persistence failures strictly fail closed, throwing typed errors (`TicketmasterQuotaLockError`, `TicketmasterQuotaCorruptionError`, `TicketmasterQuotaPersistenceError`).
   - The budget never silently resets to zero on storage corruption.
5. **Provider Rate Limit Header Feedback:** Ingestion monitors `rate-limit-available` and `rate-limit-reset` headers from Ticketmaster API responses to adjust inter-request delays dynamically and avoid burst rate limit violations.
