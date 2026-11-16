import { describe, it, expect } from 'vitest';
import {
  PROTOTYPE_EVENTS,
  PROTOTYPE_INITIAL_PREFERENCES,
} from '@/lib/prototypes/fixtures';
import {
  formatEventDate,
  formatPrice,
  calculateDistanceMiles,
  getStatusBadge,
} from '@/components/prototypes/index/formatters';

describe('Encore Index — Prototype Formatters & Scenarios Verification', () => {
  it('Scenario 1: correctly formats and handles cheap weekend show ($18 Silver Lake Dreamers)', () => {
    const event = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-101')!;
    expect(event).toBeDefined();

    const formattedDate = formatEventDate(event.localStartDate, event.doorTime);
    expect(formattedDate).toContain('Nov 14');
    expect(formattedDate).toContain('7:30 PM');

    const formattedPrice = formatPrice(
      event.minPrice,
      event.maxPrice,
      event.currency,
    );
    expect(formattedPrice).toBe('$18–$22');

    const badge = getStatusBadge(event.ticketStatus);
    expect(badge.label).toBe('Tickets Available');
  });

  it('Scenario 2: correctly evaluates unfamiliar artist with honest pros and cons (Hania Rani)', () => {
    const event = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-102')!;
    expect(event).toBeDefined();

    expect(event.whyItSuitsYou.length).toBeGreaterThanOrEqual(3);
    expect(event.considerations.length).toBeGreaterThanOrEqual(2);
    expect(event.samplePersonalScore.authenticatedScore).toBe(92);
    expect(event.samplePersonalScore.affinityType).toBe('exploratory');

    const badge = getStatusBadge(event.ticketStatus);
    expect(badge.label).toBe('Low Inventory');
  });

  it('Scenario 3: correctly identifies favorite artist presale alert triggers (The Cure)', () => {
    const event = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-103')!;
    expect(event).toBeDefined();

    expect(event.samplePersonalScore.authenticatedScore).toBe(98);
    expect(event.samplePersonalScore.affinityType).toBe('favorite');
    expect(event.presaleDate).toBeDefined();

    const badge = getStatusBadge(event.ticketStatus);
    expect(badge.label).toBe('Presale Soon');
  });

  it('Edge case: handles $0 free events correctly without invalid currency conversion', () => {
    const freeEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-105')!;
    expect(freeEvent).toBeDefined();

    const price = formatPrice(
      freeEvent.minPrice,
      freeEvent.maxPrice,
      freeEvent.currency,
    );
    expect(price).toBe('Free ($0)');
  });

  it('Edge case: handles missing price / TBA correctly with neutral fallback', () => {
    const tbaEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-107')!;
    expect(tbaEvent).toBeDefined();

    const price = formatPrice(
      tbaEvent.minPrice,
      tbaEvent.maxPrice,
      tbaEvent.currency,
    );
    expect(price).toBe('Price TBA');
  });

  it('calculates geographic distance accurately from central Denver origin', () => {
    // Red Rocks Amphitheatre: lat ~39.6654, lng ~-105.2057
    const redRocksEvent = PROTOTYPE_EVENTS.find(
      (e) => e.id === 'proto-ev-103',
    )!;
    const distance = calculateDistanceMiles(
      redRocksEvent.lat,
      redRocksEvent.lng,
    );
    expect(distance).toBeGreaterThan(10);
    expect(distance).toBeLessThan(20);

    // Missing coordinates fallback
    expect(calculateDistanceMiles(undefined, undefined)).toBeNull();
  });

  it('validates Invariant 11 preference precedence: initial preferences contain The Cure and suppressed headliner', () => {
    const curePref = PROTOTYPE_INITIAL_PREFERENCES.find(
      (p) => p.artistName === 'The Cure',
    );
    expect(curePref?.level).toBe('favorite');

    const neonPref = PROTOTYPE_INITIAL_PREFERENCES.find(
      (p) => p.artistName === 'Neon Hype Machine',
    );
    expect(neonPref?.level).toBe('ignore');

    const suppressedEvent = PROTOTYPE_EVENTS.find(
      (e) => e.id === 'proto-ev-110',
    )!;
    expect(suppressedEvent.samplePersonalScore.authenticatedScore).toBe(0);
    expect(suppressedEvent.samplePersonalScore.affinityType).toBe('disliked');
  });
});
