import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savePreferenceAction } from '@/app/profile/taste/actions';
import { InvalidCatalogArtistError } from '@/lib/domain/user-preference';

// Mock server-only dependencies
vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const mockSavePreference = vi.fn();
vi.mock('@/lib/repositories/user-preference-repository', () => ({
  SupabaseUserPreferenceRepository: vi.fn().mockImplementation(() => ({
    savePreference: mockSavePreference,
  })),
}));

import { getAuthenticatedUser } from '@/lib/auth/session';

import type { User } from '@supabase/supabase-js';

describe('Taste Profile Server Actions — Error Privacy & Safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: 'test-user-id',
      email: 'user@encore.test',
    } as unknown as User);
  });

  it('never returns raw database errors or internal catalog schema details to the client', async () => {
    const rawPostgresError = new Error(
      'PostgreSQL fatal error in catalog schema: relation "public.artists" does not exist at backend/catalog.c:4512 [Code: 42P01]',
    );
    mockSavePreference.mockRejectedValueOnce(rawPostgresError);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await savePreferenceAction({
      artistId: 'canonical-artist-id',
      artistName: 'Radiohead',
      preferenceLevel: 'favorite',
    });

    expect(result.success).toBeUndefined();
    expect(result.preference).toBeUndefined();
    // Must return safe generic user-facing message
    expect(result.error).toBe(
      'Unable to save artist preference. Please try again.',
    );

    // Invariant: Zero leakage of raw database or schema details
    expect(result.error).not.toContain('catalog');
    expect(result.error).not.toContain('PostgreSQL');
    expect(result.error).not.toContain('public.artists');
    expect(result.error).not.toContain('42P01');
    expect(result.error).not.toContain('backend/catalog.c');

    // Diagnostic details must be logged to server console
    expect(consoleSpy).toHaveBeenCalledWith(
      '[savePreferenceAction error]:',
      rawPostgresError,
    );

    consoleSpy.mockRestore();
  });

  it('returns explicit safe validation message when artist is not found in catalog', async () => {
    mockSavePreference.mockRejectedValueOnce(
      new InvalidCatalogArtistError('non-existent-artist-id'),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await savePreferenceAction({
      artistId: 'non-existent-artist-id',
      artistName: 'Unknown Band',
      preferenceLevel: 'like',
    });

    expect(result.success).toBeUndefined();
    expect(result.error).toBe(
      'Selected artist does not exist in the concert catalog.',
    );

    consoleSpy.mockRestore();
  });

  it('returns error when user is not authenticated', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

    const result = await savePreferenceAction({
      artistName: 'Radiohead',
      preferenceLevel: 'favorite',
    });

    expect(result.error).toBe('You must be signed in to manage preferences.');
    expect(mockSavePreference).not.toHaveBeenCalled();
  });

  it('rejects invalid inputs before invoking database repository', async () => {
    const emptyResult = await savePreferenceAction({
      artistName: '   ',
      preferenceLevel: 'favorite',
    });
    expect(emptyResult.error).toBe(
      'Artist name must be between 1 and 150 characters.',
    );

    const longResult = await savePreferenceAction({
      artistName: 'A'.repeat(151),
      preferenceLevel: 'favorite',
    });
    expect(longResult.error).toBe(
      'Artist name must be between 1 and 150 characters.',
    );

    const invalidLevelResult = await savePreferenceAction({
      artistName: 'Valid Band',
      // @ts-expect-error testing runtime check
      preferenceLevel: 'super_fan',
    });
    expect(invalidLevelResult.error).toContain('Invalid preference level');

    expect(mockSavePreference).not.toHaveBeenCalled();
  });

  it('returns success and preference data on valid save', async () => {
    const mockPreference = {
      id: 'pref-123',
      userId: 'test-user-id',
      artistId: 'canonical-id',
      artistName: 'Radiohead',
      normalizedArtistName: 'radiohead',
      preferenceLevel: 'favorite' as const,
      createdAt: '2026-10-14T00:00:00Z',
      updatedAt: '2026-10-14T00:00:00Z',
    };
    mockSavePreference.mockResolvedValueOnce(mockPreference);

    const result = await savePreferenceAction({
      artistId: 'canonical-id',
      artistName: 'Radiohead',
      preferenceLevel: 'favorite',
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.preference).toEqual(mockPreference);
  });
});
