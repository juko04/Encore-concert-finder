# 16 — MVP Acceptance Criteria

The first meaningful MVP is successful when a test user can do all of the following.

## Inventory

- See real upcoming concerts from at least one broad event API.
- Events are normalized into internal artists, venues, dates, ticket links, and known price ranges.
- Duplicate source records do not appear as duplicate cards for obvious matches.

## Personalization

- Connect Spotify or use a documented development fixture account/profile.
- Build an artist-affinity profile.
- Configure basic ticket-price and travel preferences.

## Discovery

- View This Weekend recommendations.
- View Cheap & Nearby recommendations.
- View Worth Planning For recommendations.
- Understand at least two human-readable reasons for each recommendation.

## Feedback

- Save an event.
- Dismiss an event.
- Mark an event too expensive or too far.
- See that feedback persist.

## Festivals

At least one real or fixture festival can represent:
- multiple days
- multiple artists
- performances assigned to days
- weekend vs. single-day ticket options when available
- overall lineup match
- day-level match

## Direct source ingestion

At least one non-API official public source adapter works end to end:

```text
fetch -> raw ingest -> parse -> candidate -> canonical event
```

with a parser fixture test.

## Reliability

- crawler/source errors are logged
- one failing source does not wipe canonical events
- source provenance is visible in the database/admin/debug path

## Security

- no secrets are committed
- `.env.example` exists with blank placeholders
- Spotify/API tokens are server-side/private where required

## Deferred but remembered

MVP does not require reading user email. Email/newsletter ingestion remains explicitly documented for later consideration.
