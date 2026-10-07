# 10 — API and Module Plan

## Proposed repository shape

```text
app/
  discover/
  weekend/
  festivals/
  watchlist/
  event/[id]/
  artist/[id]/
  profile/

components/
  EventCard.tsx
  FestivalCard.tsx
  MatchScore.tsx
  PriceBadge.tsx
  RecommendationReasons.tsx
  LineupView.tsx

lib/
  domain/
  repositories/
    catalog-repository.ts
    source-repository.ts
    raw-ingest-repository.ts
    event-candidate-repository.ts
  recommendations/
  pricing/
  spotify/
  geo/
  deduplication/
  entity-resolution/
  provenance/

sources/
  api/
    ticketmaster.ts
  promoters/
    aeg.ts
    livenation.ts
  ticketing/
    axs.ts
    dice.ts
    tixr.ts
    etix.ts
  venues/
    ...
  festivals/
    ...

workers/
  crawl-source.ts
  sync-ticketmaster.ts
  normalize-events.ts
  resolve-candidates.ts
  update-prices.ts
  calculate-recommendations.ts
  evaluate-watch-rules.ts

supabase/
  config.toml
  migrations/
  seed.sql

tests/
  fixtures/
  source-adapters/
```

## External/API routes

Candidate routes:

```text
GET  /api/feed
GET  /api/events/:id
GET  /api/festivals/:id
GET  /api/artists/:id
GET  /api/venues/:id

GET  /api/recommendations/weekend
GET  /api/recommendations/cheap
GET  /api/recommendations/planning
GET  /api/recommendations/festivals

POST /api/events/:id/save
POST /api/events/:id/feedback

GET  /api/watchlist
POST /api/watchlist
DELETE /api/watchlist/:id

GET  /api/profile/music
POST /api/history/concert

GET  /api/spotify/connect
GET  /api/spotify/callback
```

Implementation may prefer server actions for some authenticated UI interactions; the domain/service layer should remain reusable.

## Persistence boundary

UI components must not own Supabase/database query logic. Server-rendered routes,
route handlers, and later workers use repository abstractions for catalog reads and
persistence. Phase 1 establishes those repositories; a broader business-service
layer may be added above them only when later phases need reusable business
orchestration.

## Domain services

Potential service boundaries:

### EventService
- fetch canonical event
- merge candidate
- query upcoming events

### RecommendationService
- build user context
- calculate feature values
- rank event candidates
- produce explanation reasons

### ArtistAffinityService
- compute/update user artist affinity

### SourceService
- source registry
- fetch scheduling
- health tracking

### DeduplicationService
- candidate similarity
- canonical merge suggestion

### WatchService
- create/update watch rules
- evaluate triggers

### FestivalService
- day score
- lineup score
- pass comparison

## Internal event types

Define strict TypeScript domain types separate from database row types.

Examples:
- `CanonicalEvent`
- `EventCandidate`
- `FestivalEvent`
- `Performance`
- `TicketOption`
- `RecommendationFeatures`
- `RecommendationResult`
- `SourceEvidence`

This prevents UI code from depending directly on database implementation details.
