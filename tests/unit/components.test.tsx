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
          id: 'evt_test_1',
          name: 'The Mountain Goats',
          eventKind: 'concert',
          status: 'scheduled',
          venue: {
            id: 'ven_1',
            name: 'Gothic Theatre',
            city: 'Englewood',
            region: 'CO',
          },
          artists: [
            {
              id: 'art_1',
              name: 'The Mountain Goats',
              billingPosition: 'headliner',
            },
            {
              id: 'art_2',
              name: 'Adeem the Artist',
              billingPosition: 'support',
            },
          ],
          localStartDate: '2026-10-15',
          startsAt: '2026-10-16T02:00:00Z',
          timezone: 'America/Denver',
          startTimePrecision: 'instant',
          isMultiDay: false,
          minPrice: 35.0,
          maxPrice: 45.0,
          currency: 'USD',
          primaryTicketUrl: 'https://tickets.example.com/events/101',
          sources: [
            {
              sourceId: 'src_1',
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
          id: 'evt_test_2',
          name: 'Big Thief',
          eventKind: 'concert',
          status: 'scheduled',
          venue: {
            id: 'ven_2',
            name: 'Red Rocks',
            city: 'Morrison',
          },
          artists: [
            { id: 'art_bt', name: 'Big Thief', billingPosition: 'headliner' },
          ],
          localStartDate: '2026-10-20',
          startsAt: null,
          timezone: 'America/Denver',
          startTimePrecision: 'date_only',
          isMultiDay: false,
          sources: [],
        }}
      />,
    );

    expect(screen.getByText('Time TBA (Date confirmed)')).toBeInTheDocument();
    expect(screen.getByText('Price TBA')).toBeInTheDocument();
  });
});
