# 02 — System Architecture

## High-level architecture

```text
                    External Sources
     ┌────────────────────────────────────────┐
     │ Ticketmaster API                        │
     │ Promoter websites                       │
     │ Venue calendars                         │
     │ Festival websites                       │
     │ Ticketing-platform public pages         │
     │ Approved social/API signals             │
     │ (Email ingestion later)                 │
     └──────────────────┬─────────────────────┘
                        │
                        v
              Ingestion / Source Adapters
                        │
                        v
                  Raw Ingest Store
                        │
                        v
                  Event Candidates
                        │
            ┌───────────┴───────────┐
            │                       │
      Entity Resolution       Verification
            │                       │
            └───────────┬───────────┘
                        v
                Canonical Event Store
                        │
      ┌─────────────────┼──────────────────┐
      │                 │                  │
      v                 v                  v
  Price History   Recommendation      Watch/Alert Engine
                       Engine
      │                 │                  │
      └─────────────────┼──────────────────┘
                        v
                 Next.js Web / PWA
                        │
                        v
                       User
```

## Application layers

### Web frontend

Responsibilities:
- onboarding
- Spotify connection
- discovery feeds
- event/festival details
- feedback
- watchlist management
- user preferences

Recommendation:
- Next.js App Router
- React Server Components where useful
- client components only where interaction requires them
- Tailwind CSS

### Application API / service layer

Responsibilities:
- authenticated user operations
- feed endpoints
- event details
- feedback ingestion
- watch rules
- Spotify sync orchestration

Early MVP may use Next.js route handlers/server actions.

As background jobs grow, keep domain logic in reusable modules so workers can call
the same services. UI components do not own database query logic: server-rendered
routes/handlers use repository abstractions and return DTOs to the UI. A broader
business-service layer can be added above repositories when later phases need it.

### Database

PostgreSQL/Supabase.

Store:
- canonical public event data
- raw ingestion metadata
- candidate/source records
- user taste profile
- user preferences
- feedback and attendance
- price snapshots
- watch rules

### Worker layer

Responsibilities:
- scheduled source crawling
- Ticketmaster synchronization
- normalization
- deduplication
- entity resolution
- price snapshots
- recommendation feature recalculation
- watch-rule evaluation

Do not depend on HTTP requests from a user's browser to keep data current.

### Source adapter layer

Every event source should implement a common contract.

Conceptual TypeScript interface:

```ts
interface EventSourceAdapter {
  id: string;
  name: string;
  sourceType: 'api' | 'promoter' | 'venue' | 'festival' | 'ticketing' | 'social';
  fetch(context: CrawlContext): Promise<RawIngest[]>;
  parse(rawIngests: RawIngest[]): Promise<EventCandidate[]>;
}
```

Source-specific details stay inside adapters.

## Deployment direction

Initial:
- Vercel: Next.js web/API
- Supabase: PostgreSQL/Auth
- worker scheduling: Vercel Cron and/or Supabase scheduled/edge jobs where adequate

If crawling becomes heavier:
- move workers to a dedicated Node runtime/container service
- preserve the same queue/job interfaces

## Queue/job abstraction

Even if a formal queue is not used on day one, design workers as discrete idempotent jobs:

- `sync-ticketmaster-region`
- `crawl-source`
- `parse-raw-ingest`
- `resolve-event-candidate`
- `merge-canonical-event`
- `snapshot-ticket-price`
- `recompute-user-affinity`
- `recompute-event-scores`
- `evaluate-watch-rules`

## Observability

Need from early versions:
- structured logs
- crawler last-success time
- records found / new / changed
- parser error rate
- source health status
- job failures
- duplicate merge audit

Avoid silent crawler failure.
