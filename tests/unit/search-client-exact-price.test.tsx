// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
import { SearchClient } from '@/components/index/SearchClient';
import type { IndexEventItem } from '@/components/index/types';

const items = [
  {
    id: 'a',
    title: 'Cheap Show (Synthetic Test)',
    venueName: 'V',
    city: 'Denver',
    localStartDate: '2030-01-01',
    minPrice: 10,
    artists: [],
    genres: [],
  },
] as unknown as IndexEventItem[];

function mockFetch() {
  const urls: string[] = [];
  const f = vi.fn(async (url: string) => {
    if (url.startsWith('/api/catalog/search')) urls.push(url);
    return {
      ok: true,
      json: async () => ({
        events: [],
        pagination: { totalCount: 80, hasMore: true },
      }),
    };
  });
  global.fetch = f as never;
  return urls;
}

describe('SearchClient keeps URL price limits exact and near=1 on Load More', () => {
  const orig = global.fetch;
  afterEach(() => {
    global.fetch = orig;
  });

  it.each([40, 42, 43.5, 7, 300])(
    'maxPrice=%s is not rounded/clamped in Load More',
    async (cap) => {
      const urls = mockFetch();
      render(
        <SearchClient
          events={items}
          totalCount={80}
          referenceDate="2026-11-14"
          initialMaxPrice={cap}
          initialIncludeUnknownPrice={false}
          initialNear
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: /load more concerts/i }),
      );
      await waitFor(() => expect(urls.length).toBe(1));
      const p = new URL(urls[0], 'http://x').searchParams;
      expect(p.get('maxPrice')).toBe(String(cap));
      expect(p.get('includeUnknownPrice')).toBe('false');
      expect(p.get('near')).toBe('1');
      expect(p.get('page')).toBe('2');
      await new Promise((r) => setTimeout(r, 700));
      expect(urls.length).toBe(1);
    },
  );

  it('omits near when it was not active', async () => {
    const urls = mockFetch();
    render(
      <SearchClient
        events={items}
        totalCount={80}
        referenceDate="2026-11-14"
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /load more concerts/i }),
    );
    await waitFor(() => expect(urls.length).toBe(1));
    expect(new URL(urls[0], 'http://x').searchParams.has('near')).toBe(false);
  });
});
