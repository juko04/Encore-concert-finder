-- Migration: 20261126010000_allow_multiple_external_ids_per_provider.sql
-- Description: An artist may hold several external ids from the same provider.
--
-- Why: Ticketmaster can list two different attractions (e.g. "Day Out With Thomas" and
-- "Thomas & Friends") that share one Spotify artist. Both resolve (by the shared Spotify id)
-- to the SAME canonical artist, which therefore has to carry two Ticketmaster ids. The old
-- uq_artist_provider UNIQUE (artist_id, provider) rejected the second id, raised 23505 inside
-- public.apply_canonicalization and aborted the whole ingestion batch.
--
-- What changes:
--   * uq_artist_provider is dropped (idempotent).
--   * uq_artist_provider_external_id UNIQUE (provider, external_id) is KEPT: one external id
--     can never belong to two artists. public.apply_canonicalization already refuses to
--     reassign an id owned by a DIFFERENT artist (persisted needs_review with reason
--     duplicate_external_id_conflict, see 20261125020000) and its insert path only relied on
--     uq_artist_provider as a side effect, so the function body needs no change: giving an
--     artist an additional id for a provider now simply inserts a row.
--   * A plain (non-unique) index keeps lookups by artist fast without the dropped constraint.

alter table public.artist_external_ids
  drop constraint if exists uq_artist_provider;

create index if not exists idx_artist_external_ids_artist_provider
  on public.artist_external_ids (artist_id, provider);
