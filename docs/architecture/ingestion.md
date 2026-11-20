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
- **Burst Rate:** 5 requests per second (Encore defaults conservatively to 2 req/sec with 500ms spacing).

### Production Single-Runner Serialized Execution Model
Independent serverless or cloud runners cannot coordinate local filesystem state without centralized locking. To prevent race conditions, uncoordinated quota exhaustion, and 429 penalties in production:

1. **Serialized Workflow Concurrency:**
   Scheduled jobs in CI/CD (e.g. GitHub Actions) MUST configure a repository-wide concurrency group:
   ```yaml
   concurrency:
     group: ticketmaster-ingestion
     cancel-in-progress: false
   ```
   This guarantees that scheduled runs and manual triggers are queued and executed strictly one at a time, completely eliminating parallel execution race conditions.

2. **Ephemeral Quota Reconciliation via Response Headers:**
   When an ephemeral cloud runner (e.g. GitHub Actions container) starts up, it does not require a persistent external cache (like Redis) to discover account-wide usage. On its very first request, the Ticketmaster Discovery API returns authoritative usage headers:
   - `rate-limit`: e.g. 5000 (daily allocation)
   - `rate-limit-available`: e.g. 4820 (remaining requests in window)
   - `rate-limit-reset`: UTC timestamp in milliseconds when daily quota refreshes
   The client immediately synchronizes these values into `TicketmasterQuotaGuard`, discovering current account-wide consumption.

3. **Atomic Per-Run Request Budget (`RunRequestBudget`):**
   Every execution is bounded by an atomic per-run request budget (e.g. `--max-requests=250` for daily near-term, `--max-requests=500` for weekly long-term):
   - Checked atomically before dispatching any HTTP request across regional queries, partition bisections, pagination pages, retries, favorite artist tours, and festival searches.
   - When exhausted, throws `TicketmasterRunBudgetExceededError`, which is caught gracefully by the partition coordinator and ingestion pipeline to mark `hasIncompleteCoverage: true` and report status `'partial'`.
   - Never exceeds the allocated run budget.

4. **Rolling Temporal Horizons:**
   Rather than requesting 365 days across all geographies daily:
   - **Near-term (0–14 days):** Daily sync at 06:00 UTC (high frequency, small page yield, bounded request budget of 250 requests).
   - **Mid-term (15–60 days):** Bi-weekly sync on Wednesdays/Sundays at 08:00 UTC (bounded by 500 requests).
   - **Long-term (61–365 days):** Weekly sync on Saturdays at 10:00 UTC (bounded by 500 requests).
   - Unused daily headroom (>3,500 requests) remains safely reserved for user queries and live operations.

5. **Strict Failure Detection & Exit Codes:**
   `scripts/sync-all-sources.ts` returns:
   - `exit 0`: ONLY when all configured sources succeed with 100% complete coverage.
   - `exit 2`: When one or more sources have partial coverage or budget exhaustion (`status === 'partial'`).
   - `exit 1`: When any source fails completely (`status === 'failed'`) or a fatal error occurs.
   - `--json`: Outputs machine-readable run statistics uploaded as build artifacts.

6. **Fail-Closed Quota Guard (`TicketmasterQuotaGuard`):**
   - File locks use unique UUID tokens (`lockId`) and PID liveness verification (`process.kill(pid, 0)`).
   - A lock is NEVER stolen or reclaimed if the holding process is demonstrably alive, even after 15+ seconds.
   - Replaced locks cannot be deleted by old delayed owners upon exit.
   - State corruption, lock timeouts, and filesystem write failures strictly fail closed.

7. **Production Pre-Activation Checklist:**
   Before activating scheduled cron triggers in production:
   - Set GitHub repository secret `SUPABASE_URL` to production database instance.
   - Set GitHub repository secret `SUPABASE_SERVICE_ROLE_KEY`.
   - Set GitHub repository secret `TICKETMASTER_API_KEY`.
   - Set GitHub repository secret `ENCORE_APPROVED_PROD_HOSTS` matching approved production hostnames.
   - Set GitHub repository secret `ENCORE_PROD_PROJECT_REF`.
   - Verify workflow template `.github/workflows/scheduled-sync.yml.example` is copied to `.github/workflows/scheduled-sync.yml`.
