/**
 * Non-event listings (pure, source-agnostic).
 *
 * Venue calendars (and ticketing feeds) sometimes publish placeholder entries such as
 * "Closed for Private Event" or "Holiday hours". They are not public shows: they must never become
 * canonical events. The patterns are deliberately strict (whole-title or leading-phrase forms) so
 * real acts with similar words in their names ("Closed Casket Activities", "Private Eyes",
 * "No Show Ponies") are never dropped.
 *
 * Keep in sync with supabase/migrations/20261126040000_cleanup_non_event_listings.sql.
 */

const NON_EVENT_PATTERNS: readonly RegExp[] = [
  // "Closed" on its own, or "Closed for/on/until/today/tonight/due ..."
  /^closed$/,
  /^closed (?:for|on|until|today|tonight|due|all day|this)\b/,
  // "... closed for (a) private/holiday/maintenance/buyout ..."
  /\bclosed for (?:a |an |the )?(?:private|holiday|maintenance|renovations?|buy ?out|inventory|cleaning)\b/,
  // Private bookings / rentals / buyouts
  /^private (?:event|party|function|rental|buy ?out|booking|show)(?: (?:\d.*|at .*|for .*|only|all ages|tonight|today))?$/,
  /^(?:venue )?(?:buy ?out|rental|private rental)(?: available)?$/,
  // Hours / dark-night notices
  /^(?:holiday |regular |new )?hours(?: of operation)?$/,
  /^holiday hours\b/,
  /^(?:no (?:show|event|shows|events)(?: tonight| today)?|dark(?: night| day)?|venue dark)$/,
];

function normalize(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the listing title is a closure/private-booking/hours notice, not a public show. */
export function isNonPublicEventTitle(
  title: string | null | undefined,
): boolean {
  if (typeof title !== 'string') return false;
  const t = normalize(title);
  if (!t) return false;
  return NON_EVENT_PATTERNS.some((re) => re.test(t));
}

export const NON_EVENT_REASON = 'not_a_public_event';
