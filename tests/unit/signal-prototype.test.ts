import { describe, it, expect } from 'vitest';
import {
  PROTOTYPE_EVENTS,
  PROTOTYPE_INITIAL_PREFERENCES,
} from '@/lib/prototypes/fixtures';
import {
  computeSignalScore,
  formatEventDate,
  formatEventPrice,
} from '@/lib/prototypes/signal-helpers';

describe('Encore Signal — Invariant & Recommendation Engine Verification', () => {
  it('computes top recommendation score (98) for favorite headliner The Cure', () => {
    const cureEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-103')!;
    const signal = computeSignalScore(
      cureEvent,
      PROTOTYPE_INITIAL_PREFERENCES,
      'authenticated',
    );

    expect(signal.score).toBeGreaterThanOrEqual(96);
    expect(signal.isSuppressed).toBe(false);
    expect(signal.affinityType).toBe('favorite');
    expect(signal.badgeLabel).toContain('FAVORITE');
  });

  it('enforces Invariant 11: disliked headliner strictly suppresses event in authenticated mode', () => {
    const hypeEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-110')!;
    const signal = computeSignalScore(
      hypeEvent,
      PROTOTYPE_INITIAL_PREFERENCES,
      'authenticated',
    );

    expect(signal.isSuppressed).toBe(true);
    expect(signal.score).toBe(0);
    expect(signal.badgeLabel).toBe('SUPPRESSED');
    expect(signal.affinityType).toBe('disliked');
    expect(signal.suppressionReason).toContain('Neon Hype Machine');
  });

  it('evaluates neutral score in Guest Mode without personal suppression', () => {
    const hypeEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-110')!;
    const guestSignal = computeSignalScore(
      hypeEvent,
      PROTOTYPE_INITIAL_PREFERENCES,
      'guest',
    );

    expect(guestSignal.isSuppressed).toBe(false);
    expect(guestSignal.score).toBe(65);
    expect(guestSignal.badgeLabel).toContain('Radar');
  });

  it('Scenario 1: correctly identifies inexpensive weekend indie show ($18)', () => {
    const silverLakeEvent = PROTOTYPE_EVENTS.find(
      (e) => e.id === 'proto-ev-101',
    )!;
    const signal = computeSignalScore(
      silverLakeEvent,
      PROTOTYPE_INITIAL_PREFERENCES,
      'authenticated',
    );

    expect(silverLakeEvent.minPrice).toBe(18);
    expect(silverLakeEvent.localStartDate).toBe('2026-11-14');
    expect(signal.score).toBeGreaterThanOrEqual(80);
    expect(
      formatEventPrice(
        silverLakeEvent.minPrice,
        silverLakeEvent.maxPrice,
        silverLakeEvent.currency,
      ),
    ).toBe('$18 – $22');
  });

  it('Scenario 2: personalized discovery with unfamiliar artist Hania Rani (Score 92%)', () => {
    const haniaEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-102')!;
    const signal = computeSignalScore(
      haniaEvent,
      PROTOTYPE_INITIAL_PREFERENCES,
      'authenticated',
    );

    expect(signal.score).toBe(92);
    expect(signal.isSuppressed).toBe(false);
    expect(haniaEvent.ticketStatus).toBe('low_inventory');
    expect(haniaEvent.whyItSuitsYou.length).toBeGreaterThan(0);
    expect(haniaEvent.considerations.length).toBeGreaterThan(0);
  });

  it('Scenario 3: planning ahead with The Cure at Red Rocks with presale timing', () => {
    const cureEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-103')!;
    expect(cureEvent.ticketStatus).toBe('presale');
    expect(cureEvent.presaleDate).toBeDefined();
    expect(cureEvent.venueName).toBe('Red Rocks Amphitheatre');
  });

  it('correctly formats edge cases: $0 free event and missing price TBA', () => {
    const freeEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-105')!;
    const tbaEvent = PROTOTYPE_EVENTS.find((e) => e.id === 'proto-ev-107')!;

    expect(
      formatEventPrice(
        freeEvent.minPrice,
        freeEvent.maxPrice,
        freeEvent.currency,
      ),
    ).toBe('FREE ($0)');
    expect(
      formatEventPrice(tbaEvent.minPrice, tbaEvent.maxPrice, tbaEvent.currency),
    ).toBe('Price TBA');
  });

  it('formats calendar dates in validated timezones without UTC date skew', () => {
    const dateFormatted = formatEventDate('2026-11-14');
    expect(dateFormatted.dayOfWeek).toBe('SAT');
    expect(dateFormatted.monthDay).toContain('NOV 14');
    expect(dateFormatted.relativeLabel).toBe('THIS SATURDAY');
  });
});
