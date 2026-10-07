# 09 — Security, Privacy, and Compliance

## Principles

- collect the minimum user data needed
- separate public event data from private user data
- never store secrets in source control
- make source provenance explicit
- prefer coarse location where exact location is unnecessary

## Location

For recommendations, an approximate home point or selected city/radius is sufficient initially.

Do not require or expose an exact home address.

## Spotify

Store only data required for the product and follow current Spotify developer/platform rules.

Do not train an external ML model on Spotify content if prohibited by applicable platform terms.

OAuth tokens:
- encrypted at rest where supported
- never logged
- never committed
- revocable

## Scraping

Public availability does not imply unrestricted automated use.

Per source:
- review applicable terms
- respect robots directives where applicable
- use reasonable rates
- do not bypass security/access controls
- stop/reassess if blocked rather than escalating bypass techniques

## Social media

Avoid authenticated browser scraping as a core architecture.

Prefer:
- official APIs
- official public source pages
- public links surfaced through first-party artist/promoter/venue sites

## Raw content

Raw ingests may contain tracking parameters or incidental data.

Retention policy should eventually:
- minimize unnecessary personal data
- strip obvious secrets/tokens from stored URLs where feasible
- define expiration for raw HTML if long-term retention is unnecessary

## User deletion

Design so a user can delete:
- account
- taste profile
- feedback
- attendance history
- watchlist
- tokens

Public canonical event records do not need deletion when a user leaves.

## Secrets

Use environment variables / secret managers for:
- Supabase service role key
- Spotify client secret
- Ticketmaster/API keys
- crawler credentials if any approved authenticated integration exists later

Add `.env*` to `.gitignore` except example templates.
