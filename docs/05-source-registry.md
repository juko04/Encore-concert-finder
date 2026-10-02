# 05 — Source Registry

This is the initial event-source backlog. Acquisition methods may change as source capabilities and terms change.

## Aggregators / artist discovery

### Bandsintown
Use case:
- artist tracking
- broad discovery
- possible announcement/presale signals

Initial strategy:
- partnership/API if available and appropriate
- do not make MVP dependent on unapproved access

### Songkick
Use case:
- artist tracking
- concert/festival discovery

Initial strategy:
- optional future licensed/approved API
- do not make MVP dependent on access

### Spotify Live Events / Spotify artist context
Use case:
- taste-linked discovery context
- artist affinity

Initial strategy:
- Spotify Web API for permitted user music data
- do not treat Spotify as the sole event inventory

## Major primary ticketing / promoters

### Ticketmaster
Use case:
- broad baseline event inventory
- venues/artists
- on-sale/presale metadata where available

Strategy:
- API first

### Live Nation
Use case:
- major tour/promoter announcements
- presales

Strategy:
- official public pages/feeds where permitted
- note overlap with Ticketmaster inventory

### AXS
Use case:
- AEG-related ticketing and primary event pages

Strategy:
- evaluate structured public data/official integration options
- source adapter if permitted

### AEG Presents
Use case:
- tour announcements
- festivals
- venue network

Strategy:
- official public promoter/venue pages
- high-priority source adapter

## Clubs / independent / alternative ticketing

### DICE
Use case:
- clubs, DJs, electronic, indie, smaller venues

### Tixr
Use case:
- concerts, festivals, independent venues

### Etix
Use case:
- clubs, festivals, theaters, independent promoters

### See Tickets
Use case:
- festivals / independent venues / promoters

### TicketWeb
Use case:
- smaller clubs and independent shows

### Eventbrite
Use case:
- very small shows
- bars
- DIY events
- local/community festivals

### SeatGeek
Use case:
- official platform for some venues/events
- resale context where relevant

### Front Gate Tickets
Use case:
- festivals and multi-day events

Strategy:
- use indirect/API coverage when available before direct crawling

### Universe
Use case:
- smaller events/ticketing

Strategy:
- prefer existing upstream API coverage when available

## Artist-direct presale/discovery

### Seated
Use case:
- artist-direct fan alerts/presales

Strategy:
- future approved integration / discovery signal

## High-value local/official venue sources

Venue websites are critical for the product's "cheap nearby discovery" value.

Initial Colorado-oriented examples discussed:

### Red Rocks Amphitheatre
- official event calendar
- large outdoor shows

### Mission Ballroom
- major Denver venue
- AEG ecosystem

### Bluebird Theater
- AEG ecosystem / smaller room

### Cervantes' Masterpiece Ballroom
- detailed lineup/support acts
- smaller/local/electronic/jam/etc.

### Dazzle
- jazz / local / touring programming
- high value for lower-cost discovery

### Levitt Pavilion Denver
- free and ticketed outdoor music

## Festival sources

Use official festival sites as primary sources for:
- festival announcement
- lineup phases
- daily lineup splits
- pass types
- set times
- venue/location changes

Examples should be added as users encounter them. Up in the Sky / Aspen-style multi-day events are a core motivating use case.

## Promoter / venue source expansion rule

Whenever the system sees repeated canonical events associated with a promoter or venue not yet directly sourced:

1. add it to the source backlog
2. inspect for structured public calendar data
3. decide whether direct crawling materially improves freshness/coverage
4. implement only if useful and permitted

## Email/newsletters

Status: **Deferred.**

Do not implement now. See `14-future-email-ingestion.md`.
