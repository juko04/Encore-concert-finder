// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  renderHook,
  act,
} from '@testing-library/react';
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';
import {
  toIndexEventItem,
  type IndexEventItem,
} from '@/components/index/types';
import { useWatchlist } from '@/components/index/useWatchlist';
import { UndoToast } from '@/components/index/UndoToast';
import { AudioPreviewPlayer } from '@/components/index/AudioPreviewPlayer';
import { EventCard } from '@/components/index/EventCard';
import { EventListItem } from '@/components/index/EventListItem';
import { Header } from '@/components/index/Header';
import { IndexFeedContainer } from '@/components/index/IndexFeedContainer';
import { ConcertDetailClient } from '@/components/index/ConcertDetailClient';
import { SearchClient } from '@/components/index/SearchClient';
import { SavedWatchlistClient } from '@/components/index/SavedWatchlistClient';

const MOCK_CANONICAL_EVENT: CanonicalEventSummary = {
  id: 'event-cure-101',
  title: 'The Cure - Shows of a Lost World Tour',
  venueName: 'Red Rocks Amphitheatre',
  venueId: 'venue-red-rocks',
  city: 'Morrison',
  region: 'CO',
  lat: 39.6654,
  lng: -105.2057,
  localStartDate: '2026-11-14',
  startsAt: '2026-11-14T19:30:00Z',
  timezone: 'America/Denver',
  startTimePrecision: 'instant',
  status: 'scheduled',
  eventKind: 'concert',
  inventoryStatus: 'available',
  artists: [
    {
      id: 'art-cure',
      name: 'The Cure',
      billingPosition: 'headliner',
      spotifyArtistId: 'spot-cure-123',
    },
    {
      id: 'art-twilight',
      name: 'The Twilight Sad',
      billingPosition: 'support',
      spotifyArtistId: 'spot-twilight-456',
    },
  ],
  ticketUrl: 'https://tickets.example.com/the-cure-red-rocks',
  minPrice: 65,
  maxPrice: 125,
  currency: 'USD',
  sourceName: 'ticketmaster',
};

const MOCK_SCORED_EVENT: ScoredEvent = {
  eventId: 'event-cure-101',
  event: MOCK_CANONICAL_EVENT,
  score: 96,
  factors: {
    artist: {
      factor: 'artist',
      score: 100,
      weight: 45,
      weightedContribution: 45,
      isAvailable: true,
      fieldStatus: 'verified',
      explanation: 'Headliner The Cure is one of your top favorite artists.',
    },
    distance: {
      factor: 'distance',
      score: 92,
      weight: 20,
      weightedContribution: 18.4,
      isAvailable: true,
      fieldStatus: 'verified',
      explanation: '14.2 miles from your location.',
    },
    price: {
      factor: 'price',
      score: 90,
      weight: 20,
      weightedContribution: 18,
      isAvailable: true,
      fieldStatus: 'verified',
      explanation: '$65 is within your favorite artist ceiling ($150).',
    },
  },
  presetUsed: 'balanced',
  weights: { artist: 55, distance: 25, price: 20 },
  explanation:
    'High affinity match for The Cure with convenient Saturday timing.',
  matchedArtist: {
    id: 'art-cure',
    name: 'The Cure',
    preferenceLevel: 'favorite',
    score: 100,
    isFavorite: true,
    isDisliked: false,
  },
  isSuppressed: false,
  isExploratory: false,
  diagnostics: {
    dataAvailability: {
      hasArtistMatch: true,
      hasPriceData: true,
      hasCoordinates: true,
      hasGenreSignal: false,
    },
    rawMetrics: {
      distanceMiles: 14.2,
      minPrice: 65,
      budgetCeiling: 150,
    },
  },
};

const MOCK_INDEX_ITEMS: IndexEventItem[] = [
  toIndexEventItem(MOCK_SCORED_EVENT),
  {
    id: 'event-free-102',
    title: 'Civic Center Jazz in the Park',
    headlinerName: 'Denver Jazz Collective',
    artists: [
      {
        id: 'art-jazz',
        name: 'Denver Jazz Collective',
        billingPosition: 'headliner',
      },
    ],
    venueName: 'Civic Center Park',
    city: 'Denver',
    region: 'CO',
    lat: 39.7392,
    lng: -104.9903,
    localStartDate: '2026-11-15',
    doorTime: '2:00 PM',
    status: 'scheduled',
    eventKind: 'free_event',
    inventoryStatus: 'available',
    minPrice: 0,
    maxPrice: 0,
    currency: 'USD',
    ticketUrl: null,
    genre: 'Jazz / Fusion',
    ageRestriction: 'All Ages',
    posterColor: '#059669',
    posterSecondaryColor: '#0d9488',
    whyItSuitsYou: ['Free admission open to the public.'],
    considerations: ['Lawn seating only; bring a blanket.'],
  },
  {
    id: 'event-sold-out-103',
    title: 'Hania Rani Live at Bluebird',
    headlinerName: 'Hania Rani',
    artists: [
      {
        id: 'art-hania',
        name: 'Hania Rani',
        billingPosition: 'headliner',
      },
    ],
    venueName: 'Bluebird Theater',
    city: 'Denver',
    region: 'CO',
    lat: 39.7402,
    lng: -104.949,
    localStartDate: '2026-11-20',
    doorTime: '8:00 PM',
    status: 'scheduled',
    eventKind: 'concert',
    inventoryStatus: 'sold_out',
    minPrice: 35,
    maxPrice: 45,
    currency: 'USD',
    ticketUrl: 'https://tickets.example.com/hania-rani',
    genre: 'Neoclassical / Ambient',
    ageRestriction: '16+',
    posterColor: '#e11d48',
    posterSecondaryColor: '#f43f5e',
    personalScore: {
      score: 88,
      isPersonalized: true,
      isExploratory: true,
      matchReason: 'Atmospheric piano with excellent venue acoustic reviews.',
    },
  },
];

describe('Index Components Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('toIndexEventItem Adapter', () => {
    it('adapts CanonicalEventSummary with resolved inventoryStatus and deterministic colors', () => {
      const item = toIndexEventItem(MOCK_CANONICAL_EVENT);
      expect(item.id).toBe('event-cure-101');
      expect(item.headlinerName).toBe('The Cure');
      expect(item.inventoryStatus).toBe('available');
      expect(item.posterColor).toBeDefined();
      expect(item.posterSecondaryColor).toBeDefined();
      expect(item.personalScore).toBeUndefined();
    });

    it('adapts ScoredEvent into IndexEventItem with complete factor breakdown and match score', () => {
      const item = toIndexEventItem(MOCK_SCORED_EVENT);
      expect(item.id).toBe('event-cure-101');
      expect(item.headlinerName).toBe('The Cure');
      expect(item.personalScore).toBeDefined();
      expect(item.personalScore?.score).toBe(96);
      expect(item.personalScore?.isFavorite).toBe(true);
      expect(item.personalScore?.factors?.artist?.score).toBe(100);
      expect(item.personalScore?.factors?.distance?.score).toBe(92);
      expect(item.personalScore?.factors?.price?.score).toBe(90);
    });

    it('resolves cancelled status correctly', () => {
      const cancelledCanonical: CanonicalEventSummary = {
        ...MOCK_CANONICAL_EVENT,
        status: 'cancelled',
      };
      const item = toIndexEventItem(cancelledCanonical);
      expect(item.inventoryStatus).toBe('cancelled');
    });

    it('resolves sold_out status from ticketStatus or inventoryStatus', () => {
      const soldOutEvent = {
        ...MOCK_CANONICAL_EVENT,
        inventoryStatus: 'sold_out',
      };
      const item = toIndexEventItem(
        soldOutEvent as unknown as CanonicalEventSummary,
      );
      expect(item.inventoryStatus).toBe('sold_out');
    });
  });

  describe('useWatchlist Hook', () => {
    it('initializes with provided IDs and toggles save state', () => {
      const { result } = renderHook(() => useWatchlist(['event-1'], []));
      expect(result.current.isSaved('event-1')).toBe(true);
      expect(result.current.isSaved('event-2')).toBe(false);

      act(() => {
        result.current.toggleSave('event-2', 'Concert Two');
      });
      expect(result.current.isSaved('event-2')).toBe(true);
      expect(result.current.undoStack.length).toBe(1);

      // Undo save
      act(() => {
        result.current.undo();
      });
      expect(result.current.isSaved('event-2')).toBe(false);
    });

    it('toggles alerts and tracks undo action', () => {
      const { result } = renderHook(() => useWatchlist([], []));
      act(() => {
        result.current.toggleAlert('event-1', 'Concert One');
      });
      expect(result.current.hasAlert('event-1')).toBe(true);

      act(() => {
        result.current.undo();
      });
      expect(result.current.hasAlert('event-1')).toBe(false);
    });
  });

  describe('UndoToast Component', () => {
    it('renders toast with undo button and triggers onUndo callback', () => {
      const onUndo = vi.fn();
      const onDismiss = vi.fn();

      render(
        <UndoToast
          undoStack={[{ description: 'Saved "The Cure" to watchlist' }]}
          onUndo={onUndo}
          onDismiss={onDismiss}
        />,
      );

      expect(
        screen.getByText('Saved "The Cure" to watchlist'),
      ).toBeInTheDocument();

      const undoButton = screen.getByRole('button', { name: /undo/i });
      fireEvent.click(undoButton);
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it('renders null when undoStack is empty', () => {
      const { container } = render(
        <UndoToast undoStack={[]} onUndo={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('AudioPreviewPlayer Component', () => {
    it('renders track title, artist name, and toggles play/pause', () => {
      render(
        <AudioPreviewPlayer
          track={{ title: 'Pictures of You', duration: '3:30' }}
          artistName="The Cure"
          posterColor="#4f46e5"
        />,
      );

      expect(screen.getByText('Pictures of You')).toBeInTheDocument();
      expect(screen.getByText('The Cure')).toBeInTheDocument();
      expect(screen.getByText('3:30')).toBeInTheDocument();

      const playButton = screen.getByRole('button', {
        name: /play preview track/i,
      });
      fireEvent.click(playButton);

      expect(
        screen.getByRole('button', { name: /pause preview/i }),
      ).toBeInTheDocument();
    });
  });

  describe('EventCard Component', () => {
    it('renders editorial details: artist name, venue, date, price, and ticket link', () => {
      const onToggleSave = vi.fn();
      const onToggleAlert = vi.fn();

      render(
        <EventCard
          event={MOCK_INDEX_ITEMS[0]}
          isSaved={false}
          hasAlert={false}
          onToggleSave={onToggleSave}
          onToggleAlert={onToggleAlert}
        />,
      );

      expect(screen.getByText('The Cure')).toBeInTheDocument();
      expect(screen.getByText(/Red Rocks Amphitheatre/i)).toBeInTheDocument();
      expect(screen.getByText(/\$65–\$125/)).toBeInTheDocument();
      expect(screen.getByText('Favorite Artist · 96%')).toBeInTheDocument();
      expect(screen.getByText('Tickets Available')).toBeInTheDocument();

      // Trigger save button
      const saveButton = screen.getByRole('button', {
        name: /save the cure to watchlist/i,
      });
      fireEvent.click(saveButton);
      expect(onToggleSave).toHaveBeenCalledWith('event-cure-101', 'The Cure');

      // Genuine ticket link check
      const ticketLink = screen.getByRole('link', { name: /tickets ↗/i });
      expect(ticketLink).toHaveAttribute(
        'href',
        'https://tickets.example.com/the-cure-red-rocks',
      );
      expect(ticketLink).toHaveAttribute('target', '_blank');
      expect(ticketLink).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders Sold Out badge when inventoryStatus is sold_out', () => {
      render(
        <EventCard
          event={MOCK_INDEX_ITEMS[2]}
          isSaved={true}
          hasAlert={false}
        />,
      );

      expect(screen.getByText('Sold Out')).toBeInTheDocument();
      expect(screen.getByText('Sold Out ↗')).toBeInTheDocument();
    });
  });

  describe('EventListItem Component', () => {
    it('renders compact list item with poster avatar and save control', () => {
      const onToggleSave = vi.fn();

      render(
        <EventListItem
          event={MOCK_INDEX_ITEMS[0]}
          isSaved={true}
          hasAlert={false}
          onToggleSave={onToggleSave}
        />,
      );

      expect(screen.getByText('The Cure')).toBeInTheDocument();
      expect(screen.getByText('C')).toBeInTheDocument(); // Monogram avatar ("The Cure" -> C: leading article skipped)
      expect(screen.getByText('96% Match')).toBeInTheDocument();

      const saveButton = screen.getByRole('button', {
        name: /remove the cure from watchlist/i,
      });
      fireEvent.click(saveButton);
      expect(onToggleSave).toHaveBeenCalledWith('event-cure-101', 'The Cure');
    });
  });

  describe('Header Component', () => {
    it('renders site title "ENCORE // INDEX" and main navigation tabs with badge', () => {
      render(<Header savedCount={3} alertCount={1} isAuthenticated={true} />);

      expect(screen.getByText('ENCORE')).toBeInTheDocument();
      expect(screen.getByText('// INDEX')).toBeInTheDocument();
      expect(screen.getByText('Curated Live Music')).toBeInTheDocument();
      expect(screen.getByText('Discover')).toBeInTheDocument();
      expect(screen.getByText('Calendar')).toBeInTheDocument();
      expect(screen.getAllByText('Saved')[0]).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument(); // Badge count
    });
  });

  describe('IndexFeedContainer Component', () => {
    it('renders feed with mode chips and toggles Grid / List layout', () => {
      render(
        <IndexFeedContainer
          events={MOCK_INDEX_ITEMS}
          referenceDate="2026-11-14"
        />,
      );

      expect(
        screen.getByRole('button', { name: /all shows/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /this weekend/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /recommended/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /free \(\$0\)/i }),
      ).toBeInTheDocument();

      // Default Grid layout check
      expect(screen.getByText('The Cure')).toBeInTheDocument();
      expect(screen.getByText('Denver Jazz Collective')).toBeInTheDocument();

      // Switch to List layout
      const listButton = screen.getByRole('button', { name: /list layout/i });
      fireEvent.click(listButton);
      expect(screen.getByText('C')).toBeInTheDocument(); // Monogram avatar in list view ("The Cure" -> C)

      // Filter by Free ($0) mode
      const freeChip = screen.getByRole('button', { name: /free \(\$0\)/i });
      fireEvent.click(freeChip);
      expect(screen.getByText('Denver Jazz Collective')).toBeInTheDocument();
      expect(screen.queryByText('The Cure')).not.toBeInTheDocument();
    });
  });

  describe('ConcertDetailClient Component', () => {
    it('renders full editorial concert detail with lineup, map link, and factor breakdown', () => {
      render(
        <ConcertDetailClient
          event={MOCK_INDEX_ITEMS[0]}
          relatedEvents={[MOCK_INDEX_ITEMS[1]]}
        />,
      );

      expect(
        screen.getByRole('heading', { level: 1, name: 'The Cure' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/with The Twilight Sad/i)).toBeInTheDocument();
      expect(
        screen.getAllByText('Red Rocks Amphitheatre').length,
      ).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Open in Google Maps ↗')).toBeInTheDocument();
      expect(screen.getByText('Editorial Decision Guide')).toBeInTheDocument();

      // Toggle personalized factor drawer
      const factorButton = screen.getByRole('button', {
        name: /view factor breakdown/i,
      });
      fireEvent.click(factorButton);

      expect(screen.getByText('Artist Fit')).toBeInTheDocument();
      expect(screen.getByText('100/100')).toBeInTheDocument();
      expect(screen.getByText('Distance Fit')).toBeInTheDocument();
      expect(screen.getByText('92/100')).toBeInTheDocument();
      expect(screen.getByText('Price Fit')).toBeInTheDocument();
      expect(screen.getByText('90/100')).toBeInTheDocument();
    });

    it('uses homeLocation (with city centroid fallback) instead of hardcoded Denver and disambiguates duplicate festival dates', () => {
      const boulderNoCoords = {
        ...MOCK_INDEX_ITEMS[0],
        city: 'Boulder',
        region: 'CO',
        lat: null,
        lng: null,
      };
      const { rerender } = render(
        <ConcertDetailClient
          event={boulderNoCoords}
          homeLocation={null}
          festivalDays={[
            {
              id: 'd1',
              name: 'Epic Fest - Day 1',
              localStartDate: '2027-04-01',
            },
            {
              id: 'd2',
              name: 'Epic Fest - Day 1 VIP',
              localStartDate: '2027-04-01',
            },
          ]}
        />,
      );
      expect(screen.queryByText(/mi\)/)).not.toBeInTheDocument();
      expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
      expect(screen.getByText(/\(2\)/)).toBeInTheDocument();

      rerender(
        <ConcertDetailClient
          event={boulderNoCoords}
          homeLocation={{ lat: 39.7392, lng: -104.9903 }}
        />,
      );
      expect(screen.getByText(/approx\./)).toBeInTheDocument();

      rerender(
        <ConcertDetailClient
          event={{
            ...MOCK_INDEX_ITEMS[0],
            city: 'San Diego',
            region: 'CA',
            lat: 32.723757,
            lng: -117.22761,
          }}
          homeLocation={{ lat: 32.7157, lng: -117.1611 }}
        />,
      );
      expect(screen.queryByText(/approx\./)).not.toBeInTheDocument();
      expect(screen.getByText(/mi\)/)).toBeInTheDocument();
    });
  });

  describe('SearchClient Component', () => {
    it('filters events live by search keyword, pricing, and venue selector', () => {
      render(
        <SearchClient events={MOCK_INDEX_ITEMS} referenceDate="2026-11-14" />,
      );

      expect(screen.getByText('The Cure')).toBeInTheDocument();
      expect(screen.getByText('Denver Jazz Collective')).toBeInTheDocument();
      expect(screen.getByText('Hania Rani')).toBeInTheDocument();

      // Search keyword filter
      const searchInput = screen.getByPlaceholderText(
        /search by artist, headliner, venue/i,
      );
      fireEvent.change(searchInput, { target: { value: 'Hania' } });

      expect(screen.getByText('Hania Rani')).toBeInTheDocument();
      expect(screen.queryByText('The Cure')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Denver Jazz Collective'),
      ).not.toBeInTheDocument();
    });

    it('cancels stale in-flight Load More requests when filters change', async () => {
      const mockAbort = vi.fn();
      let capturedSignal: AbortSignal | undefined;

      const globalFetch = global.fetch;
      global.fetch = vi
        .fn()
        .mockImplementation((_url: string, opts?: { signal?: AbortSignal }) => {
          capturedSignal = opts?.signal;
          if (capturedSignal) {
            capturedSignal.addEventListener('abort', mockAbort);
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                json: async () => ({
                  events: [
                    {
                      id: 'stale-event-1',
                      title: 'Stale Event That Should Be Discarded',
                      venueName: 'Stale Venue',
                      localStartDate: '2026-12-01',
                      genres: [],
                    },
                  ],
                  pagination: { totalCount: 100, hasMore: true },
                }),
              });
            }, 100);
          });
        });

      try {
        render(
          <SearchClient
            events={MOCK_INDEX_ITEMS}
            totalCount={100}
            referenceDate="2026-11-14"
          />,
        );

        // Click Load More to start in-flight request
        const loadMoreBtn = screen.getByRole('button', {
          name: /load more concerts/i,
        });
        fireEvent.click(loadMoreBtn);

        // Change filter before Load More completes
        const searchInput = screen.getByPlaceholderText(
          /search by artist, headliner, venue/i,
        );
        fireEvent.change(searchInput, {
          target: { value: 'Different Filter' },
        });

        // Verify previous in-flight request was aborted
        expect(mockAbort).toHaveBeenCalled();
      } finally {
        global.fetch = globalFetch;
      }
    });
  });

  describe('SavedWatchlistClient Component', () => {
    it('switches between saved shows and alerts tabs and shows metric cards', () => {
      render(<SavedWatchlistClient events={MOCK_INDEX_ITEMS} />);

      expect(
        screen.getByText('Saved Shows & Alert Bookmarks'),
      ).toBeInTheDocument();
      expect(screen.getByText('Saved Shows')).toBeInTheDocument();
      expect(screen.getByText('Alert Bookmarks')).toBeInTheDocument();
      expect(screen.getByText('Storage Scope')).toBeInTheDocument();

      // Empty state verification when no shows are saved yet
      expect(screen.getByText('Your Watchlist is Empty')).toBeInTheDocument();

      // Switch to Alerts tab
      const alertsTab = screen.getByRole('button', {
        name: /alert bookmarks/i,
      });
      fireEvent.click(alertsTab);
      expect(screen.getByText('No Active Alerts')).toBeInTheDocument();
    });
  });
});
