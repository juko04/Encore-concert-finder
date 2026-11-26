/**
 * Lineup hygiene: some sources list the event itself as a performer ("Ultra Music Festival" is a
 * Ticketmaster attraction on the festival's own listing). It is not an act and must not appear in
 * "with …" lines or as a lineup performer. Only applied to big bills (festival-sized lineups): a
 * concert named after its headliner ("Nickelback" with two openers) must keep that headliner.
 */

import { normalizeName } from '@/lib/domain/value-objects';
import { festivalBaseName } from './festival-groups';

/** Lineups at least this large are festival bills, where an artist named like the event is the event. */
export const FESTIVAL_BILL_MIN_ARTISTS = 6;

export function isEventNameArtist(
  artistName: string,
  eventName: string,
): boolean {
  const artist = normalizeName(artistName);
  if (!artist) return false;
  return (
    artist === normalizeName(eventName) ||
    artist === normalizeName(festivalBaseName(eventName))
  );
}

export function withoutEventNameArtists<T extends { name: string }>(
  artists: readonly T[],
  eventName: string,
): T[] {
  if (artists.length < FESTIVAL_BILL_MIN_ARTISTS) return [...artists];
  const kept = artists.filter((a) => !isEventNameArtist(a.name, eventName));
  return kept.length > 0 ? kept : [...artists];
}
