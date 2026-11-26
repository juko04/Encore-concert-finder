/**
 * Fallback link for the event detail "tickets" button when no ticket URL is known.
 *
 * Order: the venue's own website, then a public source page for this event (e.g. the
 * venue/promoter calendar entry it was scraped from), then a web search for the venue.
 * API endpoints (Ticketmaster Discovery etc.) are never shown to users.
 */

export type VenueLinkKind = 'venue_website' | 'event_page' | 'venue_search';

export interface VenueLink {
  url: string;
  kind: VenueLinkKind;
}

function publicHttpUrl(value: string | null | undefined): string | null {
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
  // Keys (even redacted placeholders) mean this is an API request, not a page.
  for (const key of parsed.searchParams.keys()) {
    if (/^api[_-]?key$/i.test(key)) return null;
  }
  return parsed.toString();
}

export function resolveVenueLink(input: {
  venueName?: string | null;
  city?: string | null;
  region?: string | null;
  venueWebsite?: string | null;
  sourceUrls?: Array<string | null | undefined>;
}): VenueLink | null {
  const website = publicHttpUrl(input.venueWebsite);
  if (website) return { url: website, kind: 'venue_website' };

  for (const candidate of input.sourceUrls ?? []) {
    const page = publicHttpUrl(candidate);
    if (page) return { url: page, kind: 'event_page' };
  }

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
