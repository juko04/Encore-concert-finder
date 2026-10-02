# 06 — Recommendation Engine

## Philosophy

Start with an explainable, tunable ranking model.

Do not build an opaque ML recommender before the product has enough real user feedback to justify one.

## Core event score

Illustrative normal-concert weights:

```text
Artist Match          35%
Price Value           20%
Distance              15%
Venue Match           10%
Date Convenience      10%
Discovery Potential    5%
Specialness/Novelty    5%
```

Weights must vary by user intent/mode.

## Artist affinity

Potential inputs:
- Spotify short-term top artists/tracks
- Spotify medium-term signals
- Spotify long-term signals
- recent listening
- manual favorite/like rating
- attendance history
- would-see-again history
- saved events

Conceptually normalize to 0–100.

## Dynamic willingness-to-pay

Price value should be relative to artist/event affinity.

Example curve:

```text
Affinity ~95 -> comfortable price maybe $80–$100
Affinity ~75 -> maybe $50–$65
Affinity ~50 -> maybe $25–$35
Affinity ~20 -> maybe $10–$20
```

Exact curve is user-specific and learned over time.

A user's explicit defaults seed the curve:
- max spontaneous price
- typical concert price
- favorite-artist ceiling

## Price-value feature

Price value should consider:
- current known ticket price
- fees if known
- user's affinity-adjusted willingness-to-pay
- event rarity/specialness
- price history later

Do not confuse "expensive" with "bad recommendation."

## Distance / effort

Early version:
- straight-line or route distance from approximate home location
- user radius preference

Later:
- drive time
- parking/transit difficulty
- overnight travel
- trip cost

## Venue affinity

Inputs:
- prior attendance count
- user ratings
- indoor/outdoor preferences
- standing/seated preferences
- repeated positive feedback

## Discovery potential

Unknown artists can rank strongly when:
- genre/artist-neighbor match is strong
- venue fit is good
- price is low
- distance is short
- timing is convenient

This is essential to "cheap adventure" mode.

## Mode-specific weights

### This Weekend

Possible weights:
```text
Artist Match      25
Price Value       25
Distance          20
Date Convenience  15
Venue Match       10
Discovery          5
```

### Cheap Adventure

Possible weights:
```text
Price Value       35
Distance          25
Genre/Taste       15
Venue Match       15
Artist Match       5
Discovery          5
```

### Worth Planning For

Possible weights:
```text
Artist Match      45
Specialness       15
Price Value       15
Venue Match       10
Distance           5
Date Convenience  10
```

These are starting points only.

## Recommendation explanation

Store or compute feature contributions so the UI can state reasons.

Example:

```text
94% match
- You listen to this artist frequently.
- You've liked this venue before.
- Price is below your usual range for an artist you like this much.
```

## Feedback updates

Examples:

- `dont_like_artist` -> reduce artist affinity / related recommendation confidence
- `too_expensive` -> lower price tolerance for similar affinity tier, not music affinity
- `too_far` -> adjust effort/travel preference
- `dont_like_venue` -> lower venue affinity
- `saved` -> positive event-level signal
- `attended + loved` -> strong artist + venue + live-event preference signal

## Evaluation

Before ML, measure:
- save rate
- ticket-click rate
- dismiss rate
- too-expensive rate
- attendance confirmations
- recommendation diversity
- % recommendations with sufficient source confidence

Do not optimize only for clicks; preserve useful discovery and trust.
