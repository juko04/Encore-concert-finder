# Colorado Venue Sources Registry & Feasibility Audit

**Phase 3 Venue Ingestion Backlog & Source Architecture**  
*Audited: November 2026 | Milestone: Phase 3, PR #13*

---

## 1. Overview & Objectives

Phase 3 expands Encore's inventory beyond aggregators (Ticketmaster) by extracting concerts directly from official venue websites.

This registry tracks the initial feasibility audit of high-priority Colorado music venues. It documents platform architecture, extraction methods, ticketing partners, data quality, and reuse potential to inform the design of Encore's reusable venue scraping framework.

---

## 2. Audited Venues (15-Source Feasibility Assessment)

| Venue | City | Platform / CMS | Ticketing | Extraction Method | Difficulty | TM Overlap | Reuse Potential | Selected for PR #13 |
|---|---|---|---|---|---|---|---|---|
| **Cervantes' Masterpiece Ballroom & The Other Side** | Denver | WordPress (RHP Events) | Etix | Server HTML (`.rhp-event__single-event--list`) + Schema.org JSON-LD | **Low** | Very Low | **High** (RHP/Etix ecosystem) | **YES (Implemented PR #13)** |
| **Larimer Lounge** | Denver | Independent Venue Group (RHP Events) | Etix | Server HTML (`.rhpSingleEvent`) + stage detection | Low | Low | **Very High** (IVG Network) | **YES (Implemented PR #14)** |
| **Globe Hall** | Denver | Independent Venue Group (RHP Events) | Etix | Server HTML (`.rhpSingleEvent`) | Low | Low | **Very High** (IVG Network) | **YES (Implemented PR #14)** |
| **Lost Lake Lounge** | Denver | Independent Venue Group (RHP Events) | Etix | Server HTML (`.rhpSingleEvent`) | Low | Low | **Very High** (IVG Network) | **YES (Implemented PR #14)** |
| **Boulder Theater** | Boulder | Z2 Entertainment Network | AXS | Server HTML + structured event nodes | Low-Medium | Low/Med | **Very High** (Shares Z2 engine with Fox/Aggie) | Next (PR #15) |
| **Fox Theatre** | Boulder | Z2 Entertainment Network | AXS | Server HTML + structured event nodes | Low-Medium | Low/Med | **Very High** (Z2 Network) | Next (PR #15) |
| **Aggie Theatre** | Fort Collins | Z2 Entertainment Network | AXS | Server HTML + structured event nodes | Low-Medium | Low/Med | **Very High** (Z2 Network) | Next (PR #15) |
| **Velvet Elk Lounge** | Boulder | BentoBox | Etix | Server HTML + Etix event links | Low-Medium | Zero | **High** (BentoBox restaurant/lounge platform) | Subsequent |
| **Roots Music Project** | Boulder | Squarespace | Eventbrite | Server HTML (`.eventlist-event`) | Low-Medium | Zero | **High** (Squarespace events engine) | Subsequent |
| **hi-dive** | Denver | WordPress + Plot Bella | DICE | Client widget (`widgets.dice.fm`) or WP REST API | Medium | Zero | **High** (DICE platform integration) | Subsequent |
| **Dazzle Denver** | Denver | WordPress | Eventbrite / In-house | Server HTML (`.event-item`) | Medium | Zero | Medium | Subsequent |
| **Washington's** | Fort Collins | Bohemian Foundation | AXS | Server HTML | Medium | Med | Medium | Subsequent |
| **Mishawaka Amphitheatre** | Bellvue | WordPress | Etix | Server HTML | Medium | Low | Medium | Subsequent |
| **eTown Hall** | Boulder | WordPress | In-house | Server HTML | Medium | Zero | Medium | Subsequent |
| **Rosetta Hall** | Boulder | Custom / Squarespace | In-house | Server HTML | Medium-High | Zero | Low (Requires music classification filter) | Deferred |

---

## 3. Why Cervantes' Masterpiece Ballroom Was Selected for PR #13

1. **High Volume of Unique Shows:** Cervantes hosts 15–30 concerts per month across two concurrent rooms:
   - *Cervantes' Masterpiece Ballroom* (Main room, 1,000 capacity)
   - *Cervantes' Other Side* (Intimate room, 500 capacity)
2. **Minimal Ticketmaster Coverage:** The venue uses Etix for primary ticketing. The vast majority of its local and touring jam, electronic, funk, and hip-hop acts are completely missing from Ticketmaster's catalog.
3. **Structured & Accessible Data:**
   - Server-rendered HTML (`post-type-archive-rhp_events`) exposes clean, consistent CSS classes (`.rhp-event__title--list`, `.rhp-event__time-text--list`, `.eventDateList`, `.rhpVenueContent`).
   - Sibling month separators (`.rhp-events-list-separator-month`) provide unambiguous year and month context (`November 2026`, `December 2026`, etc.).
   - Detail pages contain official Schema.org `Event` JSON-LD markup with ISO 8601 timestamps and addresses.
4. **Explicit Multi-Venue / Offsite Distinctions:**
   - Cervantes occasionally presents co-promoted shows at external venues (e.g., Mission Ballroom, Ogden Theatre, Fiddlers Green Amphitheatre). The calendar explicitly names the actual host venue in `.rhpVenueContent a`. This exercises Encore's non-negotiable invariant: *"If a venue's calendar lists shows at other venues, assign the actual event location rather than the source website's venue."*
5. **Reusable Platform Pattern:**
   - The RHP Events WordPress plugin (Rockhouse Partners / Etix) is a standard platform utilized by numerous independent clubs nationwide, providing immediate template reuse.

---

## 4. Multi-Venue Platform Clusters (Future PR Efficiency)

The audit revealed three major multi-venue platform clusters in Colorado:

1. **Z2 Entertainment Cluster (AXS Ticketing):**
   - *Venues:* Boulder Theater, Fox Theatre, Aggie Theatre.
   - *Architecture:* Unified calendar feed on `z2ent.com/events`. One parser implementation can onboard all three venues simultaneously with venue-filtering options.
2. **Independent Venue Group Cluster (Etix Ticketing) — Implemented PR #14:**
   - *Venues:* Larimer Lounge, Globe Hall, Lost Lake Lounge.
   - *Architecture:* Standardized Rockhouse Partners (RHP Events) WordPress plugin with unified `.rhpSingleEvent` and `.rhp-events-list-separator-month` structure, Etix ticketing, stage identification (Larimer Lounge, Treehouse, Campground, Skihouse), and year-boundary tracking across both list and grid views. Implemented via shared `IndependentVenueAdapter` and `parseIndependentVenueEvents`.
3. **BentoBox & Squarespace Cluster (Indie / DIY):**
   - *Venues:* Velvet Elk Lounge (BentoBox), Roots Music Project (Squarespace).
   - *Architecture:* Standard CMS event structures with high statewide portability for smaller bars and intimate listening rooms.

---

## 5. Explicit Deferrals for Later PRs

1. **City-Owned & Community Calendars:** Municipal calendars (Boulder Downtown, Visit Boulder, Longmont Museum, Lafayette Art Night Out) contain non-music events (farmer markets, art walks) requiring strict classification filters. Preserved for a dedicated community-calendar milestone.
2. **Promoter Scrapers (AEG Presents, Live Nation):** Promoter feeds are optional secondary sources. They will be evaluated only after measuring direct venue coverage.
3. **Missing Venue User Request Intake:** Handled via the proposed `venue_source_requests` pipeline (`docs/research/encore_future_pr_venue_source_requests.md`), deferred to after the core framework is established.
