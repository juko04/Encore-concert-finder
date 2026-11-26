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

/**
 * Billing words a source sometimes leaves on the front of a performer name. Deliberately narrow:
 * words like "with", "and" or "plus" begin real band names (With Confidence, And So I Watch You
 * From Afar), so only unambiguous billing markers are stripped.
 */
const BILLING_PREFIX = /^(?:(?:special guests?:?|w\/|support:)\s*)+/i;

/**
 * A performer name as it should be displayed, or null when the "name" is a scrap of a broken
 * split (e.g. "27)" from "Tonewood (11, 27)"). Strips billing prefixes ("special guests …") and
 * parenthesised date notes ("(11/27)", "(11, 28)", or a dangling "(11"). Display/parse hygiene
 * only: never used to decide artist identity.
 */
export function cleanLineupName(raw: string): string | null {
  let name = raw.replace(/\s+/g, ' ').trim();
  name = name.replace(BILLING_PREFIX, '');
  // A complete trailing parenthetical that carries a digit is a date/night note, not the name.
  name = name.replace(/\s*\([^()]*\d[^()]*\)\s*$/, '');
  // A dangling "(11" left by splitting "(11, 27)" on the comma.
  name = name.replace(/\s*\([^()]*$/, '');
  name = name.trim();
  // No letters at all: a scrap such as "27)".
  if (!/\p{L}/u.test(name)) return null;
  return name;
}

/**
 * Splits a support-act string into performer names without breaking parenthesised notes apart:
 * "special guests A (11, 27), B (11, 28)" -> ["A", "B"]. Splits on commas (optionally followed
 * by "and") outside parentheses, plus any extra separators the caller passes.
 */
export function splitSupportActs(
  text: string,
  extraSeparators?: RegExp,
): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const [i, rawPart] of parts.entries()) {
    // "A, and B": the "and" after a comma is a list word, not part of B's name.
    const part = i > 0 ? rawPart.replace(/^\s*and\s+/i, '') : rawPart;
    const pieces = extraSeparators ? part.split(extraSeparators) : [part];
    for (const piece of pieces) {
      const name = cleanLineupName(piece);
      if (!name) continue;
      const key = normalizeName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/**
 * Cleans a stored lineup for display: drops scraps of broken splits, strips billing prefixes and
 * date notes from names, and removes repeats of the same performer (keeping the first, with the
 * strongest billing). Then applies the festival event-name rule above. Artist ids are kept; a
 * repeat that only differs by junk text ("special guests X (11") is dropped in favour of X.
 */
export function cleanLineupForDisplay<
  T extends { name: string; billingPosition?: string },
>(artists: readonly T[], eventName: string): T[] {
  const byKey = new Map<string, T>();
  const order: string[] = [];
  for (const artist of artists) {
    const name = cleanLineupName(artist.name);
    if (!name) continue;
    const key = normalizeName(name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, name === artist.name ? artist : { ...artist, name });
      order.push(key);
    } else if (
      artist.billingPosition === 'headliner' &&
      existing.billingPosition !== 'headliner'
    ) {
      byKey.set(key, { ...existing, billingPosition: 'headliner' });
    }
  }
  const cleaned = order.map((k) => byKey.get(k) as T);
  return withoutEventNameArtists(cleaned, eventName);
}
