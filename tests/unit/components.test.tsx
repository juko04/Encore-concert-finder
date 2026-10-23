// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Container } from '@/components/foundation/Container';
import { StatusBadge } from '@/components/foundation/StatusBadge';

describe('Foundation Components', () => {
  it('renders Container with children and applies custom className', () => {
    render(
      <Container className="custom-class">
        <p>Test Child</p>
      </Container>,
    );

    const child = screen.getByText('Test Child');
    expect(child).toBeInTheDocument();
    expect(child.parentElement).toHaveClass('custom-class');
  });

  it('renders StatusBadge with ready status styles', () => {
    render(<StatusBadge label="System Ready" status="ready" />);

    const badge = screen.getByText('System Ready');
    expect(badge).toBeInTheDocument();
    expect(badge.closest('span')).toHaveClass('text-emerald-400');
  });

  it('renders StatusBadge with pending and active statuses', () => {
    const { rerender } = render(
      <StatusBadge label="Pending Feature" status="pending" />,
    );
    expect(screen.getByText('Pending Feature').closest('span')).toHaveClass(
      'text-amber-400',
    );

    rerender(<StatusBadge label="Active Crawl" status="active" />);
    expect(screen.getByText('Active Crawl').closest('span')).toHaveClass(
      'text-indigo-400',
    );
  });
});

describe('EventCard Component', () => {
  it('renders canonical event with artists, venue, date, price, and attribution', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000001',
          name: 'The Mountain Goats',
          normalizedName: 'the mountain goats',
          eventKind: 'concert',
          status: 'scheduled',
          venueId: '20000000-0000-0000-0000-000000000001',
          timezone: 'America/Denver',
          localStartDate: '2026-10-15',
          startsAt: '2026-10-16T02:00:00Z',
          startTimePrecision: 'instant',
          isMultiDay: false,
          primaryTicketUrl: 'https://tickets.example.com/events/101',
          venue: {
            id: '20000000-0000-0000-0000-000000000001',
            name: 'Gothic Theatre',
            city: 'Englewood',
            region: 'CO',
          },
          artists: [
            {
              id: '30000000-0000-0000-0000-000000000001',
              name: 'The Mountain Goats',
              billingPosition: 'headliner',
            },
            {
              id: '30000000-0000-0000-0000-000000000002',
              name: 'Adeem the Artist',
              billingPosition: 'support',
            },
          ],
          ticketLinks: [
            {
              id: '40000000-0000-0000-0000-000000000001',
              eventId: '10000000-0000-0000-0000-000000000001',
              url: 'https://tickets.example.com/events/101',
              normalizedUrl: 'https://tickets.example.com/events/101',
              minPrice: 35.0,
              maxPrice: 45.0,
              currency: 'USD',
              inventoryStatus: 'available',
            },
          ],
          promoters: [],
          sources: [
            {
              sourceId: 'a0000000-0000-0000-0000-000000000001',
              sourceUrl: 'https://venue.example.com',
              confidence: 0.95,
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByText('The Mountain Goats', { selector: 'h3' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gothic Theatre')).toBeInTheDocument();
    expect(screen.getByText('$35.00 – $45.00 USD')).toBeInTheDocument();
    expect(screen.getByText('Get Tickets')).toHaveAttribute(
      'href',
      'https://tickets.example.com/events/101',
    );
    expect(
      screen.getByText('Source attribution: 1 source'),
    ).toBeInTheDocument();
  });

  it('renders date-only event with TBA time', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000002',
          name: 'Big Thief',
          normalizedName: 'big thief',
          eventKind: 'concert',
          status: 'scheduled',
          venueId: '20000000-0000-0000-0000-000000000002',
          timezone: 'America/Denver',
          localStartDate: '2026-10-20',
          startsAt: null,
          startTimePrecision: 'date_only',
          isMultiDay: false,
          venue: {
            id: '20000000-0000-0000-0000-000000000002',
            name: 'Red Rocks',
            city: 'Morrison',
          },
          artists: [
            {
              id: '30000000-0000-0000-0000-000000000003',
              name: 'Big Thief',
              billingPosition: 'headliner',
            },
          ],
          ticketLinks: [],
          promoters: [],
          sources: [],
        }}
      />,
    );

    expect(screen.getByText('Time TBA (Date confirmed)')).toBeInTheDocument();
    expect(screen.getByText('Price TBA')).toBeInTheDocument();
  });

  it('renders prices without assuming USD when currency is unknown', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000003',
          name: 'Local Showcase',
          normalizedName: 'local showcase',
          eventKind: 'concert',
          status: 'scheduled',
          venueId: '20000000-0000-0000-0000-000000000003',
          timezone: 'America/Denver',
          localStartDate: '2026-10-25',
          startsAt: '2026-10-26T01:00:00Z',
          startTimePrecision: 'instant',
          isMultiDay: false,
          venue: {
            id: '20000000-0000-0000-0000-000000000003',
            name: 'Hi-Dive',
            city: 'Denver',
          },
          artists: [
            {
              id: '30000000-0000-0000-0000-000000000004',
              name: 'Local Band',
              billingPosition: 'headliner',
            },
          ],
          ticketLinks: [
            {
              id: '40000000-0000-0000-0000-000000000002',
              eventId: '10000000-0000-0000-0000-000000000003',
              url: 'https://tickets.example.com/events/local',
              normalizedUrl: 'https://tickets.example.com/events/local',
              minPrice: 15.0,
              maxPrice: 20.0,
              currency: null,
              inventoryStatus: 'available',
            },
          ],
          promoters: [],
          sources: [],
        }}
      />,
    );

    // Must render numerical range without appending USD or $
    expect(screen.getByText('15 – 20')).toBeInTheDocument();
    expect(screen.queryByText(/USD/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$15/)).not.toBeInTheDocument();
  });

  it('renders subtle source badge from summary sources (Tech Debt 1.3)', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000010',
          title: 'The Black Keys',
          venueName: 'Red Rocks Amphitheatre',
          city: 'Morrison',
          region: 'CO',
          localStartDate: '2026-10-15',
          startsAt: '2026-10-16T01:30:00Z',
          timezone: 'America/Denver',
          startTimePrecision: 'instant',
          status: 'scheduled',
          artists: [{ name: 'The Black Keys', billingPosition: 'headliner' }],
          ticketUrl: 'https://www.ticketmaster.com/event/1',
          minPrice: 49.5,
          maxPrice: 129.5,
          currency: 'USD',
          sourceName: 'Ticketmaster Discovery API',
          sources: [
            {
              id: 'b0000000-0000-0000-0000-000000000003',
              name: 'Ticketmaster Discovery API',
              slug: 'ticketmaster-discovery',
            },
          ],
        }}
      />,
    );

    const sourceBadge = screen.getByTestId('source-badge');
    expect(sourceBadge).toBeInTheDocument();
    expect(sourceBadge).toHaveTextContent('Ticketmaster');
    expect(
      screen.getByText('Source attribution: 1 source'),
    ).toBeInTheDocument();
  });

  it('renders multiple source badges when multiple sources contributed', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000011',
          title: 'Khruangbin with Men I Trust',
          venueName: 'Mission Ballroom',
          city: 'Denver',
          region: 'CO',
          localStartDate: '2026-10-18',
          startsAt: '2026-10-19T02:00:00Z',
          timezone: 'America/Denver',
          startTimePrecision: 'instant',
          status: 'scheduled',
          artists: [{ name: 'Khruangbin', billingPosition: 'headliner' }],
          sources: [
            {
              id: 'source-1',
              name: 'Ticketmaster Discovery API',
              slug: 'ticketmaster-discovery',
            },
            {
              id: 'source-2',
              name: 'Direct Venue Calendar',
              slug: 'direct-venue-calendar',
            },
          ],
        }}
      />,
    );

    const badges = screen.getAllByTestId('source-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('Ticketmaster');
    expect(badges[1]).toHaveTextContent('Direct Venue Calendar');
    expect(
      screen.getByText('Source attribution: 2 sources'),
    ).toBeInTheDocument();
  });

  it('renders neutral Unknown Source badge when source relation exists but name is unresolvable (never fabricates Verified)', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000099',
          title: 'Mystery Event',
          venueName: 'Bluebird Theater',
          city: 'Denver',
          region: 'CO',
          localStartDate: '2026-10-30',
          startsAt: '2026-10-31T02:00:00Z',
          timezone: 'America/Denver',
          startTimePrecision: 'instant',
          status: 'scheduled',
          artists: [{ name: 'Mystery Band', billingPosition: 'headliner' }],
          sources: [
            {
              id: 'unknown-id-1',
              name: '',
              slug: 'unknown-source',
            },
          ],
        }}
      />,
    );

    const sourceBadge = screen.getByTestId('source-badge');
    expect(sourceBadge).toBeInTheDocument();
    expect(sourceBadge).toHaveTextContent('Unknown Source');
    // Ensure "Verified" is NEVER present
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(
      screen.getByText('Source attribution: 1 source'),
    ).toBeInTheDocument();
  });

  it('renders mixed known and unknown source badges accurately', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000098',
          title: 'Mixed Sources Show',
          venueName: 'Gothic Theatre',
          city: 'Englewood',
          region: 'CO',
          localStartDate: '2026-11-05',
          startsAt: '2026-11-06T02:00:00Z',
          timezone: 'America/Denver',
          startTimePrecision: 'instant',
          status: 'scheduled',
          artists: [{ name: 'Band A', billingPosition: 'headliner' }],
          sources: [
            {
              id: 'source-1',
              name: 'Ticketmaster Discovery API',
              slug: 'ticketmaster-discovery',
            },
            {
              id: 'source-2',
              name: '',
              slug: 'unknown-source',
            },
          ],
        }}
      />,
    );

    const badges = screen.getAllByTestId('source-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0]).toHaveTextContent('Ticketmaster');
    expect(badges[1]).toHaveTextContent('Unknown Source');
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(
      screen.getByText('Source attribution: 2 sources'),
    ).toBeInTheDocument();
  });

  it('renders Venue TBA / Unknown badge when venue is missing or unknown without fabricating event title (Tech Debt 1.4)', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000012',
          title: 'Radiohead Secret Show',
          venueName: 'Venue TBA',
          localStartDate: '2026-11-20',
          startsAt: null,
          timezone: 'America/Denver',
          startTimePrecision: 'date_only',
          status: 'scheduled',
          artists: [{ name: 'Radiohead', billingPosition: 'headliner' }],
        }}
      />,
    );

    // Must render the explicit badge
    const venueBadge = screen.getByTestId('venue-tba-badge');
    expect(venueBadge).toBeInTheDocument();
    expect(venueBadge).toHaveTextContent('Venue TBA / Unknown');

    // Must NEVER display the event title in the venue position
    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toHaveTextContent('Radiohead Secret Show');
    // Ensure "Radiohead Secret Show" only appears once in the document (as title, not venue)
    expect(screen.getAllByText('Radiohead Secret Show')).toHaveLength(1);
  });

  it('renders Venue TBA / Unknown badge with preserved locality when city/region are known', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000013',
          title: 'Mountain Pop-up',
          venueName: 'Unknown Venue',
          city: 'Telluride',
          region: 'CO',
          localStartDate: '2026-11-25',
          startsAt: null,
          timezone: 'America/Denver',
          startTimePrecision: 'date_only',
          status: 'scheduled',
          artists: [{ name: 'Tycho', billingPosition: 'headliner' }],
        }}
      />,
    );

    expect(screen.getByTestId('venue-tba-badge')).toHaveTextContent(
      'Venue TBA / Unknown',
    );
    expect(screen.getByText('Telluride, CO')).toBeInTheDocument();
  });

  it('renders cancelled indicator and suppresses Get Tickets button for cancelled shows', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000014',
          title: 'Cancelled Tour',
          venueName: 'Ogden Theatre',
          city: 'Denver',
          region: 'CO',
          localStartDate: '2026-11-12',
          startsAt: '2026-11-13T03:00:00Z',
          timezone: 'America/Denver',
          startTimePrecision: 'instant',
          status: 'cancelled',
          artists: [{ name: 'Ghost Light', billingPosition: 'headliner' }],
          ticketUrl: 'https://tickets.example.com/cancelled',
        }}
      />,
    );

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Get Tickets')).not.toBeInTheDocument();
  });

  it('renders postponed indicator for postponed shows', async () => {
    const { EventCard } = await import('@/components/catalog/EventCard');

    render(
      <EventCard
        event={{
          id: '10000000-0000-0000-0000-000000000015',
          title: 'Postponed Show',
          venueName: 'Bluebird Theater',
          city: 'Denver',
          region: 'CO',
          localStartDate: '2026-12-01',
          startsAt: '2026-12-02T02:00:00Z',
          timezone: 'America/Denver',
          startTimePrecision: 'instant',
          status: 'postponed',
          artists: [{ name: 'Some Artist', billingPosition: 'headliner' }],
        }}
      />,
    );

    expect(screen.getByText('Postponed')).toBeInTheDocument();
  });
});

describe('Recommendation Price Presentation & Currency Formatting', () => {
  it('formats verified USD price unambiguously', async () => {
    const { formatEventPriceDisplay } =
      await import('@/components/recommendation/ScoringInspector');

    const display = formatEventPriceDisplay({
      minPrice: 50,
      currency: 'USD',
      eventKind: 'concert',
    });

    expect(display).toBe('$50 USD');
  });

  it('formats Canadian Dollar (CAD) prices with authoritative currency code', async () => {
    const { formatEventPriceDisplay } =
      await import('@/components/recommendation/ScoringInspector');

    const display = formatEventPriceDisplay({
      minPrice: 35,
      currency: 'CAD',
      eventKind: 'concert',
    });

    expect(display).toBe('CAD 35');
    // Invariant: Must NEVER format non-USD as a naked USD $35
    expect(display).not.toBe('$35');
  });

  it('formats unknown currencies explicitly without assigning USD semantics', async () => {
    const { formatEventPriceDisplay } =
      await import('@/components/recommendation/ScoringInspector');

    const display = formatEventPriceDisplay({
      minPrice: 40,
      currency: null,
      eventKind: 'concert',
    });

    expect(display).toBe('40 (currency unknown)');
    expect(display).not.toContain('$');
  });

  it('formats missing ticket prices as truthful Price TBA state', async () => {
    const { formatEventPriceDisplay } =
      await import('@/components/recommendation/ScoringInspector');

    expect(formatEventPriceDisplay({ minPrice: null })).toBe('Price TBA');
    expect(formatEventPriceDisplay({ minPrice: undefined })).toBe('Price TBA');
  });

  it('distinguishes unverified $0 price from confirmed free admission', async () => {
    const { formatEventPriceDisplay } =
      await import('@/components/recommendation/ScoringInspector');

    const unverifiedZero = formatEventPriceDisplay({
      minPrice: 0,
      currency: 'USD',
      eventKind: 'concert',
    });

    expect(unverifiedZero).toBe('Unverified $0 (Status TBA)');
    expect(unverifiedZero).not.toBe('Free');
    expect(unverifiedZero).not.toBe('Free Event (Verified)');
  });

  it('formats verified free events (eventKind === free_event) as confirmed free admission', async () => {
    const { formatEventPriceDisplay } =
      await import('@/components/recommendation/ScoringInspector');

    const verifiedFree = formatEventPriceDisplay({
      minPrice: 0,
      currency: 'USD',
      eventKind: 'free_event',
    });

    expect(verifiedFree).toBe('Free Event (Verified)');
  });

  it('handles negative or non-finite prices as invalid price reported', async () => {
    const { formatEventPriceDisplay } =
      await import('@/components/recommendation/ScoringInspector');

    expect(formatEventPriceDisplay({ minPrice: -10 })).toBe(
      'Invalid Price Reported',
    );
    expect(formatEventPriceDisplay({ minPrice: Infinity })).toBe(
      'Invalid Price Reported',
    );
    expect(formatEventPriceDisplay({ minPrice: NaN })).toBe(
      'Invalid Price Reported',
    );
  });
});
