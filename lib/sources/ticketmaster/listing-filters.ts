/**
 * Ticketmaster listing hygiene + genre extraction (pure, no I/O).
 *
 * Ticketmaster lists ticket *products* next to real shows, e.g. the event
 * "Club Level Seating: Nickelback" with an attraction "Club Level Seating: Ball Arena".
 * Those are seat packages for a show, not performers: they must never become artists, and a
 * package title must never become the canonical show title when the real listing
 * ("Nickelback: Everything Under The Sun Tour") exists.
 */

import type { TicketmasterClassification } from './types';

/**
 * Package / hospitality prefixes. Matches at the START of a title or attraction name, followed by
 * a colon or dash separator, so "Club Level Seating: Nickelback" matches but an artist whose
 * name merely contains one of these words ("The Parking Lot Band") does not.
 */
const PACKAGE_PREFIX =
  /^\s*(?:club(?:\s+level)?\s+seat(?:s|ing)|premium\s+seat(?:s|ing)|vip(?:\s+(?:package|packages|experience|upgrade|ticket|tickets|parking|seating|lounge))?|parking|hospitality|suites?|loges?|meet\s*(?:&|and)\s*greet|fast\s*lane|ticket\s+package)\s*[:\-–—]\s*(.+?)\s*$/i;

export interface TicketPackageTitle {
  isPackage: boolean;
  /** The title without the package prefix (equals the input when not a package). */
  baseTitle: string;
}

export function splitTicketPackageTitle(
  title: string | null | undefined,
): TicketPackageTitle {
  const raw = (title ?? '').trim();
  const m = PACKAGE_PREFIX.exec(raw);
  if (!m || !m[1]) return { isPackage: false, baseTitle: raw };
  return { isPackage: true, baseTitle: m[1].trim() };
}

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * True when a Ticketmaster "attraction" is not a performer: a seating/VIP/parking product, or
 * simply the venue itself ("Ball Arena", "Club Level Seating: Ball Arena").
 */
export function isNonArtistAttraction(
  attractionName: string | null | undefined,
  venueName?: string | null,
): boolean {
  const name = (attractionName ?? '').trim();
  if (!name) return false;
  if (PACKAGE_PREFIX.test(name)) return true;
  const venue = venueName ? norm(venueName) : '';
  if (venue) {
    const n = norm(name);
    if (n === venue) return true;
    // "<anything>: <venue name>" is a venue product ("Premium Parking: Ball Arena").
    const afterColon = name.includes(':')
      ? norm(name.split(':').pop() ?? '')
      : '';
    if (afterColon && afterColon === venue && /^(?:[^:]+):/.test(name)) {
      return true;
    }
  }
  return false;
}

/** Ticketmaster placeholder values that carry no genre information. */
const IGNORED_GENRES = new Set([
  'undefined',
  'other',
  'miscellaneous',
  'music',
  'various',
  'unknown',
]);

/**
 * Genre strings (genre first, then sub-genre) from the PRIMARY classification of an event or
 * attraction, e.g. ["Dance/Electronic", "House"]. Placeholder values are dropped, order and
 * uniqueness are preserved, and nothing is ever inferred when Ticketmaster supplies none.
 */
export function extractTicketmasterGenres(
  classifications: readonly TicketmasterClassification[] | null | undefined,
): string[] {
  if (!Array.isArray(classifications) || classifications.length === 0) {
    return [];
  }
  const primary =
    classifications.find((c) => c?.primary === true) ?? classifications[0];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of [primary?.genre?.name, primary?.subGenre?.name]) {
    const value = typeof part === 'string' ? part.trim() : '';
    if (!value) continue;
    const key = value.toLowerCase();
    if (IGNORED_GENRES.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Normalized name of the primary classification's segment ("Music", "Miscellaneous", ...). */
export function primaryClassificationSegment(
  classifications: readonly TicketmasterClassification[] | null | undefined,
): string | null {
  if (!Array.isArray(classifications) || classifications.length === 0) {
    return null;
  }
  const primary =
    classifications.find((c) => c?.primary === true) ?? classifications[0];
  const name = primary?.segment?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

const RELIGIOUS_GENRE = /\b(?:religious|gospel|christian|worship)\b/i;

/**
 * Ticketmaster attraction records are shared by name and are sometimes mis-classified: the
 * generic attraction "House Party" is filed under Religious / Gospel although the listings that
 * carry it are club nights classified as a non-music segment (Miscellaneous, "Fairs & Festivals").
 *
 * Conservative, general rule (no event names): a performer-level Religious/Gospel genre is NOT
 * trusted when the event's own primary classification contradicts it, i.e. the event has a
 * genre that is not religious AND its segment is not Music. A Religious artist on a Music
 * event (a gospel act billed as Pop) keeps its genre, and nothing is dropped when the event
 * carries no classification at all (nothing contradicts it). Other genres are never touched.
 */
export function trustedAttractionGenres(
  attractionGenres: readonly string[],
  eventClassifications:
    readonly TicketmasterClassification[] | null | undefined,
): string[] {
  if (!attractionGenres.some((g) => RELIGIOUS_GENRE.test(g))) {
    return [...attractionGenres];
  }
  const eventGenres = extractTicketmasterGenres(eventClassifications);
  const segment = primaryClassificationSegment(eventClassifications);
  const eventIsNonMusic = segment !== null && segment.toLowerCase() !== 'music';
  const eventContradicts =
    eventGenres.length > 0 &&
    !eventGenres.some((g) => RELIGIOUS_GENRE.test(g)) &&
    eventIsNonMusic;
  if (!eventContradicts) return [...attractionGenres];
  return attractionGenres.filter((g) => !RELIGIOUS_GENRE.test(g));
}
