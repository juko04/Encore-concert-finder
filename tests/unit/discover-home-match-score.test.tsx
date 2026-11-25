// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventRow } from '@/components/discover-home/EventRow';
import { getCardMatchScoreLabel } from '@/components/index/formatters';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';

const canonical: CanonicalEventSummary = {
  id: 'ev-1',
  title: 'Phoebe Bridgers',
  venueName: 'Red Rocks',
  city: 'Morrison',
  localStartDate: '2027-06-01',
  timezone: 'America/Denver',
  startTimePrecision: 'exact',
  status: 'scheduled',
  eventKind: 'concert',
  artists: [{ name: 'Phoebe Bridgers', billingPosition: 'headliner' }],
  ticketUrl: 'https://tickets.example.com/x',
} as unknown as CanonicalEventSummary;

function factor(name: 'artist' | 'distance' | 'price', score: number) {
  return {
    factor: name,
    score,
    weight: 30,
    weightedContribution: 10,
    isAvailable: true,
    fieldStatus: 'verified',
    explanation: name,
  };
}

function scored(over: Partial<ScoredEvent> = {}): ScoredEvent {
  return {
    eventId: canonical.id,
    event: canonical,
    score: 87,
    presetUsed: 'balanced',
    weights: { artist: 50, distance: 25, price: 25 },
    explanation: 'because',
    isSuppressed: false,
    isExploratory: false,
    diagnostics: {
      dataAvailability: {
        hasArtistMatch: true,
        hasPriceData: true,
        hasCoordinates: true,
        hasGenreSignal: false,
      },
      rawMetrics: {},
    },
    factors: {
      artist: factor('artist', 90),
      distance: factor('distance', 80),
      price: factor('price', 70),
    },
    ...over,
  } as unknown as ScoredEvent;
}

function renderRow(events: Array<CanonicalEventSummary | ScoredEvent>) {
  return render(
    <EventRow id="x" title="Row" events={events} seeAllHref="/search" />,
  );
}

describe('Discover homepage card match score', () => {
  it('shows the genuine personalized score for a scored event', () => {
    renderRow([scored({ score: 87 })]);
    expect(screen.getByTestId('card-match-score')).toHaveTextContent(
      'Match 87',
    );
  });

  it('shows nothing for an unscored / guest event (no invented score)', () => {
    renderRow([canonical]);
    expect(screen.queryByTestId('card-match-score')).toBeNull();
  });

  it('shows nothing for a suppressed (disliked) scored event', () => {
    renderRow([scored({ score: 0, isSuppressed: true })]);
    expect(screen.queryByTestId('card-match-score')).toBeNull();
  });

  it('uses the same shared formatting helper as the search cards', () => {
    expect(getCardMatchScoreLabel({ isPersonalized: true, score: 72.4 })).toBe(
      'Match 72',
    );
    expect(getCardMatchScoreLabel({ isPersonalized: false, score: 50 })).toBe(
      null,
    );
    expect(getCardMatchScoreLabel(undefined)).toBeNull();
    expect(
      getCardMatchScoreLabel({ isPersonalized: true, score: NaN }),
    ).toBeNull();
  });
});
