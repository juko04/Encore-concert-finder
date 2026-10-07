# Non-Blocking Cleanup Items & Accepted Technical Debt

This document tracks accepted non-blocking cleanup items and deferred architectural optimizations. It ensures that known refinements are documented in a durable location without cluttering the active operational handoff.

---

## 1. Post-Phase-1 Non-Blocking Cleanup Items

These items were identified during Phase 1 independent reviews and CI runs. They do not block current functionality but should be addressed during tooling and Phase 2 preparation:

### 1.1 CI Runner Pinning & Actions Modernization
- **Status:** Evaluated and runner pinned in `chore/repository-context-cleanup`.
- **Context:** GitHub Actions displayed non-blocking warnings regarding Node 20 runtime deprecation and future changes to `ubuntu-latest`.
- **Action Taken:** Pinned CI workflow to `runs-on: ubuntu-24.04` to ensure reproducible Docker, PostgreSQL, and Node 24 behavior.
- **Future Action:** Monitor official GitHub Actions (`actions/checkout`, `actions/setup-node`) for major runtime bumps once GitHub finalizes runner node defaults.

### 1.2 Trusted Artist External ID Enrichment on Existing Matches
- **Status:** Deferred to Phase 2 / Ingestion expansion.
- **Context:** When a candidate matches an existing canonical artist, `ArtistResolver` currently returns the resolved `artistId`. If the incoming candidate carries *additional* trusted external IDs (e.g. MusicBrainz or Ticketmaster IDs) not yet registered on that artist, they are not yet merged into `artist_external_ids`.
- **Future Action:** Implement an atomic enrichment path in `apply_canonicalization` to insert newly learned external IDs for already-matched artists when no conflict exists.

### 1.3 Discover Catalog Source Attribution
- **Status:** Deferred to UI refinement.
- **Context:** The `/discover` catalog page displays canonical event cards, but source provenance attribution (e.g. "Sourced from Ticketmaster" or "Direct Venue Calendar") is not yet rendered on individual cards.
- **Future Action:** Display source badges on event cards to provide human-readable provenance and transparency.

### 1.4 Unknown Venue Display Behavior
- **Status:** Deferred to UI refinement.
- **Context:** In fallback display cases where venue information is missing or pending resolution, UI components should display a clear "Venue TBA / Unknown" badge rather than substituting the event title in the venue slot.

---

## 2. Accepted Phase 1 Architectural Deferrals

The following items were explicitly reviewed during Phase 1 and deferred:

1. **N+1 Catalog Query Optimization:**  
   `listEvents` queries artists and ticket links for returned events. Safe to defer until catalog query volume warrants a consolidated SQL join, materialized view, or GraphQL query.
2. **Advanced Venue Aliasing Infrastructure:**  
   Bidirectional suffix and alias normalization is implemented in application code; a dedicated alias registry table and alias maintenance pipeline is deferred to future operator tooling.
3. **Manual Resolution Operator UI:**  
   `needs_review` statuses and reasons are stored in `candidate_resolutions`, but the human-in-the-loop review interface is deferred to a dedicated admin phase.
4. **Raw-Ingest Retention & Deletion Policy:**  
   Defining the retention window and pruning cron for raw ingest bodies is deferred to Phase 4 / production operations.
5. **Object-Storage Provider & Payload Size Threshold:**  
   Small payloads are stored in PostgreSQL with a nullable `external_storage_ref` column in `raw_ingests`; choosing S3/GCS/R2 and offloading large HTML payloads is deferred until high-volume scraping begins.
