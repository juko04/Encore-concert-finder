// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { PersonalizedEventCard } from '@/components/discover/PersonalizedEventCard';
import { PersonalizedDiscoverContainer } from '@/components/discover/PersonalizedDiscoverContainer';
import { GuestDiscoverContainer } from '@/components/discover/GuestDiscoverContainer';
import { PersonalizedDiscoverErrorState } from '@/components/discover/PersonalizedDiscoverErrorState';
import { GuestDiscoverErrorState } from '@/components/discover/GuestDiscoverErrorState';
import type { ScoredEvent } from '@/lib/recommendation/types';
import type {
  PersonalizedDiscoverResult,
  PublicDiscoverResult,
} from '@/lib/recommendation/service';

// Mock server actions
const mockUpdateRecommendationPresetAction = vi.fn();
const mockUpdateTravelRadiusAction = vi.fn();
const mockUpdateTypicalBudgetAction = vi.fn();
const mockGetPersonalizedRecommendationsAction = vi.fn();

vi.mock('@/app/discover/actions', () => ({
  updateRecommendationPresetAction: (...args: unknown[]) =>
    mockUpdateRecommendationPresetAction(...args),
  updateTravelRadiusAction: (...args: unknown[]) =>
    mockUpdateTravelRadiusAction(...args),
  updateTypicalBudgetAction: (...args: unknown[]) =>
    mockUpdateTypicalBudgetAction(...args),
  getPersonalizedRecommendationsAction: (...args: unknown[]) =>
    mockGetPersonalizedRecommendationsAction(...args),
}));

describe('PersonalizedEventCard Component', () => {
  const mockScoredEvent: ScoredEvent = {
    eventId: 'event-phoebe-1',
    score: 87,
    presetUsed: 'balanced',
    weights: { artist: 50, distance: 20, price: 20, timing: 10 },
    explanation:
      '★ Favorite artist (Phoebe Bridgers) · Close to home (2 mi) · Under budget ($45)',
    isSuppressed: false,
    isExploratory: false,
    diagnostics: {
      dataAvailability: {
        hasArtistMatch: true,
        hasPriceData: true,
        hasCoordinates: true,
        hasTimingPreferences: true,
      },
      rawMetrics: {},
    },
    factors: {
      artist: {
        factor: 'artist',
        score: 100,
        weight: 50,
        weightedContribution: 50,
        isAvailable: true,
        fieldStatus: 'verified',
        explanation: 'Favorite artist: Phoebe Bridgers (+50 pts)',
      },
      distance: {
        factor: 'distance',
        score: 95,
        weight: 20,
        weightedContribution: 19,
        isAvailable: true,
        fieldStatus: 'verified',
        explanation: 'Within 2 mi of home (+19 pts)',
      },
      price: {
        factor: 'price',
        score: 90,
        weight: 20,
        weightedContribution: 18,
        isAvailable: true,
        fieldStatus: 'verified',
        explanation: 'Within typical budget ($45 <= $60) (+18 pts)',
      },
      timing: {
        factor: 'timing',
        score: 0,
        weight: 10,
        weightedContribution: 0,
        isAvailable: true,
        fieldStatus: 'verified',
        explanation: 'Scheduled date (+0 pts)',
      },
    },
    event: {
      id: 'event-phoebe-1',
      title: 'Phoebe Bridgers at Red Rocks',
      eventKind: 'concert',
      status: 'scheduled',
      timezone: 'America/Denver',
      localStartDate: '2026-11-15',
      startsAt: '2026-11-16T02:00:00Z',
      startTimePrecision: 'instant',
      venueName: 'Red Rocks Amphitheatre',
      city: 'Morrison',
      region: 'CO',
      minPrice: 45,
      maxPrice: 85,
      currency: 'USD',
      ticketUrl: 'https://tickets.example.com/phoebe',
      sourceName: 'Ticketmaster',
      artists: [
        {
          id: 'artist-phoebe',
          name: 'Phoebe Bridgers',
          billingPosition: 'headliner',
        },
      ],
    },
  };

  it('renders event details, localized date, price, and match score out of 100', () => {
    render(<PersonalizedEventCard scoredEvent={mockScoredEvent} />);

    expect(
      screen.getByText('Phoebe Bridgers at Red Rocks'),
    ).toBeInTheDocument();
    expect(screen.getByText('Phoebe Bridgers')).toBeInTheDocument();
    expect(screen.getByText('Red Rocks Amphitheatre')).toBeInTheDocument();
    expect(screen.getByText('Morrison, CO')).toBeInTheDocument();

    // Recommendation score strictly formatted as 87/100, NOT a percentage
    const scoreBadge = screen.getByTestId('event-score');
    expect(scoreBadge).toHaveTextContent('87/100');
    expect(scoreBadge).not.toHaveTextContent('87%');

    // Concise explanation
    expect(screen.getByTestId('event-explanation')).toHaveTextContent(
      '★ Favorite artist (Phoebe Bridgers) · Close to home (2 mi) · Under budget ($45)',
    );

    // Ticket button
    const ticketBtn = screen.getByTestId('ticket-button');
    expect(ticketBtn).toHaveAttribute(
      'href',
      'https://tickets.example.com/phoebe',
    );
  });

  it('suppresses ticket button when external URL is not an http/https URL', () => {
    const invalidUrlEvent: ScoredEvent = {
      ...mockScoredEvent,
      event: {
        ...mockScoredEvent.event,
        ticketUrl: 'javascript:alert(1)',
      },
    };

    render(<PersonalizedEventCard scoredEvent={invalidUrlEvent} />);
    expect(screen.queryByTestId('ticket-button')).not.toBeInTheDocument();
  });

  it('expands and collapses "Why this show?" factor breakdown drawer', () => {
    render(<PersonalizedEventCard scoredEvent={mockScoredEvent} />);

    const whyBtn = screen.getByTestId('why-this-show-button');
    expect(whyBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('factor-breakdown')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(whyBtn);
    expect(whyBtn).toHaveAttribute('aria-expanded', 'true');

    const breakdown = screen.getByTestId('factor-breakdown');
    expect(breakdown).toBeInTheDocument();
    expect(breakdown).toHaveTextContent(
      'Favorite artist: Phoebe Bridgers (+50 pts)',
    );
    expect(breakdown).toHaveTextContent('Within 2 mi of home (+19 pts)');
    expect(breakdown).toHaveTextContent(
      'Within typical budget ($45 <= $60) (+18 pts)',
    );
    expect(breakdown).toHaveTextContent('Total Score: 87/100');

    // Click again to collapse
    fireEvent.click(whyBtn);
    expect(whyBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('factor-breakdown')).not.toBeInTheDocument();
  });

  it('renders truthful neutral explanation for missing user coordinates', () => {
    const missingCoordsEvent: ScoredEvent = {
      ...mockScoredEvent,
      factors: {
        ...mockScoredEvent.factors,
        distance: {
          factor: 'distance',
          score: 50,
          weight: 20,
          weightedContribution: 10,
          isAvailable: false,
          fieldStatus: 'neutral_missing',
          explanation:
            'Home location not configured; neutral travel score (+10 pts)',
        },
      },
    };

    render(<PersonalizedEventCard scoredEvent={missingCoordsEvent} />);
    fireEvent.click(screen.getByTestId('why-this-show-button'));

    const breakdown = screen.getByTestId('factor-breakdown');
    expect(breakdown).toHaveTextContent(
      'Home location not configured; neutral travel score (+10 pts)',
    );
  });
});

describe('PersonalizedDiscoverContainer Component', () => {
  const mockInitialData: PersonalizedDiscoverResult = {
    userProfile: {
      id: 'user-discover-1',
      homeLatApprox: 39.7392,
      homeLngApprox: -104.9903,
      defaultRadiusMiles: 25,
      maxNormalTicketPrice: 60,
      maxSpontaneousPrice: null,
      maxFavoriteArtistPrice: null,
      travelWillingness: 'moderate',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      recommendationPreset: 'balanced',
    },
    activePreset: 'balanced',
    activeWeights: { artist: 50, distance: 20, price: 20, timing: 10 },
    hasPreferences: true,
    isLocationConfigured: true,
    recommendations: [
      {
        eventId: 'rec-1',
        score: 92,
        presetUsed: 'balanced',
        weights: { artist: 50, distance: 20, price: 20, timing: 10 },
        explanation: '★ Favorite artist (Chappell Roan)',
        isSuppressed: false,
        isExploratory: false,
        diagnostics: {
          dataAvailability: {
            hasArtistMatch: true,
            hasPriceData: true,
            hasCoordinates: true,
            hasTimingPreferences: true,
          },
          rawMetrics: {},
        },
        factors: {
          artist: {
            factor: 'artist',
            score: 100,
            weight: 50,
            weightedContribution: 50,
            isAvailable: true,
            fieldStatus: 'verified',
            explanation: 'Favorite artist: Chappell Roan (+50 pts)',
          },
          distance: {
            factor: 'distance',
            score: 100,
            weight: 20,
            weightedContribution: 20,
            isAvailable: true,
            fieldStatus: 'verified',
            explanation: 'Within 5 mi (+20 pts)',
          },
          price: {
            factor: 'price',
            score: 100,
            weight: 20,
            weightedContribution: 20,
            isAvailable: true,
            fieldStatus: 'verified',
            explanation: 'Under budget (+20 pts)',
          },
          timing: {
            factor: 'timing',
            score: 20,
            weight: 10,
            weightedContribution: 2,
            isAvailable: true,
            fieldStatus: 'verified',
            explanation: 'Weekend show (+2 pts)',
          },
        },
        event: {
          id: 'rec-1',
          title: 'Chappell Roan at Mission Ballroom',
          eventKind: 'concert',
          status: 'scheduled',
          timezone: 'America/Denver',
          localStartDate: '2026-11-20',
          startsAt: '2026-11-21T03:00:00Z',
          startTimePrecision: 'instant',
          venueName: 'Mission Ballroom',
          city: 'Denver',
          region: 'CO',
          minPrice: 55,
          currency: 'USD',
          ticketUrl: 'https://tickets.example.com/chappell',
          artists: [
            {
              id: 'artist-chappell',
              name: 'Chappell Roan',
              billingPosition: 'headliner',
            },
          ],
        },
      },
    ],
    exploratory: [
      {
        eventId: 'exp-1',
        score: 65,
        presetUsed: 'balanced',
        weights: { artist: 50, distance: 20, price: 20, timing: 10 },
        explanation: 'Nearby concert within budget',
        isSuppressed: false,
        isExploratory: true,
        diagnostics: {
          dataAvailability: {
            hasArtistMatch: false,
            hasPriceData: true,
            hasCoordinates: true,
            hasTimingPreferences: true,
          },
          rawMetrics: {},
        },
        factors: {
          artist: {
            factor: 'artist',
            score: 40,
            weight: 50,
            weightedContribution: 20,
            isAvailable: false,
            fieldStatus: 'neutral_missing',
            explanation: 'Neutral exploratory (+20 pts)',
          },
          distance: {
            factor: 'distance',
            score: 100,
            weight: 20,
            weightedContribution: 20,
            isAvailable: true,
            fieldStatus: 'verified',
            explanation: 'Within 5 mi (+20 pts)',
          },
          price: {
            factor: 'price',
            score: 100,
            weight: 20,
            weightedContribution: 20,
            isAvailable: true,
            fieldStatus: 'verified',
            explanation: 'Under budget (+20 pts)',
          },
          timing: {
            factor: 'timing',
            score: 50,
            weight: 10,
            weightedContribution: 5,
            isAvailable: true,
            fieldStatus: 'verified',
            explanation: 'Weekend show (+5 pts)',
          },
        },
        event: {
          id: 'exp-1',
          title: 'Indie Band at Bluebird Theater',
          eventKind: 'concert',
          status: 'scheduled',
          timezone: 'America/Denver',
          localStartDate: '2026-11-22',
          startsAt: '2026-11-23T03:00:00Z',
          startTimePrecision: 'instant',
          venueName: 'Bluebird Theater',
          city: 'Denver',
          region: 'CO',
          minPrice: 25,
          currency: 'USD',
          ticketUrl: 'https://tickets.example.com/bluebird',
          artists: [
            {
              id: 'artist-indie',
              name: 'Indie Band',
              billingPosition: 'headliner',
            },
          ],
        },
      },
    ],
    suppressed: [],
    ineligibleCount: 0,
    totalCandidateCount: 2,
    isEmptyCatalog: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateRecommendationPresetAction.mockResolvedValue({
      success: true,
      data: { preset: 'artist_first' },
    });
    mockUpdateTravelRadiusAction.mockResolvedValue({
      success: true,
      data: { radiusMiles: 50 },
    });
    mockUpdateTypicalBudgetAction.mockResolvedValue({
      success: true,
      data: { maxNormalTicketPrice: 80 },
    });
    mockGetPersonalizedRecommendationsAction.mockResolvedValue({
      success: true,
      data: mockInitialData,
    });
  });

  it('renders all four preset buttons with accessible aria-pressed state and passes exact identifier artist_first for Artists', async () => {
    render(<PersonalizedDiscoverContainer initialData={mockInitialData} />);

    const balancedBtn = screen.getByTestId('preset-balanced');
    const artistBtn = screen.getByTestId('preset-artist-first');
    const nearbyBtn = screen.getByTestId('preset-nearby');
    const valueBtn = screen.getByTestId('preset-value');

    expect(balancedBtn).toHaveAttribute('aria-pressed', 'true');
    expect(artistBtn).toHaveAttribute('aria-pressed', 'false');
    expect(nearbyBtn).toHaveAttribute('aria-pressed', 'false');
    expect(valueBtn).toHaveAttribute('aria-pressed', 'false');

    expect(artistBtn).toHaveTextContent('Artists');

    await act(async () => {
      fireEvent.click(artistBtn);
    });

    expect(mockUpdateRecommendationPresetAction).toHaveBeenCalledWith(
      'artist_first',
    );
  });

  it('renders travel radius options and calls updateTravelRadiusAction', async () => {
    render(<PersonalizedDiscoverContainer initialData={mockInitialData} />);

    const radiusSelector = screen.getByTestId('radius-selector');
    const radius50Btn = within(radiusSelector).getByText('50 mi');

    await act(async () => {
      fireEvent.click(radius50Btn);
    });

    expect(mockUpdateTravelRadiusAction).toHaveBeenCalledWith(50);
  });

  it('renders typical budget options and calls updateTypicalBudgetAction', async () => {
    render(<PersonalizedDiscoverContainer initialData={mockInitialData} />);

    const budgetSelector = screen.getByTestId('budget-selector');
    const budget80Btn = within(budgetSelector).getByText('$80');

    await act(async () => {
      fireEvent.click(budget80Btn);
    });

    expect(mockUpdateTypicalBudgetAction).toHaveBeenCalledWith(80);
  });

  it('filters candidates client-side via search input without losing rank order', async () => {
    render(<PersonalizedDiscoverContainer initialData={mockInitialData} />);

    expect(
      screen.getByText('Chappell Roan at Mission Ballroom'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Indie Band at Bluebird Theater'),
    ).toBeInTheDocument();

    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'Chappell' } });

    expect(
      screen.getByText('Chappell Roan at Mission Ballroom'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Indie Band at Bluebird Theater'),
    ).not.toBeInTheDocument();
  });

  it('preserves candidate collection integrity across search, city filters, and settings updates without dropping events', async () => {
    const multiCityData: PersonalizedDiscoverResult = {
      ...mockInitialData,
      recommendations: [
        mockInitialData.recommendations[0], // Chappell Roan in Denver
        {
          ...mockInitialData.recommendations[0],
          eventId: 'rec-boulder-1',
          event: {
            ...mockInitialData.recommendations[0].event,
            id: 'rec-boulder-1',
            title: 'Big Thief at Boulder Theater',
            city: 'Boulder',
            artists: [
              {
                id: 'artist-big-thief',
                name: 'Big Thief',
                billingPosition: 'headliner',
              },
            ],
          },
        },
      ],
      exploratory: [],
    };

    mockGetPersonalizedRecommendationsAction.mockResolvedValue({
      success: true,
      data: multiCityData,
    });

    render(<PersonalizedDiscoverContainer initialData={multiCityData} />);

    // Initial state: both Denver and Boulder events visible
    expect(
      screen.getByText('Chappell Roan at Mission Ballroom'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Big Thief at Boulder Theater'),
    ).toBeInTheDocument();

    // Step 1: Filter by search 'Chappell'
    const searchInput = screen.getByTestId('search-input');
    fireEvent.change(searchInput, { target: { value: 'Chappell' } });
    expect(
      screen.getByText('Chappell Roan at Mission Ballroom'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Big Thief at Boulder Theater'),
    ).not.toBeInTheDocument();

    // Step 2: Switch preset to 'nearby' while search filter is active
    // Critical: getPersonalizedRecommendationsAction MUST NOT be called with search: 'Chappell'
    const nearbyBtn = screen.getByTestId('preset-nearby');
    await act(async () => {
      fireEvent.click(nearbyBtn);
    });
    expect(mockGetPersonalizedRecommendationsAction).toHaveBeenCalledWith({
      preset: 'nearby',
    });

    // Step 3: Clear search filter
    fireEvent.change(searchInput, { target: { value: '' } });
    // Both Denver and Boulder events must still be available in memory!
    expect(
      screen.getByText('Chappell Roan at Mission Ballroom'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Big Thief at Boulder Theater'),
    ).toBeInTheDocument();

    // Step 4: Select city 'Denver'
    const citySelector = screen.getByTestId('city-filter');
    fireEvent.change(citySelector, { target: { value: 'Denver' } });
    expect(
      screen.getByText('Chappell Roan at Mission Ballroom'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Big Thief at Boulder Theater'),
    ).not.toBeInTheDocument();

    // Step 5: Change budget while Denver filter is active
    // Critical: server call MUST NOT pass city: 'Denver'
    const budgetSelector = screen.getByTestId('budget-selector');
    const budget80Btn = within(budgetSelector).getByText('$80');
    await act(async () => {
      fireEvent.click(budget80Btn);
    });
    expect(mockGetPersonalizedRecommendationsAction).toHaveBeenCalledWith({
      preset: 'nearby',
    });

    // Step 6: Select 'All Cities'
    fireEvent.change(citySelector, { target: { value: '' } });
    // Boulder event must be restored immediately because candidate pool remained intact!
    expect(
      screen.getByText('Chappell Roan at Mission Ballroom'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Big Thief at Boulder Theater'),
    ).toBeInTheDocument();
  });

  it('displays stale notice with retry button when settings save succeeds but re-rank fails', async () => {
    mockUpdateRecommendationPresetAction.mockResolvedValueOnce({
      success: true,
      data: { preset: 'artist_first' },
    });
    mockGetPersonalizedRecommendationsAction.mockResolvedValueOnce({
      success: false,
      error: 'Unable to load recommendations. Please try again.',
    });

    render(<PersonalizedDiscoverContainer initialData={mockInitialData} />);

    const artistBtn = screen.getByTestId('preset-artist-first');
    await act(async () => {
      fireEvent.click(artistBtn);
    });

    // Stale banner appears
    const staleBanner = screen.getByTestId('stale-recommendations-banner');
    expect(staleBanner).toBeInTheDocument();
    expect(staleBanner).toHaveTextContent(
      'Unable to load recommendations. Please try again.',
    );

    // Clicking retry button successfully refreshes
    mockGetPersonalizedRecommendationsAction.mockResolvedValueOnce({
      success: true,
      data: {
        ...mockInitialData,
        activePreset: 'artist_first',
      },
    });

    const retryBtn = screen.getByTestId('retry-refresh-button');
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(
      screen.queryByTestId('stale-recommendations-banner'),
    ).not.toBeInTheDocument();
  });

  it('displays onboarding callout when user has zero saved preferences', () => {
    const zeroPrefData: PersonalizedDiscoverResult = {
      ...mockInitialData,
      hasPreferences: false,
    };

    render(<PersonalizedDiscoverContainer initialData={zeroPrefData} />);

    const banner = screen.getByTestId('onboarding-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Personalize Your Live Music Feed');
  });

  it('displays truthful empty catalog banner when catalog has no upcoming shows', () => {
    const emptyData: PersonalizedDiscoverResult = {
      ...mockInitialData,
      isEmptyCatalog: true,
      recommendations: [],
      exploratory: [],
      totalCandidateCount: 0,
    };

    render(<PersonalizedDiscoverContainer initialData={emptyData} />);

    expect(screen.getByTestId('empty-catalog-banner')).toBeInTheDocument();
    expect(screen.getByText('No upcoming events found')).toBeInTheDocument();
  });
});

describe('GuestDiscoverContainer Component', () => {
  const mockPublicData: PublicDiscoverResult = {
    totalCount: 1,
    events: [
      {
        id: 'public-evt-1',
        title: 'Lord Huron Live',
        eventKind: 'concert',
        status: 'scheduled',
        timezone: 'America/Denver',
        localStartDate: '2026-11-25',
        startsAt: '2026-11-26T03:00:00Z',
        startTimePrecision: 'instant',
        venueName: "Fiddler's Green Amphitheatre",
        city: 'Greenwood Village',
        region: 'CO',
        minPrice: 40,
        currency: 'USD',
        ticketUrl: 'https://tickets.example.com/lord-huron',
        artists: [
          {
            id: 'artist-lord-huron',
            name: 'Lord Huron',
            billingPosition: 'headliner',
          },
        ],
      },
    ],
    isEmptyCatalog: false,
  };

  it('renders guest personalization banner with link to sign in', () => {
    render(<GuestDiscoverContainer initialData={mockPublicData} />);

    const banner = screen.getByTestId('guest-personalization-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Make These Recommendations Yours');

    const signInLink = screen.getByTestId('guest-sign-in-link');
    expect(signInLink).toHaveAttribute('href', '/login');
  });

  it('renders public events without personal score badges or personal claims', () => {
    render(<GuestDiscoverContainer initialData={mockPublicData} />);

    expect(screen.getByText('Lord Huron Live')).toBeInTheDocument();
    expect(
      screen.getByText("Fiddler's Green Amphitheatre"),
    ).toBeInTheDocument();

    // Verify absence of personal score badge
    expect(screen.queryByTestId('event-score')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('why-this-show-button'),
    ).not.toBeInTheDocument();
  });
});

describe('PersonalizedDiscoverErrorState Component', () => {
  it('renders authenticated error state with retry button and taste profile link', () => {
    render(<PersonalizedDiscoverErrorState />);

    const errorContainer = screen.getByTestId('authenticated-error-state');
    expect(errorContainer).toBeInTheDocument();
    expect(
      screen.getByText('Unable to Load Recommendations'),
    ).toBeInTheDocument();

    const tasteLink = screen.getByTestId('discover-taste-link');
    expect(tasteLink).toHaveAttribute('href', '/profile/taste');

    const retryBtn = screen.getByTestId('retry-button');
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveTextContent('Try Again');
  });
});

describe('GuestDiscoverErrorState Component', () => {
  it('renders guest error state with retry button without misleading empty catalog claim', () => {
    render(<GuestDiscoverErrorState />);

    const errorContainer = screen.getByTestId('guest-error-state');
    expect(errorContainer).toBeInTheDocument();
    expect(
      screen.getByText('Unable to Load Live Music Catalog'),
    ).toBeInTheDocument();

    const retryBtn = screen.getByTestId('retry-button');
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).toHaveTextContent('Try Again');
  });
});
