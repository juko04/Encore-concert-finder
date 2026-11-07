import { describe, expect, it } from 'vitest';
import { formatEventPriceDisplay } from '@/lib/utils/price-formatting';

describe('formatEventPriceDisplay', () => {
  it('formats verified free events as "Free Event (Verified)"', () => {
    expect(formatEventPriceDisplay({ eventKind: 'free_event' })).toBe(
      'Free Event (Verified)',
    );
    expect(
      formatEventPriceDisplay({ eventKind: 'free_event', minPrice: 0 }),
    ).toBe('Free Event (Verified)');
    expect(
      formatEventPriceDisplay({ eventKind: 'free_event', minPrice: null }),
    ).toBe('Free Event (Verified)');
  });

  it('detects contradictory pricing on free events', () => {
    expect(
      formatEventPriceDisplay({
        eventKind: 'free_event',
        minPrice: 25,
        currency: 'USD',
      }),
    ).toBe('Contradictory Pricing ($25 USD / Free Event)');

    expect(
      formatEventPriceDisplay({
        eventKind: 'free_event',
        minPrice: 30,
        currency: 'CAD',
      }),
    ).toBe('Contradictory Pricing (CAD 30 / Free Event)');

    expect(
      formatEventPriceDisplay({
        eventKind: 'free_event',
        minPrice: 15,
      }),
    ).toBe('Contradictory Pricing (15 (currency unknown) / Free Event)');
  });

  it('formats unverified $0 correctly across currencies', () => {
    expect(formatEventPriceDisplay({ minPrice: 0, currency: 'USD' })).toBe(
      'Unverified $0 USD (Status TBA)',
    );
    expect(formatEventPriceDisplay({ minPrice: 0, currency: 'CAD' })).toBe(
      'Unverified CAD 0 (Status TBA)',
    );
    expect(formatEventPriceDisplay({ minPrice: 0, currency: null })).toBe(
      'Unverified 0 (currency unknown, Status TBA)',
    );
  });

  it('formats ordinary paid events with explicit currency', () => {
    expect(formatEventPriceDisplay({ minPrice: 45, currency: 'USD' })).toBe(
      '$45 USD',
    );
    expect(formatEventPriceDisplay({ minPrice: 60, currency: 'EUR' })).toBe(
      'EUR 60',
    );
    expect(formatEventPriceDisplay({ minPrice: 50, currency: null })).toBe(
      '50 (currency unknown)',
    );
  });

  it('handles missing or invalid prices', () => {
    expect(formatEventPriceDisplay({ minPrice: null })).toBe('Price TBA');
    expect(formatEventPriceDisplay({ minPrice: undefined })).toBe('Price TBA');
    expect(formatEventPriceDisplay({ minPrice: -5 })).toBe(
      'Invalid Price Reported',
    );
    expect(formatEventPriceDisplay({ minPrice: NaN })).toBe(
      'Invalid Price Reported',
    );
    expect(formatEventPriceDisplay({ minPrice: Infinity })).toBe(
      'Invalid Price Reported',
    );
  });
});
