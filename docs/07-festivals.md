# 07 — Festivals and Multi-Day Events

Festivals are first-class event experiences, not ordinary concerts with a long date range.

## Festival-specific data

Need:
- start/end dates
- event days
- stages
- artist performances
- billing position
- ticket/pass types
- single-day passes
- lineup phases
- daily lineup split
- set times
- location/travel context

## Lineup match

For each performance/artist:
- compute user artist affinity
- optionally infer related-artist / genre match
- weight headliners/subheadliners more than lower billing, while still valuing lineup depth

Output should include:
- favorite artists count
- known/liked artist count
- likely discoveries
- lineup match score

## Example artist-level interpretation

```text
95–100 favorite / must-see
80–94 strong match
60–79 likely match
40–59 plausible discovery
<40 weak/unknown
```

## Festival score

Possible feature groups:

```text
Lineup Match
Lineup Depth
Ticket/Pass Value
Travel Effort
Venue/Destination Appeal
Date Convenience
Uniqueness / Rarity
```

Do not use normal-concert weights unchanged.

## Day-by-day scoring

If single-day tickets exist, score each day independently.

Example UX:

```text
Friday lineup match:   48%
Saturday lineup match: 92%

Recommendation explanation:
Most of your strongest matches play Saturday. A Saturday pass may provide better value than the weekend pass.
```

Do not make definitive financial decisions for the user; show the comparative information.

## Total trip cost

Later-stage estimate may include:
- ticket/pass
- known fees
- driving/fuel estimate
- lodging estimate
- parking/transit

Display assumptions explicitly.

## Lineup lifecycle

Store festival updates as evolving states:

```text
festival announced
phase 1 lineup
phase 2 lineup
single-day splits
new artist added
pass change
set times released
```

This enables meaningful alerts.

## Schedule builder (later)

When set times exist:
- rank performances by user affinity
- identify conflicts
- suggest an itinerary
- allow user overrides

## Trip mode

Potential travel buckets:
- local
- <100 miles
- 100–300 miles
- overnight/flight-worthy

Travel willingness is user-specific.
