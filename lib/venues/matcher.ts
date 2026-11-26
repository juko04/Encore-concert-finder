/**
 * Venue matcher: maps an event's venue name (+ city/region) to a researched
 * venue guide. Conservative by design: a wrong venue guide is worse than no
 * guide, so ambiguous or out-of-area matches return null.
 */

import { VENUE_GUIDES } from './guides';
import type { VenueGuide, VenueGuideMatch, VenueMatchKind } from './types';

/** Lowercase, strip accents/apostrophes/punctuation, drop a leading "the". */
export function normalizeVenueName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´']/g, '')
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

const DENVER_METRO = new Set([
  'denver',
  'englewood',
  'greenwood village',
  'morrison',
  'lakewood',
  'aurora',
  'littleton',
  'golden',
  'centennial',
  'arvada',
  'westminster',
  'commerce city',
  'wheat ridge',
  'edgewater',
  'glendale',
  'cherry hills village',
  'lone tree',
]);

/**
 * Collapses city names into comparable groups. Venues just outside Denver
 * (Red Rocks in Morrison, Gothic in Englewood) are often listed as "Denver".
 */
export function cityGroup(city: string): string {
  const normalized = normalizeVenueName(city);
  if (DENVER_METRO.has(normalized)) return 'denver-metro';
  return normalized;
}

interface GuideKey {
  key: string;
  isCanonical: boolean;
}

function guideKeys(guide: VenueGuide): GuideKey[] {
  const keys: GuideKey[] = [
    { key: normalizeVenueName(guide.name), isCanonical: true },
  ];
  for (const alias of guide.aliases) {
    const key = normalizeVenueName(alias);
    if (key && !keys.some((k) => k.key === key)) {
      keys.push({ key, isCanonical: false });
    }
  }
  return keys;
}

/**
 * Splits "Larimer Lounge - Treehouse" / "Larimer Lounge (Campground)" into the
 * head ("Larimer Lounge") and the trailing sub-space description.
 */
function splitHead(raw: string): { head: string; suffix: string | null } {
  const match = /^(.*?)(?:\s+[-–—]\s+|\s*[,:/|(]\s*)(.+)$/.exec(raw);
  if (!match || !match[1].trim()) return { head: raw, suffix: null };
  return { head: match[1], suffix: match[2].replace(/\)\s*$/, '').trim() };
}

function cityAllowed(
  guide: VenueGuide,
  city: string | null | undefined,
  region: string | null | undefined,
): boolean {
  const eventRegion = region?.trim().toUpperCase();
  if (eventRegion && eventRegion !== guide.region.toUpperCase()) return false;
  if (city && city.trim()) {
    return cityGroup(city) === cityGroup(guide.city);
  }
  // Unknown city: only trust the match when the region is explicitly the
  // guide's region, since names like "Fox Theatre" exist in many states.
  return eventRegion === guide.region.toUpperCase();
}

export interface VenueMatchInput {
  venueName: string | null | undefined;
  city?: string | null;
  region?: string | null;
}

const KIND_RANK: Record<VenueMatchKind, number> = {
  exact: 0,
  alias: 1,
  'sub-space': 2,
};

export function matchVenueGuide(
  input: VenueMatchInput,
  guides: readonly VenueGuide[] = VENUE_GUIDES,
): VenueGuideMatch | null {
  const rawName = input.venueName?.trim();
  if (!rawName) return null;

  const full = normalizeVenueName(rawName);
  if (!full || full === 'venue tba') return null;

  const { head, suffix } = splitHead(rawName);
  const headKey = suffix ? normalizeVenueName(head) : null;
  // "Fox Theatre - Boulder" is the venue plus its city, not a sub-space.
  const suffixIsLocation = suffix
    ? [input.city, input.region].some(
        (loc) => loc && normalizeVenueName(loc) === normalizeVenueName(suffix),
      )
    : false;

  const matches: VenueGuideMatch[] = [];
  for (const guide of guides) {
    if (!cityAllowed(guide, input.city, input.region)) continue;

    let best: VenueMatchKind | null = null;
    for (const { key, isCanonical } of guideKeys(guide)) {
      let kind: VenueMatchKind | null = null;
      if (full === key) {
        kind = isCanonical ? 'exact' : 'alias';
      } else if (headKey && headKey === key) {
        kind = suffixIsLocation
          ? isCanonical
            ? 'exact'
            : 'alias'
          : 'sub-space';
      }
      if (kind && (best === null || KIND_RANK[kind] < KIND_RANK[best])) {
        best = kind;
      }
    }
    if (best) matches.push({ guide, kind: best });
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  // Two different guides at the same rank means we cannot tell which venue
  // this is; show no guide rather than the wrong one.
  if (
    matches.length > 1 &&
    KIND_RANK[matches[0].kind] === KIND_RANK[matches[1].kind]
  ) {
    return null;
  }
  return matches[0];
}
