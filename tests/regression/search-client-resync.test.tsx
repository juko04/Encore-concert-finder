// @vitest-environment jsdom
// Finding: navigating between /search URLs updates server results but the
// visible controls (query box etc.) kept their first-render state because
// SearchClient seeded useState(initialX) once and the page gives it no key.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { SearchClient } from '@/components/index/SearchClient';

describe('REGRESSION search-client-resync', () => {
  it('search box reflects a new initialQuery after the page remounts it with a new URL-derived key', () => {
    const { rerender } = render(
      <SearchClient
        key="techno"
        events={[]}
        initialQuery="techno"
        referenceDate="2026-11-24"
      />,
    );
    const box = () =>
      screen.getByPlaceholderText(
        /search by artist, headliner, venue/i,
      ) as HTMLInputElement;
    expect(box().value).toBe('techno');
    rerender(
      <SearchClient
        key="jazz"
        events={[]}
        initialQuery="jazz"
        referenceDate="2026-11-24"
      />,
    );
    expect(box().value).toBe('jazz');
  });
});
