/**
 * Fallback link for the "tickets" button when a show has no ticket URL.
 *
 * Order: the show's own page on the venue/promoter site (`events.official_url`, or a public
 * source page), then the venue's website, and only then a web search for the venue. The search
 * is a last resort for shows with no known page at all. API endpoints (Ticketmaster Discovery
 * etc.) are never shown to users.
 */

import { publicPageUrl } from './official-url';

export type VenueLinkKind = 'event_page' | 'venue_website' | 'venue_search';

export interface VenueLink {
  url: string;
  kind: VenueLinkKind;
}

export function resolveVenueLink(input: {
  venueName?: string | null;
  city?: string | null;
  region?: string | null;
  /** The show's page on the venue/promoter site (events.official_url). */
  officialUrl?: string | null;
  venueWebsite?: string | null;
  sourceUrls?: Array<string | null | undefined>;
}): VenueLink | null {
  for (const candidate of [input.officialUrl, ...(input.sourceUrls ?? [])]) {
    const page = publicPageUrl(candidate);
    if (page) return { url: page, kind: 'event_page' };
  }

  const website = publicPageUrl(input.venueWebsite);
  if (website) return { url: website, kind: 'venue_website' };

  const venueName = input.venueName?.trim();
  if (!venueName || venueName === 'Venue TBA') return null;
  const query = [venueName, input.city, input.region, 'official site']
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return {
    url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    kind: 'venue_search',
  };
}
