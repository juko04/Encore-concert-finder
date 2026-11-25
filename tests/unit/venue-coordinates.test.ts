import { describe, expect, it } from 'vitest';
import {
  getCandidateVenueCoordinates,
  parseVenueCoordinates,
} from '@/lib/sources/ticketmaster/venue-location';
import { parseTicketmasterEvent } from '@/lib/sources/ticketmaster/parser';
import { fillVenueCoordinates } from '@/lib/sources/ticketmaster/ingestion-pipeline';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { TicketmasterEvent } from '@/lib/sources/ticketmaster/types';
import type { Event, Venue } from '@/lib/domain/catalog';

describe('parseVenueCoordinates', () => {
  it('parses Ticketmaster string coordinates (San Diego) and rounds float noise', () => {
    expect(
      parseVenueCoordinates({
        latitude: '32.72375719',
        longitude: '-117.22761030',
      }),
    ).toEqual({ lat: 32.723757, lng: -117.22761 });
  });

  it('accepts numbers too', () => {
    expect(
      parseVenueCoordinates({ latitude: 39.7392, longitude: -104.9903 }),
    ).toEqual({
      lat: 39.7392,
      lng: -104.9903,
    });
  });

  it.each([
    [undefined],
    [null],
    [{}],
    [{ latitude: '', longitude: '' }],
    [{ latitude: '   ', longitude: '10' }],
    [{ latitude: true, longitude: 10 }],
    [{ latitude: 'abc', longitude: '12' }],
    [{ latitude: '95', longitude: '10' }],
    [{ latitude: '10', longitude: '-190' }],
    [{ latitude: '0', longitude: '0' }],
    [{ latitude: '32.7', longitude: null }],
  ])('rejects invalid or missing coordinates (%j)', (loc) => {
    expect(parseVenueCoordinates(loc as never)).toBeNull();
  });

  it('normalizes -0 to 0 when tiny negative values round to zero', () => {
    const coords = parseVenueCoordinates({
      latitude: -0.0000001,
      longitude: 10,
    });
    expect(coords).toEqual({ lat: 0, lng: 10 });
    expect(Object.is(coords?.lat, 0)).toBe(true);
  });

  it('ignores non-object venueLocation payloads', () => {
    expect(
      getCandidateVenueCoordinates({
        rawPayload: { venueLocation: 'bad' },
      }),
    ).toBeNull();
  });

  it('keeps a genuine zero on one axis (equator or prime meridian)', () => {
    expect(parseVenueCoordinates({ latitude: '0', longitude: '10' })).toEqual({
      lat: 0,
      lng: 10,
    });
  });
});

const baseEvent = (location?: { latitude?: string; longitude?: string }) =>
  ({
    id: 'evt-1',
    name: 'EPIC Night Yacht Party',
    dates: {
      start: {
        localDate: '2026-12-05',
        localTime: '19:00:00',
        dateTime: '2026-12-06T03:00:00Z',
      },
      timezone: 'America/Los_Angeles',
      status: { code: 'onsale' },
    },
    _embedded: {
      venues: [
        {
          id: 'v1',
          name: 'H&M Landing',
          city: { name: 'San Diego' },
          state: { stateCode: 'CA' },
          timezone: 'America/Los_Angeles',
          ...(location ? { location } : {}),
        },
      ],
      attractions: [{ id: 'a1', name: 'DJ Someone' }],
    },
  }) as unknown as TicketmasterEvent;

const CONTEXT = {
  sourceId: 'b0000000-0000-0000-0000-000000000003',
  rawIngestId: 'c0000000-0000-0000-0000-000000000001',
  sourceUrl: 'https://app.ticketmaster.com/discovery/v2/events.json',
  fetchedAt: '2026-11-25T12:00:00Z',
  contentHash: 'h',
  parserVersion: '1.0.0',
};

describe('Ticketmaster parser keeps venue coordinates', () => {
  it('carries valid coordinates on the candidate (previously dropped)', () => {
    const c = parseTicketmasterEvent(
      baseEvent({ latitude: '32.72375719', longitude: '-117.22761030' }),
      CONTEXT,
    );
    expect(c.rawPayload?.venueLocation).toEqual({
      lat: 32.723757,
      lng: -117.22761,
    });
    expect(getCandidateVenueCoordinates(c)).toEqual({
      lat: 32.723757,
      lng: -117.22761,
    });
  });

  it('omits coordinates when Ticketmaster has none or invalid ones', () => {
    for (const loc of [
      undefined,
      { latitude: '0', longitude: '0' },
      { latitude: 'x', longitude: 'y' },
    ]) {
      const c = parseTicketmasterEvent(baseEvent(loc), CONTEXT);
      expect(c.rawPayload?.venueLocation).toBeUndefined();
      expect(getCandidateVenueCoordinates(c)).toBeNull();
    }
  });
});

describe('fillVenueCoordinates (ingestion hook)', () => {
  function seed(lat?: number, lng?: number) {
    const repo = new MemoryCatalogRepository();
    const venue = {
      id: 'v0000000-0000-0000-0000-000000000001',
      name: 'H&M Landing',
      normalizedName: 'h m landing',
      city: 'San Diego',
      ...(lat !== undefined ? { lat, lng } : {}),
    } as unknown as Venue;
    repo.venues.set(venue.id, venue);
    const event = {
      id: 'e0000000-0000-0000-0000-000000000001',
      name: 'x',
      venueId: venue.id,
    } as unknown as Event;
    repo.events.set(event.id, event);
    return { repo, venue, event };
  }

  it('fills coordinates on a venue that has none', async () => {
    const { repo, venue, event } = seed();
    const written = await fillVenueCoordinates(repo, event.id, {
      rawPayload: { venueLocation: { lat: 32.723757, lng: -117.22761 } },
    });
    expect(written).toBe(true);
    expect(repo.venues.get(venue.id)).toMatchObject({
      lat: 32.723757,
      lng: -117.22761,
    });
  });

  it('never overwrites coordinates a venue already has', async () => {
    const { repo, venue, event } = seed(40.0, -105.0);
    const written = await fillVenueCoordinates(repo, event.id, {
      rawPayload: { venueLocation: { lat: 32.7, lng: -117.2 } },
    });
    expect(written).toBe(false);
    expect(repo.venues.get(venue.id)).toMatchObject({ lat: 40.0, lng: -105.0 });
  });

  it('does nothing without coordinates, without an event, or for an unknown event', async () => {
    const { repo, event } = seed();
    expect(await fillVenueCoordinates(repo, event.id, { rawPayload: {} })).toBe(
      false,
    );
    expect(
      await fillVenueCoordinates(repo, null, {
        rawPayload: { venueLocation: { lat: 1, lng: 1 } },
      }),
    ).toBe(false);
    expect(
      await fillVenueCoordinates(repo, 'missing', {
        rawPayload: { venueLocation: { lat: 1, lng: 1 } },
      }),
    ).toBe(false);
  });
});

describe('implausible coordinates are rejected', () => {
  it('rejects a longitude whose sign was dropped by the source (Lytle Creek, CA)', async () => {
    const repo = new MemoryCatalogRepository();
    repo.venues.set('v', {
      id: 'v',
      name: 'Hidden Acres',
      normalizedName: 'hidden acres',
      city: 'Lytle Creek',
    } as never);
    repo.events.set('e', { id: 'e', name: 'x', venueId: 'v' } as never);
    const ok = await fillVenueCoordinates(repo, 'e', {
      city: 'San Diego',
      state: 'CA',
      rawPayload: { venueLocation: { lat: 32.72, lng: 117.22 } },
    });
    expect(ok).toBe(false);
    expect(repo.venues.get('v')?.lat).toBeUndefined();
  });
});

describe('eventDistanceMiles trusts the city over a contradictory venue coordinate', () => {
  const DENVER = { lat: 39.7392, lng: -104.9903 };
  it('uses the city centroid when the venue coordinate is implausible for that city', async () => {
    const { eventDistanceMiles } = await import('@/lib/location/radius');
    const d = eventDistanceMiles(
      { city: 'Denver', region: 'CO', lat: 47.6, lng: -122.3 },
      DENVER,
    );
    expect(d).not.toBeNull();
    expect(d as number).toBeLessThan(5);
  });

  it('keeps a coordinate for an unknown city, and falls back to unknown without either', async () => {
    const { eventDistanceMiles } = await import('@/lib/location/radius');
    expect(
      eventDistanceMiles(
        { city: 'Nowhere', region: 'ZZ', lat: 47.6, lng: -122.3 },
        DENVER,
      ) as number,
    ).toBeGreaterThan(1000);
    expect(
      eventDistanceMiles({ city: 'Nowhere', region: 'ZZ' }, DENVER),
    ).toBeNull();
  });
});

describe('isPlausibleCoordinate', () => {
  it('rejects foreign coordinates under a US state label, keeps Hawaii and Florida Keys', async () => {
    const { isPlausibleCoordinate } = await import('@/lib/location/radius');
    expect(
      isPlausibleCoordinate(19.40345, -99.088778, 'Temple City', 'CA'),
    ).toBe(false); // Mexico City
    expect(
      isPlausibleCoordinate(18.478346, -69.916878, 'Santo Domingo', 'FL'),
    ).toBe(false);
    expect(isPlausibleCoordinate(21.3069, -157.8583, 'Honolulu', 'HI')).toBe(
      true,
    );
    expect(isPlausibleCoordinate(24.5551, -81.78, 'Key West', 'FL')).toBe(true);
    expect(isPlausibleCoordinate(34.23, 117.49, 'Lytle Creek', 'CA')).toBe(
      false,
    );
    expect(isPlausibleCoordinate(19.4, -99.1, 'Ciudad de Mexico', 'CDMX')).toBe(
      true,
    );
    expect(isPlausibleCoordinate(0, 0, 'London', undefined)).toBe(false);
    expect(isPlausibleCoordinate(0, 10, 'Somewhere', undefined)).toBe(true);
  });
});

describe('resolveEventCoordinates, eventDistanceDetails, and edge guards', () => {
  const DENVER = { lat: 39.7392, lng: -104.9903 };

  it('reports venue precision for plausible venue coordinates and city_centroid fallback otherwise', async () => {
    const { resolveEventCoordinates, eventDistanceDetails } =
      await import('@/lib/location/radius');

    expect(
      resolveEventCoordinates({
        city: 'San Diego',
        region: 'CA',
        lat: 32.723757,
        lng: -117.22761,
      }),
    ).toEqual({ lat: 32.723757, lng: -117.22761, precision: 'venue' });

    // Contradictory Seattle coordinate for Denver falls back to Denver city centroid
    const fallback = resolveEventCoordinates({
      city: 'Denver',
      region: 'CO',
      lat: 47.6,
      lng: -122.3,
    });
    expect(fallback).toEqual({
      lat: 39.7392,
      lng: -104.9903,
      precision: 'city_centroid',
    });

    const details = eventDistanceDetails(
      { city: 'Boulder', region: 'CO', lat: null, lng: null },
      DENVER,
    );
    expect(details?.precision).toBe('city_centroid');
    expect(details?.distanceMiles).toBeGreaterThan(20);
    expect(details?.distanceMiles).toBeLessThan(30);

    // Implausible Lytle Creek (not in static city table) returns null rather than a bogus distance
    expect(
      resolveEventCoordinates({
        city: 'Lytle Creek',
        region: 'CA',
        lat: 34.233056,
        lng: 117.493751,
      }),
    ).toBeNull();
  });

  it('returns null / empty when home coordinates or radius are invalid', async () => {
    const { eventDistanceMiles, filterEventsWithinRadius } =
      await import('@/lib/location/radius');

    expect(
      eventDistanceMiles(
        { city: 'Denver', region: 'CO' },
        { lat: Number.NaN, lng: -104.99 },
      ),
    ).toBeNull();
    expect(
      eventDistanceMiles({ city: 'Denver', region: 'CO' }, { lat: 0, lng: 0 }),
    ).toBeNull();
    expect(
      filterEventsWithinRadius([{ city: 'Denver', region: 'CO' }], DENVER, -5),
    ).toEqual([]);
    expect(
      filterEventsWithinRadius(
        [{ city: 'Denver', region: 'CO' }],
        DENVER,
        Number.NaN,
      ),
    ).toEqual([]);
  });
});
