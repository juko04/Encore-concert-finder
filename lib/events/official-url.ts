/**
 * The public page for a show on the venue's or promoter's own website (e.g.
 * https://www.velvetelklounge.com/event/november-27-dj-kelly-kix/). Stored as `events.official_url`
 * so the site can link to it when there is no ticket link; `event_sources` (where the scraped page
 * URL is also kept) is service-role only and cannot be read for public pages.
 *
 * Only venue and promoter sources qualify: an aggregator/ticketing source's URL is either an API
 * request or a ticket page that already lands in `primary_ticket_url`.
 */

/** Source types whose source URL is the show's own page on the venue/promoter site. */
const EVENT_PAGE_SOURCE_TYPES = new Set(['venue', 'promoter']);

/** A browsable http(s) page; API endpoints and URLs carrying API keys are rejected. */
export function publicPageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host.startsWith('api.') || host.startsWith('app.ticketmaster.')) {
    return null;
  }
  for (const key of parsed.searchParams.keys()) {
    if (/^api[_-]?key$/i.test(key)) return null;
  }
  return parsed.toString();
}

/** The candidate's own event page, when it came from a venue or promoter website. */
export function eventPageUrlFromProvenance(
  provenance:
    | { sourceType?: string | null; sourceUrl?: string | null }
    | null
    | undefined,
): string | null {
  if (!provenance?.sourceType) return null;
  if (!EVENT_PAGE_SOURCE_TYPES.has(provenance.sourceType)) return null;
  return publicPageUrl(provenance.sourceUrl);
}
