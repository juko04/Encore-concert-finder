/**
 * Loaded, validated venue guides (researched Nov 2026).
 *
 * Source data lives in data/venue-guides.json, a trimmed conversion of
 * docs/research/venue-guides/batch-1..4.json (same wording, same source URLs).
 */

import raw from './data/venue-guides.json';
import { parseVenueGuides } from './validate';

const parsed = parseVenueGuides(raw);

export const VENUE_GUIDES = parsed.guides;
/** Validation problems found while loading (empty for the shipped data). */
export const VENUE_GUIDE_ISSUES = parsed.issues;
/** ISO date the research was done, e.g. 2026-11-24. */
export const VENUE_GUIDES_RESEARCHED_ON = parsed.researchedOn;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Nov 2026" style label for the as-of note. */
export function formatResearchedOn(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : null;
}
