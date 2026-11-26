// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventRow } from '@/components/discover-home/EventRow';
import { useWatchlist } from '@/components/index/useWatchlist';
import { ViewerProvider } from '@/components/auth/ViewerContext';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

function show(id: string, title: string): CanonicalEventSummary {
  return {
    id,
    title,
    venueName: 'Red Rocks',
    city: 'Morrison',
    localStartDate: '2027-06-01',
    timezone: 'America/Denver',
    startTimePrecision: 'exact',
    status: 'scheduled',
    eventKind: 'concert',
    artists: [{ name: title, billingPosition: 'headliner' }],
    ticketUrl: 'https://tickets.example.com/x',
  } as unknown as CanonicalEventSummary;
}

// This jsdom build has no localStorage; install a small in-memory one.
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
});

const stored = () =>
  JSON.parse(window.localStorage.getItem('encore_watchlist_ids') ?? '[]');

describe('shared watchlist store', () => {
  it('two components saving different shows keep both (no overwrite)', () => {
    const a = renderHook(() => useWatchlist());
    const b = renderHook(() => useWatchlist());
    act(() => a.result.current.toggleSave('show-a'));
    act(() => b.result.current.toggleSave('show-b'));
    // Each component sees the other's save immediately.
    expect(a.result.current.isSaved('show-b')).toBe(true);
    expect(b.result.current.isSaved('show-a')).toBe(true);
    expect(stored()).toEqual(expect.arrayContaining(['show-a', 'show-b']));

    act(() => a.result.current.toggleSave('show-a'));
    expect(b.result.current.isSaved('show-a')).toBe(false);
    expect(stored()).not.toContain('show-a');
  });
});

describe('heart on home cards', () => {
  beforeEach(() => {
    window.localStorage.setItem('encore_watchlist_ids', '[]');
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });

  it('saves the show without opening it, fills, and persists to Saved', async () => {
    const user = userEvent.setup();
    render(
      <ViewerProvider isAuthenticated homeLabel={null}>
        <EventRow
          id="r"
          title="Row"
          events={[show('ev-1', 'Phoebe Bridgers'), show('ev-2', 'Big Thief')]}
          seeAllHref="/search"
        />
      </ViewerProvider>,
    );
    const heart = screen.getByRole('button', {
      name: 'Save Phoebe Bridgers to Saved',
    });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    // The heart is not inside the card link.
    expect(heart.closest('a')).toBeNull();

    await user.click(heart);
    const saved = screen.getByRole('button', {
      name: 'Remove Phoebe Bridgers from Saved',
    });
    expect(saved).toHaveAttribute('aria-pressed', 'true');
    expect(stored()).toEqual(['ev-1']);
    expect(
      screen.getByRole('button', { name: 'Save Big Thief to Saved' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('is greyed out for visitors and does not save', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <ViewerProvider isAuthenticated={false} homeLabel={null}>
        <EventRow
          id="r"
          title="Row"
          events={[show('ev-1', 'Phoebe Bridgers')]}
          seeAllHref="/search"
        />
      </ViewerProvider>,
    );
    // Visitors hit the greyed-out wrapper; the real heart is inert.
    const gate = screen.getByTestId('guest-gate');
    expect(gate).toHaveAttribute('aria-disabled', 'true');
    expect(gate.querySelector('[inert]')).toContainElement(
      screen.getByTestId('save-heart'),
    );
    await user.click(gate);
    expect(stored()).toEqual([]);
    expect(screen.getByText(/sign in to save this show/i)).toBeInTheDocument();
  });
});
