// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EventCard } from '@/components/index/EventCard';
import { EventListItem } from '@/components/index/EventListItem';
import { DiscoverEventCard } from '@/components/discover-home/DiscoverEventCard';
import { getImageCandidates } from '@/components/index/EventImage';
import {
  getVerifiedAvailabilityBadge,
  hasRealMatchScore,
} from '@/components/index/formatters';
import type { IndexEventItem } from '@/components/index/types';

function ev(over: Partial<IndexEventItem> = {}): IndexEventItem {
  return {
    id: 'e1',
    title: 'Test Show',
    headlinerName: 'Test Artist',
    venueName: 'Test Venue',
    city: 'Denver',
    localStartDate: '2027-01-01',
    startsAt: '2027-01-01T20:00:00-07:00',
    timezone: 'America/Denver',
    artists: [],
    inventoryStatus: 'unknown',
    posterColor: '#111',
    posterSecondaryColor: '#222',
    ...over,
  } as unknown as IndexEventItem;
}

describe('verified availability badge', () => {
  it('shows nothing for unknown/presale/missing data', () => {
    expect(getVerifiedAvailabilityBadge('unknown', null)).toBeNull();
    expect(getVerifiedAvailabilityBadge('presale', undefined)).toBeNull();
    expect(getVerifiedAvailabilityBadge(undefined, undefined)).toBeNull();
  });
  it('shows sold out explicitly', () => {
    expect(getVerifiedAvailabilityBadge('sold_out')?.label).toBe('Sold Out');
  });
  it('uses percent thresholds only with numeric data', () => {
    expect(getVerifiedAvailabilityBadge('available', 4)?.indicatorLevel).toBe(
      'urgent',
    );
    expect(getVerifiedAvailabilityBadge('available', 20)?.indicatorLevel).toBe(
      'warning',
    );
    expect(getVerifiedAvailabilityBadge('unknown', 60)).toBeNull();
  });
  it('provider low_inventory without percent has no invented number', () => {
    const b = getVerifiedAvailabilityBadge('low_inventory', null);
    expect(b?.label).toBe('Low inventory');
    expect(b?.label).not.toMatch(/%/);
  });
  it('card renders no badge for unknown inventory', () => {
    render(<EventCard event={ev()} />);
    expect(screen.queryByText(/Check Tickets|Tickets Available/)).toBeNull();
  });
});

describe('match indicator', () => {
  it('requires a real score', () => {
    expect(hasRealMatchScore(undefined)).toBe(false);
    expect(hasRealMatchScore({ isPersonalized: false, score: 80 })).toBe(false);
    expect(hasRealMatchScore({ isPersonalized: true })).toBe(false);
    expect(hasRealMatchScore({ isPersonalized: true, score: 72 })).toBe(true);
  });
  it('is absent for guests and present with accessible text when scored', () => {
    const { unmount } = render(<EventCard event={ev()} />);
    expect(screen.queryByText(/match/i)).toBeNull();
    unmount();
    render(
      <EventCard
        event={ev({
          personalScore: { isPersonalized: true, score: 72 },
        } as Partial<IndexEventItem>)}
      />,
    );
    expect(screen.getByText(/Personalized match/)).toBeTruthy();
    expect(screen.getByText('72% match')).toBeTruthy();
  });
});

describe('image cascade', () => {
  it('orders event, artist, venue and de-duplicates', () => {
    const c = getImageCandidates(
      ev({
        imageUrl: 'https://x/e.jpg',
        venueImageUrl: 'https://x/v.jpg',
        artists: [
          {
            name: 'Test Artist',
            billingPosition: 'headliner',
            imageUrl: 'https://x/e.jpg',
          },
          { name: 'Opener', imageUrl: 'https://x/h.jpg' },
        ] as IndexEventItem['artists'],
      }),
    );
    expect(c.map((x) => x.url)).toEqual([
      'https://x/e.jpg',
      'https://x/h.jpg',
      'https://x/v.jpg',
    ]);
  });
  it('advances on error and finally shows the graphic', () => {
    const { container } = render(
      <EventCard
        event={ev({
          imageUrl: 'https://x/e.jpg',
          venueImageUrl: 'https://x/v.jpg',
        })}
      />,
    );
    const src = () => container.querySelector('img')?.getAttribute('src');
    expect(src()).toBe('https://x/e.jpg');
    fireEvent.error(container.querySelector('img')!);
    expect(src()).toBe('https://x/v.jpg');
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(
      container.querySelector('[data-image-source="graphic"]'),
    ).not.toBeNull();
  });
  it('images are lazy, sized and decorative', () => {
    const { container } = render(
      <DiscoverEventCard event={ev({ imageUrl: 'https://x/e.jpg' })} />,
    );
    const img = container.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('width')).toBeTruthy();
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    cleanup();
  });
  it('list item and discover card share the cascade', () => {
    const { container } = render(
      <EventListItem event={ev({ venueImageUrl: 'https://x/v.jpg' })} />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://x/v.jpg',
    );
  });
});
