# Encore Future PR: Request a Missing Venue / Add a Website

**Status:** Proposed future feature, not currently implemented.
**Placement:** After the Phase 3 shared venue-source framework is established. May be delivered as a small separate PR.
**Goal:** Let an Encore user search for a venue, request coverage if it is missing, and optionally submit an official event-calendar URL. Keep a durable, reviewable backlog of requests without making an unsafe or brittle universal scraper.

## User experience

1. User searches for a venue in Discover or a dedicated Venue Search.
2. If no *venue record* matches, show **“Can't find this venue? Request it”**. Distinguish this from **“Venue found, but no upcoming events”**.
3. Form asks for **venue name** and **city/state**; optional **official website or events URL** and **note**. Show an optional “I don't know the website” choice.
4. On submission, normalize and validate fields, avoid duplicate requests for the same venue, and show **“Request submitted; not yet a live Encore source.”**
5. Admin can review pending requests, see demand counts and submitted URLs, and mark outcomes.

## Where data should live

Use a **Supabase/PostgreSQL `venue_source_requests` table**, not a Markdown file written by the running Next.js/Vercel application. Runtime files are not a dependable shared, persistent request queue. Generate a Markdown (and optionally CSV) **export** when needed so the owner can review the requests and decide what to incorporate.

Suggested minimum fields:

| Field | Purpose |
|---|---|
| `id`, `created_at`, `updated_at` | Request identity/timestamps |
| `venue_name`, `normalized_venue_name` | Display and deduplication |
| `city`, `state_code` | Location and disambiguation |
| `submitted_url` (nullable) | Proposed official website or events calendar |
| `status` | `pending`, `investigating`, `supported`, `not_supported`, `duplicate` |
| `request_count`, `last_requested_at` | Prioritize frequently requested venues without adding duplicates |
| `admin_notes` (private) | Source analysis and disposition |
| `source_id` (nullable) | Link to existing source registry after onboarding |

Use existing source registry and user-auth patterns where practical. Do not publicly expose submitter identifiers, admin notes, or any secret credentials. Put rate limits and sensible input-length limits on the request endpoint; prevent spam and duplicate submissions.

## Source onboarding decision tree

1. **Already covered:** Match to an existing venue/source, show its events or identify that the venue currently has no upcoming events; do not create a duplicate.
2. **Supported standardized format:** If a vetted official URL uses an already supported feed/platform or structured event data (e.g., JSON-LD `Event`/`MusicEvent`, RSS/Atom, or iCalendar), the existing generic extractor may be reusable with configuration.
3. **HTML using known patterns:** Reuse a compatible platform adapter if possible. A small site-specific mapping may be enough.
4. **Unfamiliar markup or JavaScript-rendered pages:** Queue for maintainer review; a new parser or browser-rendered adapter may be needed.
5. **Restricted, inaccessible, or unreliable sources:** Mark unsupported with a reason and do not bypass restrictions or scrape private/restricted content.

**Phase 1 of this feature is request intake and admin review; automatic onboarding is optional later.** User submission must never immediately cause an unrestricted server-side fetch of the arbitrary URL.

## Security, reliability, and correctness

- Treat submitted URLs as untrusted input. Require HTTP(S), reject credentials and local/private/internal addresses, validate redirects and DNS, and restrict outbound fetching if/when automated inspection is added (SSRF prevention).
- Observe applicable site permissions, robots directives, rate limits, terms, and access restrictions.
- Validate event dates, actual venue per event, ticket links, and event/source identity. A venue calendar may list events at other venues.
- Store original source evidence and route accepted events through Encore's existing raw-ingest -> candidate -> canonicalization/deduplication pipeline.
- Do not confuse venue absence with a venue having zero qualifying upcoming shows.

## Admin backlog and Markdown export

Provide a private admin list filterable by status, city, request count, and date. An export can produce this format:

```md
# Requested Encore Venues

## Pending

- [ ] **Example Music Bar** — Boulder, CO
  - Calendar: https://example.org/events
  - Requests: 3
  - First requested: YYYY-MM-DD
  - Notes: Needs source feasibility review

## Supported

- [x] **Example Theater** — Denver, CO
  - Source ID: ...
```

The Markdown is a **snapshot export**, not the authoritative storage. Keep the database as the source of truth.

## Proposed acceptance tests

- Searching for a missing venue reveals the request action; an existing venue with no events displays a different state.
- A valid request persists and becomes visible to an authorized admin.
- Repeated requests are deduplicated and increment demand without creating duplicate queue entries.
- Invalid URLs, oversized inputs, spam/rate-limit violations, and unauthenticated/unauthorized admin actions are handled safely.
- Venue requests do not trigger arbitrary external network fetches.
- Export displays accurate pending/supported requests without leaking private information.

## Deliberately out of scope for the first PR

- A universal AI website scraper.
- Automatic acceptance and recurring crawling of every user-provided URL.
- Real-time source ingestion triggered by users without review.
- Promoter scraping or city-owned event calendars (separate Phase 3/backlog streams).

## Efficient implementation sequence

1. Small database migration + secure submission action + “Request this venue” form.
2. Basic private admin review list and Markdown export.
3. Reuse the shared ingestion framework for manually approved requests.
4. Only after collecting real submissions, consider safe automatic source-family detection for known formats/platforms.
