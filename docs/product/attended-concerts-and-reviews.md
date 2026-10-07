# Attended Concerts & Multi-Dimensional Experience Signals

This document records the approved long-term product direction for recording attended concerts, logging concert history, and capturing multi-dimensional feedback signals.

> [!NOTE]
> **Status:** Approved product direction for post-MVP / future phase. Schema changes, review tables, and recommendation scoring integration are deferred and NOT part of the Project Hub foundation or Phase 2.

---

## 1. Product Vision: The Post-Concert Journey

Encore is designed not just for discovering upcoming shows, but for understanding a music fan's real live-music journey over time.

A core user workflow in future phases will be:
1. **Discovering** an event in Encore (or importing past concert attendance).
2. **Attending** the concert.
3. **Marking the event as attended** in the user's personal history.
4. **Capturing differentiated feedback** on the experience.
5. **Enriching taste models** so future recommendations become significantly more accurate.

---

## 2. Differentiated Experience Signals (Non-Collapsed Scoring)

Most concert or ticketing apps either do not collect reviews or collapse everything into a single 1-to-5 star rating. This destroys critical nuance:
- A user may love an artist's recorded albums, but found their live vocals lacking or setlist disappointing.
- A user may have had a transcendent experience with the headliner, but hated the venue's acoustic echo, expensive parking, or rude staff.
- A user may love a historic intimate club regardless of who is playing on stage.

Encore explicitly treats concert feedback as **four distinct, non-collapsing signals**:

```text
┌────────────────────────────────────────────────────────┐
│                   CONCERT ATTENDANCE                   │
└────────────────────────────────────────────────────────┘
          │                   │                  │
          ▼                   ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ CONCERT OVERALL  │ │   ARTIST LIVE    │ │      VENUE       │
│ "How good was    │ │ "How much do I   │ │ "How much do I   │
│ this night/show?"│ │ want to see them │ │ like attending   │
│                  │ │ live again?"     │ │ shows here?"     │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### Signal Dimensions:
1. **Recorded Music Affinity ($\neq$ Live Affinity):**
   * *Meaning:* Streaming listens, album favorites, genre taste.
   * *Example:* "I listen to Radiohead every week."
2. **Live Artist Affinity ($\neq$ Recorded Affinity):**
   * *Meaning:* The desire to see that specific artist on stage again in the future.
   * *Example:* "Their live light show and energy blew me away, I will never miss them on tour."
3. **Venue Affinity ($\neq$ Artist Affinity):**
   * *Meaning:* Preference for physical space, acoustics, sightlines, ease of transit, neighborhood vibe, and comfort.
   * *Example:* "Red Rocks is worth traveling for; that 15,000-cap arena has terrible sound."
4. **Individual Concert Rating:**
   * *Meaning:* The specific snapshot rating of that particular night's performance, setlist, and atmosphere.

### Invariant:
Long-term recommendation engines must preserve the distinction:
$$\text{Music Affinity} \neq \text{Live Artist Affinity} \neq \text{Venue Affinity} \neq \text{Event Rating}$$

---

## 3. Future Observatory & Analytics Integration

The Encore Project Hub / Learning Hub will eventually visualize the owner's personal live-music history using these structured attendance signals:
- **Lifetime concert counts and year-over-year trends**
- **Venue frequency and loyalty breakdown**
- **Top live artists vs. top streamed artists**
- **Ticket price distribution (cheapest vs. most expensive)**
- **Interactive geographic map of attended venues**
- **Festival attendance vs. club show breakdown**

---

## 4. Deferral Boundaries

- **Database Migrations:** No attendance or review tables are created during Phase 1 cleanup or Project Hub foundation.
- **UI Exposure:** The `/discover` catalog and `/hub` observatory remain strictly read-only regarding user attendance during this foundation slice.
- **Specification:** When attendance and personal concert history work begins, a dedicated phase specification will define the schema (`user_event_attendance`, `user_venue_reviews`, `user_artist_live_reviews`), privacy boundaries, and recommendation feedback loops.

