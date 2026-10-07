# 14 — Future Email / Newsletter Ingestion

## Status

**Deferred by current product decision.**

Do not build this into the initial architecture as a dependency.

Revisit it when working on:
- presales
- promoter announcement freshness
- alert quality
- missing-source coverage
- user integrations

## Why it may be valuable later

Promoter/venue newsletters can contain:
- early show announcements
- presale windows
- ticket links
- lineup updates
- festival announcements
- occasionally user-specific/private presale information

## Preferred privacy-preserving concept

Rather than requiring broad inbox access, consider a unique forwarding address per user, e.g.:

```text
<user-alias>+events@product-domain.example
```

Users could forward selected newsletters or create their own email filters.

Alternative later option:
- explicit Gmail/Outlook integration with narrowly scoped search/label rules, only if users want it and platform permissions make sense.

## Pipeline

```text
forwarded/authorized message
   -> private raw message record
   -> event candidate extraction
   -> corroborate against first-party web/ticket sources
   -> canonical public event + private user metadata
```

## Privacy boundary

Public event facts:
- artist
- venue
- date
- public ticket URL

Private user-specific facts:
- personalized presale code
- private offer link
- the fact that a particular user received a message

Never publish private email-derived access codes into the global event database.

## Reminder for future agents

When implementing alerts, presales, or source-gap analysis, explicitly ask whether this deferred feature should be activated.
