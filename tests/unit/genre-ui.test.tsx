// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventCard } from '@/components/index/EventCard';
import { EventListItem } from '@/components/index/EventListItem';
import { GenreBadge } from '@/components/index/GenreBadge';
import type { IndexEventItem } from '@/components/index/types';

function makeEvent(over: Partial<IndexEventItem> = {}): IndexEventItem {
  return {
    id: 'e1',
    title: 'Some Show',
    headlinerName: 'Some Band',
    artists: [],
    venueName: 'The Venue',
    city: 'Town',
    localStartDate: '2027-01-10',
    status: 'scheduled',
    eventKind: 'concert',
    inventoryStatus: 'available',
    minPrice: null,
    maxPrice: null,
    currency: null,
    ticketUrl: 'https://tickets.example.com/x',
    genre: 'Rock',
    posterColor: '#111',
    posterSecondaryColor: '#222',
    ...over,
  } as IndexEventItem;
}

describe('GenreBadge', () => {
  it('renders canonical label, Mixed, and nothing for non-genres or unknown', () => {
    const { rerender, container } = render(<GenreBadge genre="Hip-Hop/Rap" />);
    expect(screen.getByTestId('genre-badge')).toHaveTextContent('Hip-Hop');
    rerender(<GenreBadge genre="Rock/Jazz" />);
    expect(screen.getByTestId('genre-badge')).toHaveTextContent('RockJazz');
    rerender(<GenreBadge genre="Live Music" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<GenreBadge genre="Zorblax" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<GenreBadge genre={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EventCard match score and genre', () => {
  it('shows "Match N" under the price text for a real personalized score', () => {
    render(
      <EventCard
        event={makeEvent({
          personalScore: { score: 72, isPersonalized: true },
        })}
      />,
    );
    const score = screen.getByTestId('card-match-score');
    expect(score).toHaveTextContent('72% match');
    const price = screen.getByText('Check ticket prices');
    expect(
      price.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no score when none is real (guest) or when suppressed', () => {
    const { rerender } = render(<EventCard event={makeEvent()} />);
    expect(screen.queryByTestId('card-match-score')).toBeNull();
    rerender(
      <EventCard
        event={makeEvent({
          personalScore: { score: 50, isPersonalized: false },
        })}
      />,
    );
    expect(screen.queryByTestId('card-match-score')).toBeNull();
    rerender(
      <EventCard
        event={makeEvent({
          personalScore: { score: 5, isPersonalized: true, isDisliked: true },
        })}
      />,
    );
    expect(screen.queryByTestId('card-match-score')).toBeNull();
  });

  it('renders genre badges on card and list item; Live Music shows none', () => {
    const { rerender } = render(
      <EventCard event={makeEvent({ genre: 'Rock/Pop/Hip-Hop' })} />,
    );
    expect(screen.getByTestId('genre-badge')).toHaveTextContent('RockPop+1');
    rerender(<EventCard event={makeEvent({ genre: 'Live Music' })} />);
    expect(screen.queryByTestId('genre-badge')).toBeNull();
    rerender(<EventListItem event={makeEvent({ genre: 'Jazz' })} />);
    expect(screen.getByTestId('genre-badge')).toHaveTextContent('Jazz');
  });
});
