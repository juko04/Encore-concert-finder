// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  EventPlaceholder,
  placeholderInitials,
  placeholderPattern,
} from '@/components/index/EventPlaceholder';
import { EventImage } from '@/components/index/EventImage';
import type { IndexEventItem } from '@/components/index/types';

afterEach(cleanup);

describe('placeholderInitials', () => {
  it('uses the first letters of the first two significant words', () => {
    expect(placeholderInitials('Closed Casket Activities')).toBe('CC');
    expect(placeholderInitials('The Black Keys')).toBe('BK');
    expect(placeholderInitials('A Tribe Called Quest')).toBe('TC');
    expect(placeholderInitials('Ladies Night 2026')).toBe('LN');
  });

  it('uses one letter for a single word and strips accents/symbols', () => {
    expect(placeholderInitials('Phish')).toBe('P');
    expect(placeholderInitials('$5 Thursdays!')).toBe('5T');
    expect(placeholderInitials('Ñandú Trío')).toBe('NT');
  });

  it('never returns an empty monogram', () => {
    for (const v of ['', '   ', '!!!', null, undefined]) {
      expect(placeholderInitials(v as string)).toBe('E');
    }
  });
});

describe('placeholderPattern', () => {
  it('is deterministic per name and varies across names', () => {
    expect(placeholderPattern('Ely Oaks')).toBe(placeholderPattern('Ely Oaks'));
    const seen = new Set(
      [
        'Ely Oaks',
        'Phish',
        'Samplifire',
        'Latin Night',
        'Zizania',
        'GRiZ',
        'Cloonee',
        'FISHER',
      ].map(placeholderPattern),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('EventPlaceholder', () => {
  it('renders decorative art, a monogram and the venue name', () => {
    const { container, getByText } = render(
      <EventPlaceholder name="Samplifire" venueName="The Church Nightclub" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.getAttribute('data-placeholder-pattern')).toBe(
      placeholderPattern('Samplifire'),
    );
    expect(root.querySelector('svg')).not.toBeNull();
    expect(getByText('S')).toBeDefined();
    expect(
      container.querySelector('[data-venue="The Church Nightclub"]'),
    ).not.toBeNull();
  });

  it('omits the venue caption at small size or without a venue', () => {
    const small = render(
      <EventPlaceholder name="Samplifire" venueName="The Church" size="sm" />,
    );
    expect(small.container.querySelector('[data-venue]')).toBeNull();
    small.unmount();
    const none = render(<EventPlaceholder name="Samplifire" venueName="  " />);
    expect(none.container.querySelector('[data-venue]')).toBeNull();
  });

  it('same name gives identical markup (stable across renders)', () => {
    const a = render(<EventPlaceholder name="Ely Oaks" venueName="V" />);
    const html = a.container.innerHTML;
    a.unmount();
    const b = render(<EventPlaceholder name="Ely Oaks" venueName="V" />);
    expect(b.container.innerHTML).toBe(html);
  });
});

describe('EventImage fallback', () => {
  it('shows the generated placeholder (with venue) when no image exists', () => {
    const event = {
      id: 'e1',
      title: 'Closed Casket Activities',
      headlinerName: 'Closed Casket Activities',
      venueName: 'Boulder Theater',
      artists: [],
    } as unknown as IndexEventItem;
    const { container, getByText } = render(<EventImage event={event} />);
    expect(
      container.querySelector('[data-image-source="graphic"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-placeholder-pattern]'),
    ).not.toBeNull();
    expect(getByText('CC')).toBeDefined();
    expect(
      container.querySelector('[data-venue="Boulder Theater"]'),
    ).not.toBeNull();
  });
});
