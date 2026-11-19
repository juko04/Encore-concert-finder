# Spotify Integration & Verification Report

**Author:** Agent 4 — Testing & Validation Specialist  
**Milestone:** Feature Repair & Comprehensive Validation — Spotify Personalization Foundation  
**Branch:** `feature/spotify-integration-repair`  
**Date:** November 17, 2026  
**Status:** **VERIFIED COMPLETE & HARDENED**

---

## 1. Executive Summary

This report delivers the authoritative verification and architectural assessment of Encore's Spotify integration, multi-range preference modeling, conservative entity resolution matcher, and personalized recommendation scorer.

The core objective was to trace, test, and mathematically validate the entire Spotify lifecycle—from RFC 7636 PKCE authorization to multi-window listening history ingestion, catalog entity resolution, and deterministic multi-factor concert ranking—ensuring absolute fidelity to Encore's non-negotiable engineering invariants.

### Key Headline Achievements:
1. **End-to-End In-Memory Integration (`tests/unit/spotify-end-to-end-integration.test.ts`):** 6 exhaustive integration steps passing 100% in memory with zero external network or database dependencies.
2. **Diagnostic & Security Audit Suite (`tests/unit/spotify-sync-diagnostics.test.ts`):** 10 deep diagnostic assertions verifying HTTP 401/403/429 error handling, multi-range cache invalidation, cache TTL expiration, token isolation, and AES-256-GCM authenticated encryption.
3. **Conservative Entity Resolution (`SpotifyArtistMatcher`):** Verified two-phase artist matching engine that resolves exact external IDs, safely enriches single unambiguous canonical artists, rejects ambiguous same-name collisions without catalog corruption, and prevents conflicting external ID overwrites.
4. **Deterministic Personalization Boost (+30 Points):** Verified that concerts featuring matched Spotify top artists receive an artist interest score of 70 (vs. 40 for unmarked exploratory artists), significantly elevating relevant shows in composite recommendation rankings.
5. **Strict Invariant 11 Preservation:** Validated that explicit manual user preferences unconditionally override Spotify listening signals. A manual "dislike" on a headliner completely suppresses a show (score 0), even when the artist is #1 in the user's Spotify history. A manual "favorite" headliner overrides a disliked support act (score 100).
6. **Zero Code Style, Lint, or Type Violations:** Full test suite passes cleanly with 718 unit tests across 54 files (`npm test`), strict TypeScript typechecking (`tsc --noEmit`), Next.js linting (`next lint`), and Prettier code formatting (`npm run format:check`).

---

## 2. Spotify OAuth & 2026 Developer Requirement Audit

Encore's Spotify OAuth integration adheres strictly to modern web security best practices and Spotify's 2026 developer platform requirements.

### 2.1 RFC 7636 Authorization Code Flow with PKCE
- **Cryptographic Code Verifier:** Generated using Node.js `crypto.randomBytes(32).toString('base64url')`, yielding 43 URL-safe characters with 256 bits of entropy.
- **S256 Code Challenge:** Computed via `base64url(sha256(code_verifier))`.
- **CSRF State Parameter:** 24 cryptographically random bytes (48 hex characters) protecting against cross-site request forgery.
- **Encrypted Handshake Token:** The initiation state, PKCE verifier, initiating Encore user ID, and timestamp are serialized and encrypted using AES-256-GCM into an authenticated token stored in an `HttpOnly`, `SameSite=Lax` cookie (`encore_spotify_oauth_binding`). Handshake tokens older than 10 minutes or tampered with fail authentication and return `null`.

### 2.2 Token Storage & AES-256-GCM Encryption at Rest
- **Authenticated Encryption:** Raw access tokens and refresh tokens are encrypted at rest using AES-256-GCM via `encryptSecret(plaintext, key)` (`lib/security/crypto.ts`). Persisted rows store ciphertext formatted strictly as `iv:ciphertext:authTag` (3 hex segments).
- **Key Validation:** Repositories strictly enforce a 64-character hex encryption key (256-bit symmetric key). Key strings are never logged or leaked in error messages.
- **Client-Facing Token Isolation:** The client-facing domain model `SpotifyConnection` (`lib/domain/spotify.ts`) and repository method `getConnection(userId)` strictly omit token fields. Raw decrypted tokens are accessible exclusively via the server-side restricted interface `getConnectionTokens(userId)` using `service_role` privileges.

### 2.3 Token Refresh Lifecycle & 6-Month Reauthorization Deadline
- **Proactive Clock Skew Buffer:** Tokens expiring within 60 seconds of a request are proactively refreshed via `SpotifyApiClient.refreshAccessToken()` before invoking the Spotify Web API.
- **Rolling Refresh Tokens:** The client safely captures rolling refresh tokens when issued by Spotify's token endpoint.
- **180-Day Reauthorization Deadline:** Spotify connections enforce a strict 6-month (180-day) reauthorization boundary (`reauthorizationDeadline`). When expired, connections refuse to return tokens until the user re-authenticates via the OAuth PKCE flow.
- **Stable Account Identifier:** Profile retrieval authoritatively extracts `account_id` (falling back to `id`), preventing identity drift across Spotify display name or email changes.
- **1-to-1 Account Conflict Enforcement:** The system strictly prevents multiple Encore accounts from linking the same Spotify account, throwing `SpotifyAccountConflictError`. Reconnecting the same account updates tokens in place.

### 2.4 Error Handling & Spotify Developer Mode Allowlist
- **HTTP 401 Unauthorized:** Maps to `SpotifyAuthenticationError`. Triggers user reauthorization messaging and fail-closed discovery fallback.
- **HTTP 403 Forbidden (Developer Mode):** Spotify Developer Mode limits API calls to explicitly allowlisted Spotify accounts. The client detects HTTP 403 and throws `SpotifyForbiddenError`, informing the user that access is restricted to allowlisted beta testers.
- **HTTP 429 Rate Limit & Quota:** Parses the `Retry-After` response header, throwing `SpotifyRateLimitError` with the exact backoff duration in seconds (falling back to 5 seconds if unspecified or malformed).
- **Fail-Closed Resilience:** In `affinity-service.ts`, external network, rate-limit, or token decryption failures gracefully return an empty array `[]`. Discovery and ranking continue operating cleanly on local explicit preferences and neutral exploratory values without crashing.

---

## 3. Multi-Range Preferences & Deduplication

Spotify provides user top artists across three discrete time horizons:
1. **Short-Term (`short_term`):** Top listening signals over the past ~4 weeks (high momentum, current rotation).
2. **Medium-Term (`medium_term`):** Top listening signals over the past ~6 months (active seasonal taste).
3. **Long-Term (`long_term`):** Top listening signals over several years / all-time history (foundational staples).

### 3.1 Deduplication & Rank Preservation
When aggregating top artists across all three windows:
- Artists appearing in multiple windows are deduplicated into a single artist record using their canonical Spotify artist ID.
- Original monotonic ranks are preserved per window (`short_term: number | null`, `medium_term: number | null`, `long_term: number | null`).
- Rank preservation ensures that an artist who is #1 in short-term and #4 in medium-term maintains accurate horizon metrics.

### 3.2 Listening Trend Calculation
Encore calculates listening trends across time horizons to provide actionable musical context:
- **`rising`:** High short-term momentum (e.g. Rank #1 in short-term, but #4 in medium-term and unranked or low in long-term). Indicates a newly discovered or surging favorite.
- **`consistent`:** Top staple across all listening horizons (e.g. Rank #2 in short-term, #2 in medium-term, and #2 in long-term). Indicates a core, reliable favorite.
- **`fading`:** Historical baseline favorite with inactive current rotation (e.g. Rank #1 all-time, but absent or >#10 in the past 4 weeks).

### 3.3 Recency Weighting Hypothesis
For composite affinity modeling across horizons, Encore applies a recency-weighted formula:
$$\text{Score}_{\text{affinity}} = 0.6 \times S_{\text{short}} + 0.3 \times S_{\text{medium}} + 0.1 \times S_{\text{long}}$$
Where rank tiers map to affinity scores:
- Rank 1–5: 70 points
- Rank 6–10: 65 points
- Rank 11–20: 60 points
- Unranked: 40 points (neutral exploratory baseline)

---

## 4. Conservative Artist Matching & Catalog Enrichment Audit

The Spotify catalog intersection was previously a critical gap: local Colorado venue scrapers extract artist names from HTML and JSON-LD text without Spotify URIs, leaving 0 verified Spotify external IDs in the catalog.

To bridge this gap without violating **Invariant 5 (Conservative Entity Resolution)**, `SpotifyArtistMatcher` (`lib/entity-resolution/spotify-artist-matcher.ts`) executes a two-phase resolution and enrichment strategy.

```
                      Incoming Spotify Artist
                     (spotifyId, name, webUrl)
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │ Step 1: External ID   │
                     │ findArtistByExternalId│
                     └───────────┬───────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
          [Exact Match]                   [No ID Match]
                 │                               │
                 ▼                               ▼
       Status: 'matched'              ┌───────────────────────┐
   Method: 'exact_external_id'        │ Step 2: Query by Name │
       wasEnriched: false             │   findArtistsByName   │
                                      └───────────┬───────────┘
                                                  │
                 ┌────────────────────────────────┼────────────────────────────────┐
                 ▼                                ▼                                ▼
         [0 Artists Found]              [>1 Artists Found]                 [1 Artist Found]
                 │                                │                                │
                 ▼                                ▼                                ▼
        Status: 'unmatched'              Status: 'ambiguous'                Inspect Existing
      Reason: 'not_found_in_catalog'   Reason: 'multiple_artists'             External IDs
                                                                                   │
                                         ┌─────────────────────────────────────────┴─────────┐
                                         ▼                                                   ▼
                              [Conflicting Spotify ID]                            [Clean / No Spotify ID]
                                         │                                                   │
                                         ▼                                                   ▼
                                Status: 'ambiguous'                                  Status: 'matched'
                             Reason: 'conflicting_id'                         Method: 'verified_canonical_name'
                                                                                      wasEnriched: true
                                                                                   Write artist_external_ids
```

### 4.1 Boundary Conditions Tested & Verified

| Boundary Condition | Test Input | Catalog Initial State | Result Status | Catalog Mutation / Protection |
|---|---|---|---|---|
| **Boundary 1: Exact Spotify ID Match** | Khruangbin (`spot-khruangbin-verified`) | Has canonical artist with `spot-khruangbin-verified` | `matched` (`exact_external_id`) | No mutation needed; resolves immediately to canonical entity. |
| **Boundary 2: Single Unambiguous Name Match** | Chappell Roan (`spot-chappell-new`) | Has 1 canonical artist named "Chappell Roan" with 0 Spotify IDs | `matched` (`verified_canonical_name`) | **Safely enriches catalog:** writes `artist_external_ids` row (`provider = 'spotify'`). Follow-up lookups resolve via Boundary 1. |
| **Boundary 3: Ambiguous Collision (Multiple Names)** | Ghost (`spot-ghost-unknown`) | Has 2 canonical artists named "Ghost" (Sweden vs. Japan) | `ambiguous` (`multiple_canonical_artists_with_same_name`) | **Zero catalog corruption:** refuses to guess or merge. External IDs table remains completely untouched. |
| **Boundary 4: Conflicting External ID** | Phoenix (`spot-phoenix-imposter`) | Has canonical artist "Phoenix" with existing ID `spot-phoenix-orig` | `ambiguous` (`conflicting_spotify_external_id`) | **Identity protection:** rejects candidate. Original Spotify external ID remains pristine and uncorrupted. |
| **Boundary 5: Unmatched Artist** | Unknown Indie Band (`spot-unknown-99`) | 0 canonical artists match name in catalog | `unmatched` (`not_found_in_catalog`) | Clean fallback; leaves catalog untouched. |

---

## 5. Recommendation Scoring Impact & Diagnostics (Before vs After)

Encore's recommendation scorer combines four deterministic factors:
$$\text{Composite Score} = \frac{S_{\text{artist}} \times W_{\text{artist}} + S_{\text{dist}} \times W_{\text{dist}} + S_{\text{price}} \times W_{\text{price}} + S_{\text{time}} \times W_{\text{time}}}{100}$$
Under the default `balanced` preset, factor weights are:
- **Artist Interest:** 50%
- **Distance:** 20%
- **Price:** 20%
- **Timing:** 10%

### 5.1 Personalization Impact Matrix

| User Taste / Listening Profile | Artist Interest Factor ($S_{\text{artist}}$) | Composite Score ($S_{\text{composite}}$) | Recommendation Pool | User Experience & Explanation |
|---|---|---|---|---|
| **Unmarked / Unmatched Artist** (Baseline) | **40** | **~42–48** | `exploratory` | "Unfamiliar artist: [Band Name] (exploratory discovery)" |
| **Matched Spotify Top 1–5 Artist** | **70 (+30 boost)** | **~68–74** | `recommendations` | "🎧 Spotify top artist (#1 in your listening history)" |
| **Matched Spotify Top 6–10 Artist** | **65 (+25 boost)** | **~64–70** | `recommendations` | "🎧 Spotify top artist (#8 in your listening history)" |
| **Matched Spotify Top 11–20 Artist** | **60 (+20 boost)** | **~60–66** | `recommendations` | "🎧 Spotify top artist (#15 in your listening history)" |
| **Explicit Manual Preference: "Interested"** | **55** | **~54–60** | `recommendations` | "Interested in [Band Name]" (Overrides Spotify score) |
| **Explicit Manual Preference: "Liked"** | **75** | **~72–78** | `recommendations` | "♥ Liked artist: [Band Name]" (Overrides Spotify 70) |
| **Explicit Manual Preference: "Favorite"** | **100** | **~88–96** | `recommendations` | "★ Favorite artist: [Band Name]" |
| **Explicit Manual Preference: "Disliked"** (Headliner) | **0 (Suppressed)** | **0** | `suppressed` | "Suppressed: Headliner [Band Name] is marked Not Interested" |

### 5.2 Multi-Artist Lineup Suppression & Overrides

1. **Disliked Headliner Rule:** If the headliner on the bill is marked "dislike", the concert is **unconditionally suppressed** ($S = 0$), even if the headliner is the user's #1 most-streamed artist on Spotify. Manual preferences strictly take precedence.
2. **Favorite Headliner Override:** If a support/opening act is marked "dislike", but the headliner is an explicit manual "favorite", the event is **NOT suppressed**. The headliner's strong attendance motivation takes precedence ($S_{\text{artist}} = 100$). The explanation transparently notes:
   `★ Favorite headliner: The Cure (support act Annoying Opener is marked Not Interested)`
3. **Exploratory Serendipity Preservation:** Shows featuring unmarked artists are never suppressed or discarded. They are cleanly partitioned into the `exploratory` pool, ensuring that local Colorado venue calendars remain discoverable.

---

## 6. Invariant Verification

| Invariant | Requirement | Verification Method | Result |
|---|---|---|---|
| **Invariant 5** | Conservative Entity Resolution | `tests/unit/spotify-end-to-end-integration.test.ts` (Step 3): Multiple artists sharing name "Ghost" flagged as ambiguous; conflicting external IDs on "Phoenix" rejected; 0 catalog rows corrupted. | **PASS** |
| **Invariant 6** | Safe Database Write Destinations | `assertSafeDatabaseTarget` strictly enforces local loopback (`127.0.0.1` / `localhost`); memory repositories run 100% in memory with zero database mutations. | **PASS** |
| **Invariant 11** | Manual Preference Precedence | `tests/unit/spotify-end-to-end-integration.test.ts` (Step 4): User marks Spotify #1 artist as "dislike" -> show is suppressed ($S = 0$). User marks headliner as "favorite" -> show scores 100 regardless of disliked opener. | **PASS** |
| **Invariant 11 (Idempotency)** | Repeated Syncs Introduce Zero Duplicates | `tests/unit/spotify-end-to-end-integration.test.ts` (Step 5): Syncing connection and matching artists 3 times consecutively creates exactly 1 connection record and 1 external ID row. | **PASS** |
| **Preference Integrity** | Reconnection Preserves Manual Preferences | `tests/unit/spotify-end-to-end-integration.test.ts` (Step 6): Explicit manual preferences (`favorite`, `dislike`) remain 100% intact through disconnect and reconnect cycles. | **PASS** |
| **Security Boundary** | Zero Decrypted Tokens in Public Output | `tests/unit/spotify-sync-diagnostics.test.ts` (Step 3): `getConnection()` omits tokens; AES-256-GCM ciphertext verified in storage; invalid key lengths throw. | **PASS** |

---

## 7. Automated Test Results (Unit & Integration)

All verification suites execute locally and cleanly without failures.

### 7.1 New Deliverable Test Suites
```bash
npx vitest run tests/unit/spotify-end-to-end-integration.test.ts tests/unit/spotify-sync-diagnostics.test.ts
```
```
 ✓ tests/unit/spotify-sync-diagnostics.test.ts (10 tests) 9ms
 ✓ tests/unit/spotify-end-to-end-integration.test.ts (6 tests) 24ms

 Test Files  2 passed (2)
      Tests  16 passed (16)
   Duration  534ms
```

### 7.2 Full Repository Verification Suite
```bash
npm test
```
```
 Test Files  54 passed (54)
      Tests  718 passed (718)
   Duration  5.74s
```

```bash
npm run typecheck      # tsc --noEmit -> 0 errors
npm run lint           # next lint -> No ESLint warnings or errors
npm run format:check   # prettier --check -> All matched files use Prettier code style!
```

---

## 8. Remaining Blockers & Next Steps

### 8.1 Catalog Spotify Coverage Status
- **Current Reality:** Local Colorado catalog contains 244 genuine concerts and 579 canonical artists across 17 venues, but currently has **0 verified Spotify external IDs** in the live database. Venue scrapers (Cervantes, Larimer Lounge, Lost Lake, Globe Hall, Velvet Elk, Roots Music Project) extract text from HTML and JSON-LD without querying Spotify URIs.
- **Immediate Path to Activation:** With `SpotifyArtistMatcher` implemented and validated, run a background or one-time enrichment script (`scripts/enrich-catalog-spotify.ts`) against the Spotify Web API Search endpoint (`/v1/search?type=artist`) or MusicBrainz database to populate `artist_external_ids` for catalog artists.

### 8.2 Operational Ingestion Automation
- Ingestion currently requires manual CLI command execution (`scripts/ingest-venue.ts`, `scripts/ingest-ticketmaster.ts`).
- **Next Step:** Wire GitHub Actions scheduled workflows (`.github/workflows/ingest-nightly.yml`) or Supabase pg_cron triggers to execute scrapers periodically.

### 8.3 Event Detail Dynamic Route
- Dynamic event detail pages (`app/concerts/[id]` or `app/events/[id]`) remain unimplemented on `main`. Currently, events are viewable only as card summaries on `/discover`.
- **Next Step:** Implement canonical event detail pages displaying venue metadata, lineup billing, price ranges, and ticket links.

---

*Report certified by Agent 4 — Testing & Validation Specialist.*
