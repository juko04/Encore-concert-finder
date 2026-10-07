# 08 — Alerts and Watchlists

## Watchable targets

- artist
- event
- festival
- venue (future)
- promoter (future)

## Core triggers

Artist/event:
- new nearby show announced
- presale announced
- general on-sale announced
- price at/below threshold
- meaningful price drop
- event canceled/rescheduled

Festival:
- festival announced
- early-bird on sale
- lineup announced
- favorite artist added
- daily lineup released
- single-day passes released
- set times released

## Discovery digest

Avoid individual push spam for weak/low-stakes recommendations.

A better pattern:

> 3 inexpensive shows this weekend strongly match your taste.

## Notification channels

MVP:
- in-app
- email notification may be used as an outbound channel if simple, but this is separate from reading/ingesting the user's inbox

Later:
- web push / PWA push
- native push if a native app is ever built

## Watch-rule evaluation

Worker flow:

```text
new/changed canonical event
    -> find relevant watch rules
    -> compare prior state
    -> determine if trigger is meaningful
    -> create notification record
    -> deliver through enabled channel
```

Avoid repeatedly alerting the same unchanged condition.

## Presale data

Presale metadata may come from:
- primary ticket provider
- official artist/promoter/venue page
- festival site
- future email ingestion

Private/personal presale codes, if email ingestion is later implemented, must be stored as user-private data rather than public event metadata.
