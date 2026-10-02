# Project Context from Product Conversation

This document captures the intent and decisions that led to the current architecture so future contributors and AI agents do not need the original chat history.

## Origin of the idea

The product began as a personal concert finder that should combine several signals rather than acting as a generic event-search website.

The desired experience is to answer questions such as:

- What is something inexpensive and fun I could see this weekend?
- What nearby bar, club, outdoor, or small-venue show is worth trying even if I do not know the artist yet?
- Which medium-priced concerts are worthwhile because I genuinely like the artist?
- Which favorite or major artists should I plan for months in advance?
- When are tickets, presales, or important announcements likely to drop?
- Which festivals or multi-day events are actually worth the ticket, travel, and time commitment?

The core concept is therefore **personalized value**, not merely event availability.

## Personalization inputs discussed

The system should eventually learn from:

- Spotify listening behavior and top artists/tracks, within Spotify platform rules
- manually entered and/or imported past concerts
- venues previously attended and liked/disliked
- ticket prices previously paid
- saved events
- event-page views and ticket clicks
- explicit feedback such as:
  - not interested
  - too expensive
  - too far
  - bad date
  - do not like this artist
  - do not like this venue

A negative price response should reduce willingness-to-pay for that context, not incorrectly teach the system that the user dislikes the artist.

## Product modes discussed

The application should expose different intents using the same underlying event inventory and recommendation engine:

- **Tonight / This Weekend** — convenient, spontaneous events
- **Cheap & Nearby** — inexpensive local discovery, including unknown artists
- **Worth Planning For** — stronger artist matches and larger events farther in the future
- **Festivals & Trips** — multi-day events and travel-worthy experiences
- **Watching** — artists/events being monitored for announcements, on-sales, price changes, or lineup changes

Possible intent controls discussed include:

- something chill tonight
- cheap adventure
- take me somewhere new
- artists I actually know
- date-night concert
- show me the big stuff coming up

These should alter ranking weights rather than create separate recommendation systems.

## Pricing philosophy

There should not be one universal maximum ticket price.

Willingness-to-pay should increase with artist affinity and context. For example:

- a favorite artist can remain a strong recommendation at a relatively higher ticket price
- a moderately liked artist should require a lower price
- an unknown artist should generally require a low price, strong genre fit, appealing venue, or high convenience

The app should explain why an event is considered good value for that user.

## Recommendation philosophy

Start with a transparent ranking formula rather than opaque machine learning.

Candidate features include:

- artist affinity
- genre/related-artist affinity
- price value relative to personalized willingness-to-pay
- venue affinity
- distance/travel effort
- timing/convenience
- discovery/novelty value
- special-event value
- festival lineup depth

The exact weights are tunable and may differ by product mode.

Every recommendation should be explainable with a short human-readable reason, not only a score.

## Festival and multi-day requirement

Festivals are first-class entities, not concerts with a longer duration.

The data model should support:

- event/festival
- festival days
- performances
- artist billing position
- stages
- set times when available
- weekend and single-day passes
- VIP/GA/etc. ticket options
- lineup changes over time

Festival ranking should consider:

- strongest artist matches
- depth of liked/recommended artists
- day-by-day lineup quality
- ticket/pass value
- travel effort/cost
- uniqueness of the event

Eventually the product may recommend that a single day is better value than a full festival pass when the user's strongest matches are concentrated on one day.

## Event acquisition strategy

The project should **not depend on one API**.

Use a hybrid ingestion architecture:

1. APIs and structured feeds where available
2. official promoter pages
3. official venue calendars
4. official festival pages
5. ticketing sites where useful and permitted
6. approved social signals for discovery/verification
7. email/newsletter ingestion later

All inputs should become `event_candidates`, then pass through normalization, entity resolution, deduplication, corroboration, and canonical event creation.

Raw ingests should be retained with provenance so parsing can be re-run after scraper fixes.

## Scraping strategy

Prefer, in order:

1. API / RSS / ICS / JSON-LD / schema.org / embedded structured JSON
2. standard HTTP + HTML parsing
3. browser automation such as Playwright only when required

Do not bypass access controls, CAPTCHAs, paywalls, or anti-bot systems.

Social platforms should initially be treated mainly as announcement signals. Verify important event facts against official artist, venue, promoter, festival, or ticketing sources when possible.

## Event sources already identified

The user supplied or discussed the following source families:

- Bandsintown
- Songkick
- Seated
- Spotify Live Events / Spotify artist context
- Ticketmaster
- Live Nation
- AXS
- AEG Presents
- DICE
- Tixr
- Etix
- See Tickets
- TicketWeb
- Eventbrite
- SeatGeek
- Front Gate Tickets
- Universe

Official venue and festival calendars are especially important for local, inexpensive, or niche events that aggregators may miss.

Examples discussed during planning included Red Rocks, Mission Ballroom, Bluebird Theater, Cervantes, Dazzle, and Levitt Pavilion Denver. These are useful examples, **not a final decision that the MVP must launch in Colorado**. The initial launch geography remains an open product decision.

## Email decision

Promoter/newsletter email ingestion was explored because it could expose early announcements and presale information. The user decided not to make it part of the initial implementation.

**Keep reminding the project owner about email ingestion when work reaches alerts, presales, announcement freshness, or missing event coverage.**

Do not repeatedly push it during unrelated work.

## Technical direction chosen

The agreed initial direction is:

- real web application, not one static HTML file
- Next.js
- TypeScript
- Tailwind CSS
- PostgreSQL via Supabase
- Supabase Auth
- Spotify integration for taste data
- Ticketmaster Discovery API as an initial baseline inventory source
- TypeScript source adapters/crawlers
- HTTP + Cheerio/structured parsing first
- Playwright only when necessary
- scheduled workers/jobs for ingestion and monitoring
- responsive PWA before native iOS/Android apps
- GitHub repository as the shared source of truth

## Multi-agent development decision

The development environment is expected to include VS Code plus multiple AI assistants, including ChatGPT Personal, Antigravity, and Claude.

Instead of trying to make agents directly chat with or control one another, use the repository as shared state:

- specifications
- issues
- branches
- commits
- pull requests
- tests
- `AI_HANDOFF.md`

Only one agent should own a given implementation task/branch at a time. Other agents can review it.
