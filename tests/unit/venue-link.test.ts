import { describe, expect, it } from 'vitest';
import { resolveVenueLink } from '@/lib/events/venue-link';

describe('resolveVenueLink', () => {
  it('prefers the venue website', () => {
    expect(
      resolveVenueLink({
        venueName: 'Fox Theatre',
        venueWebsite: 'https://foxtheatre.com/',
        sourceUrls: ['https://z2ent.com/events/detail/x'],
      }),
    ).toEqual({ url: 'https://foxtheatre.com/', kind: 'venue_website' });
  });

  it('falls back to a public source event page', () => {
    expect(
      resolveVenueLink({
        venueName: 'Fox Theatre',
        sourceUrls: ['https://z2ent.com/events/detail/the-floozies-2026-fox'],
      }),
    ).toEqual({
      url: 'https://z2ent.com/events/detail/the-floozies-2026-fox',
      kind: 'event_page',
    });
  });

  it('never exposes API endpoints or non-http urls', () => {
    const link = resolveVenueLink({
      venueName: 'Aggie Theatre',
      city: 'Fort Collins',
      region: 'CO',
      venueWebsite: 'javascript:alert(1)',
      sourceUrls: [
        'https://app.ticketmaster.com/discovery/v2/events.json?apikey=%5BREDACTED%5D',
        'https://api.example.com/events',
        'https://example.com/events?api_key=x',
        'not a url',
        null,
      ],
    });
    expect(link?.kind).toBe('venue_search');
    expect(link?.url).toBe(
      'https://www.google.com/search?q=Aggie%20Theatre%20Fort%20Collins%20CO%20official%20site',
    );
  });

  it('returns null without a known venue', () => {
    expect(resolveVenueLink({ venueName: 'Venue TBA' })).toBeNull();
    expect(resolveVenueLink({})).toBeNull();
  });
});
