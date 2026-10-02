# 01 — Product Vision

## Problem

Existing concert discovery products tend to answer "what events exist?" rather than "which events are worth my time and money?"

The app should combine personal music taste, actual live-event behavior, price sensitivity, venue preference, travel effort, timing, and festival lineup quality.

## Core user modes

### 1. Tonight / This Weekend
Optimized for convenience and spontaneity.

High weight:
- low price
- short distance
- good date/time fit
- venue fit
- genre/taste similarity

A user should be able to find a $10–$25 show by an unfamiliar artist if it is nearby and musically plausible.

### 2. Cheap & Nearby
Focus on:
- bars
- clubs
- small venues
- outdoor/community shows
- free events
- emerging artists

Price and distance may outrank direct artist familiarity.

### 3. Worth Planning For
Focus on:
- favorite artists
- strong affinity matches
- larger venues
- shows weeks/months away
- willingness to pay more or travel farther

### 4. Festivals & Trips
Focus on:
- multi-day festivals
- lineup depth
- day-by-day value
- pass type
- estimated total trip effort/cost
- artists the user loves vs. likely discoveries

### 5. Watching
Track:
- artist tour/show announcements
- presales
- general on-sales
- price thresholds
- festival lineup changes
- day splits / set times

## Key user profile signals

- Spotify listening signals
- manually stated favorite/liked artists
- prior concerts attended
- prior venues attended
- past ticket prices when known
- explicit feedback in the app
- saved events
- ticket-link clicks
- attendance confirmations

## Core feedback actions

Positive:
- save
- share
- ticket click
- attended
- loved it
- would see again

Negative / corrective:
- not interested
- too expensive
- too far
- bad date
- dislike artist
- dislike venue

Important: "too expensive" must not be interpreted as "bad artist recommendation."

## Recommendation explanation

Each recommendation should include concise reasons, e.g.:

- You listen to this artist frequently.
- Similar to 4 artists you like.
- This venue has scored well for you before.
- Ticket price is below your typical willingness-to-pay for this affinity level.
- Very close to you this Friday.

## Working visual concept

Home / Discover:

- This Weekend
- Cheap & Nearby
- Worth Planning For
- Festivals & Trips
- Watching

Event cards should show:

- artist/event
- venue + date
- price / price confidence
- distance or travel effort
- personalized score
- 2–3 explanation reasons
- save / tickets / dismiss actions

## Not in initial scope

- native iOS/Android apps
- resale-market trading logic
- fully autonomous purchasing
- opaque ML model trained on Spotify content
- broad authenticated social scraping
- email ingestion (deferred)
