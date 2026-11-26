/**
 * Conservative matching of a marketplace listing to one canonical event (AGENTS.md invariant 5).
 *
 * A listing attaches only when exactly one canonical event fits. Anything unclear is skipped
 * and reported, never guessed. Nothing canonical is created or edited here.
 *
 * Rules (MARKET_PRICES_PLAN.md §7):
 *  1. Candidates share the listing's venue-local date and venue (within 1 mi, or the same
 *     normalized name/alias in the same state and, when both have coordinates, within 25 mi).
 *  2. One candidate: match on a shared performer name, or title-token overlap >= 0.6.
 *  3. Several candidates (early/late shows): start within 90 minutes AND a performer match.
 *  4. Festivals: a pass matches a festival (group primary) whose dates cover the listing's
 *     date, with similar names, at the same venue or within 25 mi.
 */

import { normalizeName } from '@/lib/domain/value-objects';
import { normalizeVenueName } from '@/lib/venues/matcher';
import { isNonPublicEventTitle } from '@/lib/sources/non-events';
import type {
  CatalogEventForMatch,
  MarketListing,
  MatchOutcome,
} from './types';

export const SAME_VENUE_MILES = 1;
export const NAMED_VENUE_MAX_MILES = 25;
export const TITLE_OVERLAP_MIN = 0.6;
export const START_TOLERANCE_MINUTES = 90;

/** Marketplace add-ons that are not admission to a show. */
const NON_ADMISSION = [
  /^parking\b/i,
  /\bparking (?:pass|lot|only|permit)\b/i,
  /^(?:vip )?(?:lounge|locker|shuttle|camping)(?: pass| access| rental)?\b/i,
  /\b(?:locker rental|shuttle pass|camping pass|car camping)\b/i,
  /\bgift card\b/i,
];

/** Tokens that say nothing about which show it is. */
const NOISE_TOKENS = new Set([
  'the',
  'a',
  'an',
  'and',
  'with',
  'w',
  'feat',
  'ft',
  'featuring',
  'special',
  'guest',
  'guests',
  'presents',
  'present',
  'live',
  'tour',
  'in',
  'at',
  'concert',
  'show',
  'day',
  'days',
  'pass',
  'passes',
  'ga',
  'vip',
  'general',
  'admission',
  'single',
  'weekend',
  'night',
  'nights',
  'early',
  'late',
  'tickets',
  'ticket',
  'festival',
  'fest',
  'music',
  'event',
  'of',
  'for',
  'to',
  'tbd',
  'tba',
  'plus',
  'more',
  'all',
  'ages',
  '1',
  '2',
  '3',
  '4',
  '5',
  '1st',
  '2nd',
  '3rd',
]);

export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function distance(
  listing: MarketListing,
  event: CatalogEventForMatch,
): number | null {
  const { lat, lng } = listing.venue;
  if (
    lat === null ||
    lng === null ||
    event.venue.lat === null ||
    event.venue.lng === null
  ) {
    return null;
  }
  return haversineMiles(lat, lng, event.venue.lat, event.venue.lng);
}

export function titleTokens(value: string): Set<string> {
  return new Set(
    normalizeName(value)
      .split(' ')
      .filter((t) => t && !NOISE_TOKENS.has(t) && !/^(?:19|20)\d{2}$/.test(t)),
  );
}

/** Shared distinctive tokens over the smaller set; 0 when either side has none. */
export function titleOverlap(a: string, b: string): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function isSameVenue(
  listing: MarketListing,
  event: CatalogEventForMatch,
): boolean {
  const miles = distance(listing, event);
  if (miles !== null && miles <= SAME_VENUE_MILES) return true;

  const listingName = normalizeVenueName(listing.venue.name);
  const names = [event.venue.name, ...event.venue.aliases]
    .filter((n): n is string => Boolean(n))
    .map(normalizeVenueName);
  if (!listingName || !names.includes(listingName)) return false;

  // Same name: still require the same place. Coordinates win when both sides have them.
  if (miles !== null) return miles <= NAMED_VENUE_MAX_MILES;
  return Boolean(
    listing.venue.state &&
    event.venue.region &&
    listing.venue.state.toUpperCase() === event.venue.region.toUpperCase(),
  );
}

function performerMatch(
  listing: MarketListing,
  event: CatalogEventForMatch,
): boolean {
  const artists = new Set(
    [...event.artistNames, event.name].map(normalizeName).filter(Boolean),
  );
  return listing.performers.some((p) => artists.has(normalizeName(p)));
}

function titleMatch(
  listing: MarketListing,
  event: CatalogEventForMatch,
): boolean {
  return titleOverlap(listing.title, event.name) >= TITLE_OVERLAP_MIN;
}

function startsWithinTolerance(
  listing: MarketListing,
  event: CatalogEventForMatch,
): boolean {
  if (!listing.startsAtUtc || !event.startsAt) return false;
  const diff = Math.abs(
    Date.parse(listing.startsAtUtc) - Date.parse(event.startsAt),
  );
  return Number.isFinite(diff) && diff <= START_TOLERANCE_MINUTES * 60_000;
}

export function isNonAdmissionListing(title: string): boolean {
  return (
    isNonPublicEventTitle(title) || NON_ADMISSION.some((re) => re.test(title))
  );
}

function isFestivalTarget(event: CatalogEventForMatch): boolean {
  if (event.festivalGroupId) return event.festivalGroupPrimary;
  return event.eventKind === 'festival';
}

function matchFestival(
  listing: MarketListing,
  date: string,
  catalog: readonly CatalogEventForMatch[],
): MatchOutcome | null {
  const fits = catalog.filter((event) => {
    if (!isFestivalTarget(event)) return false;
    if (date < event.localStartDate || date > event.localEndDate) return false;
    if (titleOverlap(listing.title, event.name) < TITLE_OVERLAP_MIN)
      return false;
    if (isSameVenue(listing, event)) return true;
    const miles = distance(listing, event);
    return miles !== null && miles <= NAMED_VENUE_MAX_MILES;
  });
  if (fits.length === 1) {
    return {
      kind: 'matched',
      eventId: fits[0].id,
      method: 'festival_dates_name',
      confidence: 0.8,
    };
  }
  if (fits.length > 1) {
    return {
      kind: 'ambiguous',
      reason: 'several_festivals',
      candidateIds: fits.map((e) => e.id),
    };
  }
  return null;
}

/**
 * Match one listing against the catalog. `catalog` must already be limited to the date
 * window being synced; the matcher does its own date and venue filtering. A match on one day
 * of a festival group is attached to the group's primary event, which is what lists show.
 */
export function matchListing(
  listing: MarketListing,
  catalog: readonly CatalogEventForMatch[],
): MatchOutcome {
  const outcome = matchListingToEvent(listing, catalog);
  if (outcome.kind !== 'matched') return outcome;
  const event = catalog.find((e) => e.id === outcome.eventId);
  if (!event?.festivalGroupId || event.festivalGroupPrimary) return outcome;
  const primary = catalog.find(
    (e) =>
      e.festivalGroupId === event.festivalGroupId && e.festivalGroupPrimary,
  );
  return primary ? { ...outcome, eventId: primary.id } : outcome;
}

function matchListingToEvent(
  listing: MarketListing,
  catalog: readonly CatalogEventForMatch[],
): MatchOutcome {
  if (isNonAdmissionListing(listing.title)) {
    return { kind: 'skipped', reason: 'not_admission' };
  }
  if (!listing.localDate) return { kind: 'skipped', reason: 'date_tbd' };
  if (listing.listingCount <= 0 || listing.lowestPrice === null) {
    return { kind: 'skipped', reason: 'no_listings' };
  }
  const date = listing.localDate;

  if (listing.isFestival) {
    return (
      matchFestival(listing, date, catalog) ?? {
        kind: 'unmatched',
        reason: 'no_festival_on_dates',
      }
    );
  }

  const sameDay = catalog.filter(
    (event) => event.localStartDate === date && isSameVenue(listing, event),
  );

  if (sameDay.length === 0) {
    // A pass sold as a concert can still be a festival day.
    return (
      matchFestival(listing, date, catalog) ?? {
        kind: 'unmatched',
        reason: 'no_event_at_venue_on_date',
      }
    );
  }

  if (sameDay.length === 1) {
    const [event] = sameDay;
    if (performerMatch(listing, event)) {
      return {
        kind: 'matched',
        eventId: event.id,
        method: 'venue_date_performer',
        confidence: 0.95,
      };
    }
    if (titleMatch(listing, event)) {
      return {
        kind: 'matched',
        eventId: event.id,
        method: 'venue_date_title',
        confidence: 0.85,
      };
    }
    return {
      kind: 'unmatched',
      reason: 'performer_mismatch',
      candidateIds: [event.id],
    };
  }

  const timed = sameDay.filter(
    (event) =>
      startsWithinTolerance(listing, event) && performerMatch(listing, event),
  );
  if (timed.length === 1) {
    return {
      kind: 'matched',
      eventId: timed[0].id,
      method: 'venue_date_time_performer',
      confidence: 0.9,
    };
  }
  return {
    kind: 'ambiguous',
    reason:
      timed.length > 1
        ? 'several_shows_same_time'
        : 'several_shows_no_time_match',
    candidateIds: sameDay.map((e) => e.id),
  };
}
