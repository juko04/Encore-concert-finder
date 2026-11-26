// @vitest-environment jsdom
// Finding (f): image fallback must be sequential (event -> artist -> venue ->
// graphic) and exhausted candidates must not leave a broken <img>.
// NOTE: EventImage.tsx does not exist on the PR baseline (9607682), so this
// file fails there with a module-resolution error — that is the baseline proof.
import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { EventImage, getImageCandidates } from '@/components/index/EventImage';
import type { IndexEventItem } from '@/components/index/types';

const item = {
  id: 'e1',
  title: 'Show',
  headlinerName: 'Headliner',
  imageUrl: 'https://img.test/event.jpg',
  venueImageUrl: 'https://img.test/venue.jpg',
  artists: [
    {
      id: 'a',
      name: 'Headliner',
      billingPosition: 'headliner',
      imageUrl: 'https://img.test/artist.jpg',
    },
  ],
} as unknown as IndexEventItem;

describe('REGRESSION card image fallback', () => {
  it('orders candidates event -> artist -> venue', () => {
    expect(getImageCandidates(item).map((c) => c.source)).toEqual([
      'event',
      'artist',
      'venue',
    ]);
  });
  it('advances one candidate per error and ends on a non-img graphic', () => {
    const { container } = render(<EventImage event={item} />);
    const src = () => container.querySelector('img')?.getAttribute('src') ?? '';
    expect(src()).toContain('event');
    fireEvent.error(container.querySelector('img')!);
    expect(src()).toContain('artist');
    fireEvent.error(container.querySelector('img')!);
    expect(src()).toContain('venue');
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
  });
  it('never fabricates a URL when no images exist', () => {
    const bare = {
      ...item,
      imageUrl: undefined,
      venueImageUrl: undefined,
      artists: [],
    } as unknown as IndexEventItem;
    expect(getImageCandidates(bare)).toEqual([]);
  });
});
