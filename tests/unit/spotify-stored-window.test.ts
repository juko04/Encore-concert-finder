import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifyTopArtist } from '@/lib/domain/spotify';

vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({}),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockStored = vi.fn();
vi.mock('@/lib/sources/spotify/affinity-service', async (importActual) => {
  const actual =
    await importActual<
      typeof import('@/lib/sources/spotify/affinity-service')
    >();
  return {
    ...actual,
    getStoredSpotifyAffinities: (...a: unknown[]) => mockStored(...a),
  };
});

import { getStoredSpotifyArtistsAction } from '@/app/profile/taste/actions';
import { selectArtistsForWindow } from '@/lib/sources/spotify/affinity-service';

function artist(
  id: string,
  rank: number,
  ranksByRange: SpotifyTopArtist['ranksByRange'],
): SpotifyTopArtist {
  return {
    id,
    name: id,
    genres: [],
    popularity: 50,
    rank,
    trend: 'consistent',
    timeRange: 'short_term',
    ranksByRange,
    syncedAt: '2026-11-20T00:00:00.000Z',
  } as unknown as SpotifyTopArtist;
}

describe('stored Spotify listening-period view', () => {
  beforeEach(() => mockStored.mockReset());

  it('shows only artists ranked in the window, with that window rank and order', async () => {
    mockStored.mockResolvedValue([
      artist('a', 1, { short_term: 1, long_term: 9 }),
      artist('b', 2, { short_term: 2, long_term: 3 }),
      artist('c', 3, { short_term: 3 }),
    ]);
    const res = await getStoredSpotifyArtistsAction('long_term');
    expect(res.artists.map((a) => [a.id, a.rank, a.timeRange])).toEqual([
      ['b', 3, 'long_term'],
      ['a', 9, 'long_term'],
    ]);
    expect(res.message).toBeUndefined();
    // Per-window ranks stay intact for the all-windows line
    expect(res.artists[0].ranksByRange).toEqual({
      short_term: 2,
      long_term: 3,
    });
  });

  it('returns an empty list and a clear message when no stored rank exists for the window', async () => {
    mockStored.mockResolvedValue([
      artist('a', 1, { short_term: 1 }),
      artist('b', 2, { short_term: 2 }),
    ]);
    const res = await getStoredSpotifyArtistsAction('medium_term');
    expect(res.artists).toEqual([]);
    expect(res.message).toMatch(/no stored listening data for this period/i);
    expect(res.syncedAt).toBe('2026-11-20T00:00:00.000Z');
  });

  it('treats artists with missing ranksByRange as having no rank in any window', async () => {
    mockStored.mockResolvedValue([artist('a', 1, undefined)]);
    const res = await getStoredSpotifyArtistsAction('short_term');
    expect(res.artists).toEqual([]);
    expect(res.message).toBeDefined();
  });

  it('returns no message when nothing is stored at all', async () => {
    mockStored.mockResolvedValue([]);
    const res = await getStoredSpotifyArtistsAction('short_term');
    expect(res.artists).toEqual([]);
    expect(res.message).toBeUndefined();
  });

  it('selectArtistsForWindow never falls back to other windows', () => {
    const list = [artist('a', 1, { long_term: 4 })];
    expect(selectArtistsForWindow(list, 'short_term')).toEqual([]);
    expect(selectArtistsForWindow(list, 'long_term')[0].rank).toBe(4);
    expect(selectArtistsForWindow(list)).toBe(list);
  });
});
