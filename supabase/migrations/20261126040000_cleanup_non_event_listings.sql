-- Migration: 20261126040000_cleanup_non_event_listings.sql
-- Description: Venue calendars publish placeholder entries ("Closed for Private Event", holiday
-- hours, private rentals) that were ingested as shows. The ingestion coordinator now rejects them
-- (reason not_a_public_event; lib/sources/non-events.ts). This removes the ones already stored.
-- Patterns mirror lib/sources/non-events.ts (strict whole-title / leading-phrase forms), applied
-- to the lower-cased title with punctuation collapsed. Raw ingests and candidates are immutable
-- audit records and are NOT touched. Idempotent.

delete from public.events e
where regexp_replace(lower(e.name), '[^a-z0-9 ]+', ' ', 'g') ~ any (array[
  '^\s*closed\s*$',
  '^\s*closed\s+(for|on|until|today|tonight|due|all day|this)\y',
  '\yclosed for (a |an |the )?(private|holiday|maintenance|renovations?|buy ?out|inventory|cleaning)\y',
  '^\s*private\s+(event|party|function|rental|buy ?out|booking|show)(\s+(\d.*|at .*|for .*|only|all ages|tonight|today))?\s*$',
  '^\s*(venue\s+)?(buy ?out|rental|private rental)(\s+available)?\s*$',
  '^\s*((holiday|regular|new)\s+)?hours(\s+of\s+operation)?\s*$',
  '^\s*holiday\s+hours\y',
  '^\s*(no\s+(show|event|shows|events)(\s+(tonight|today))?|dark(\s+(night|day))?|venue\s+dark)\s*$'
]);

-- Pseudo-artists created from those titles (same patterns) that no event or user preference uses.
delete from public.artists a
where regexp_replace(lower(a.name), '[^a-z0-9 ]+', ' ', 'g') ~ any (array[
  '^\s*closed\s*$',
  '^\s*closed\s+(for|on|until|today|tonight|due|all day|this)\y',
  '\yclosed for (a |an |the )?(private|holiday|maintenance|renovations?|buy ?out|inventory|cleaning)\y',
  '^\s*private\s+(event|party|function|rental|buy ?out|booking|show)(\s+(\d.*|at .*|for .*|only|all ages|tonight|today))?\s*$',
  '^\s*(venue\s+)?(buy ?out|rental|private rental)(\s+available)?\s*$',
  '^\s*((holiday|regular|new)\s+)?hours(\s+of\s+operation)?\s*$',
  '^\s*holiday\s+hours\y',
  '^\s*(no\s+(show|event|shows|events)(\s+(tonight|today))?|dark(\s+(night|day))?|venue\s+dark)\s*$'
])
  and not exists (select 1 from public.event_artists ea where ea.artist_id = a.id)
  and not exists (select 1 from public.user_artist_preferences p where p.artist_id = a.id);
