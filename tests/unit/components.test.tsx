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
});
