import { describe, expect, it } from 'vitest';
import {
  isPlausibleCoordinate,
  isValidCoordinatePair,
} from '@/lib/location/coordinates';
import * as radius from '@/lib/location/radius';
import { parseVenueCoordinates } from '@/lib/sources/ticketmaster/venue-location';
import { fillVenueCoordinates } from '@/lib/sources/ticketmaster/ingestion-pipeline';
import { MemoryCatalogRepository } from '@/lib/repositories/memory-repositories';
import type { Event, Venue } from '@/lib/domain/catalog';

/**
 * One rule set (lib/location/coordinates.ts) governs ingestion parsing, the repository fill and
 * display. These tests pin that every layer agrees on the same inputs.
 */
const CASES: Array<[string, number, number, boolean]> = [
  ['normal US', 39.7392, -104.9903, true],
  ['equator + prime meridian axes', 0, 12.5, true],
  ['null island', 0, 0, false],
  ['lat out of range', 90.0001, 10, false],
  ['lng out of range', 10, -180.0001, false],
  ['lat at limit', 90, 10, true],
  ['NaN', Number.NaN, 10, false],
  ['Infinity', 10, Number.POSITIVE_INFINITY, false],
];

describe('shared coordinate rules', () => {
  it.each(CASES)('%s', async (_name, lat, lng, valid) => {
    expect(isValidCoordinatePair(lat, lng)).toBe(valid);
    // Display re-exports the very same plausibility function.
    expect(radius.isPlausibleCoordinate).toBe(isPlausibleCoordinate);
    expect(isPlausibleCoordinate(lat, lng)).toBe(valid);
    // Ingestion parsing (Ticketmaster sends strings).
    expect(
      parseVenueCoordinates({
        latitude: String(lat),
        longitude: String(lng),
      }) !== null,
    ).toBe(valid);
    // Repository fill (fill-if-empty) uses the same gate.
    const repo = new MemoryCatalogRepository();
    const venue = { id: 'v1', name: 'V', normalizedName: 'v' } as Venue;
    repo.venues.set('v1', venue);
    repo.events.set('e1', { id: 'e1', venueId: 'v1' } as unknown as Event);
    expect(await repo.fillVenueCoordinatesForEvent('e1', lat, lng)).toBe(valid);
  });

  it('city-contextual rules apply identically before storing and when displaying', async () => {
    // Dropped minus sign: Denver with an eastern-hemisphere longitude.
    expect(isPlausibleCoordinate(39.7, 104.9, 'Denver', 'CO')).toBe(false);
    // Mexico City under a US state label.
    expect(isPlausibleCoordinate(19.43, -99.13, 'Somewhere', 'TX')).toBe(false);
    // 150+ miles from its own city.
    expect(isPlausibleCoordinate(35.0, -106.6, 'Denver', 'CO')).toBe(false);
    // Unknown city is trusted.
    expect(isPlausibleCoordinate(40.0, -105.3, 'Nowhereville', 'CO')).toBe(
      true,
    );

    // The ingestion hook rejects what the display layer would reject.
    const repo = new MemoryCatalogRepository();
    repo.venues.set('v1', {
      id: 'v1',
      name: 'V',
      normalizedName: 'v',
    } as Venue);
    repo.events.set('e1', { id: 'e1', venueId: 'v1' } as unknown as Event);
    const filled = await fillVenueCoordinates(repo, 'e1', {
      city: 'Denver',
      state: 'CO',
      rawPayload: { venueLocation: { lat: 39.7, lng: 104.9 } },
    });
    expect(filled).toBe(false);
    expect(repo.venues.get('v1')).not.toHaveProperty('lat');
  });
});
