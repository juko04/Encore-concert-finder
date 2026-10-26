import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  updateRecommendationPresetAction,
  updateTravelRadiusAction,
  updateTypicalBudgetAction,
  getPersonalizedRecommendationsAction,
  getPublicDiscoverAction,
} from '@/app/discover/actions';
import type { User } from '@supabase/supabase-js';

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

const mockUpsertProfile = vi.fn();
vi.mock('@/lib/repositories/profile-repository', () => ({
  SupabaseProfileRepository: vi.fn().mockImplementation(() => ({
    upsertProfile: mockUpsertProfile,
  })),
}));

const mockGetPersonalizedDiscoverData = vi.fn();
const mockGetPublicDiscoverData = vi.fn();
vi.mock('@/lib/recommendation/service', () => ({
  getPersonalizedDiscoverData: (...args: unknown[]) =>
    mockGetPersonalizedDiscoverData(...args),
  getPublicDiscoverData: (...args: unknown[]) =>
    mockGetPublicDiscoverData(...args),
}));

import { getAuthenticatedUser } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';

describe('Discover Server Actions', () => {
  const mockUser: User = {
    id: 'user-discover-123',
    email: 'listener@encore.test',
  } as unknown as User;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedUser).mockResolvedValue(mockUser);
    mockUpsertProfile.mockResolvedValue({ id: 'user-discover-123' });
  });

  describe('updateRecommendationPresetAction', () => {
    it('requires an authenticated user', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const res = await updateRecommendationPresetAction('balanced');

      expect(res.error).toBe(
        'You must be signed in to change recommendation settings.',
      );
      expect(res.success).toBeUndefined();
      expect(mockUpsertProfile).not.toHaveBeenCalled();
    });

    it('rejects invalid presets', async () => {
      const res = await updateRecommendationPresetAction('invalid_preset');

      expect(res.error).toContain('Invalid recommendation preset');
      expect(res.success).toBeUndefined();
      expect(mockUpsertProfile).not.toHaveBeenCalled();
    });

    it('rejects unsupported legacy preset aliases if not valid', async () => {
      const res = await updateRecommendationPresetAction('custom');

      expect(res.error).toContain('Invalid recommendation preset');
      expect(res.success).toBeUndefined();
      expect(mockUpsertProfile).not.toHaveBeenCalled();
    });

    it.each([
      ['balanced', 'balanced'],
      ['artist_first', 'artist_first'],
      ['nearby', 'nearby'],
      ['value', 'value'],
    ] as const)(
      'persists valid preset %s and revalidates /discover',
      async (input, expected) => {
        const res = await updateRecommendationPresetAction(input);

        expect(res.success).toBe(true);
        expect(res.data?.preset).toBe(expected);
        expect(mockUpsertProfile).toHaveBeenCalledWith(mockUser.id, {
          recommendationPreset: expected,
        });
        expect(revalidatePath).toHaveBeenCalledWith('/discover');
      },
    );

    it('handles repository failure gracefully without leaking sensitive database errors', async () => {
      mockUpsertProfile.mockRejectedValueOnce(
        new Error(
          'FATAL: connection to server at "127.0.0.1", port 5432 failed: FATAL: password authentication failed for user "postgres"',
        ),
      );

      const res = await updateRecommendationPresetAction('balanced');

      expect(res.error).toBe(
        'Unable to update recommendation preset. Please try again.',
      );
      expect(res.error).not.toContain('postgres');
      expect(res.error).not.toContain('5432');
      expect(res.error).not.toContain('FATAL');
      expect(res.success).toBeUndefined();
    });
  });

  describe('updateTravelRadiusAction', () => {
    it('requires an authenticated user', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const res = await updateTravelRadiusAction(50);

      expect(res.error).toBe(
        'You must be signed in to change recommendation settings.',
      );
      expect(mockUpsertProfile).not.toHaveBeenCalled();
    });

    it.each([0, -10, 4, 501, 1000, 25.5, NaN, 'not-a-number'])(
      'rejects invalid radius %s',
      async (invalidRadius) => {
        const res = await updateTravelRadiusAction(invalidRadius);

        expect(res.error).toContain(
          'Travel radius must be an integer between 5 and 500 miles.',
        );
        expect(mockUpsertProfile).not.toHaveBeenCalled();
      },
    );

    it('persists valid travel radius and revalidates /discover', async () => {
      const res = await updateTravelRadiusAction(75);

      expect(res.success).toBe(true);
      expect(res.data?.radiusMiles).toBe(75);
      expect(mockUpsertProfile).toHaveBeenCalledWith(mockUser.id, {
        defaultRadiusMiles: 75,
      });
      expect(revalidatePath).toHaveBeenCalledWith('/discover');
    });

    it('handles string representation of integer within bounds', async () => {
      const res = await updateTravelRadiusAction('100');

      expect(res.success).toBe(true);
      expect(res.data?.radiusMiles).toBe(100);
      expect(mockUpsertProfile).toHaveBeenCalledWith(mockUser.id, {
        defaultRadiusMiles: 100,
      });
    });
  });

  describe('updateTypicalBudgetAction', () => {
    it('requires an authenticated user', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const res = await updateTypicalBudgetAction(60);

      expect(res.error).toBe(
        'You must be signed in to change recommendation settings.',
      );
      expect(mockUpsertProfile).not.toHaveBeenCalled();
    });

    it('accepts null to clear typical budget', async () => {
      const res = await updateTypicalBudgetAction(null);

      expect(res.success).toBe(true);
      expect(res.data?.maxNormalTicketPrice).toBeNull();
      expect(mockUpsertProfile).toHaveBeenCalledWith(mockUser.id, {
        maxNormalTicketPrice: null,
      });
      expect(revalidatePath).toHaveBeenCalledWith('/discover');
    });

    it.each([-1, 0, 1001, NaN, 'not-a-budget'])(
      'rejects invalid budget %s',
      async (invalidBudget) => {
        const res = await updateTypicalBudgetAction(invalidBudget);

        expect(res.error).toContain(
          'Typical budget must be a positive number up to $1,000, or null to clear.',
        );
        expect(mockUpsertProfile).not.toHaveBeenCalled();
      },
    );

    it('persists valid typical budget rounded to 2 decimal places', async () => {
      const res = await updateTypicalBudgetAction(85.555);

      expect(res.success).toBe(true);
      expect(res.data?.maxNormalTicketPrice).toBe(85.56);
      expect(mockUpsertProfile).toHaveBeenCalledWith(mockUser.id, {
        maxNormalTicketPrice: 85.56,
      });
      expect(revalidatePath).toHaveBeenCalledWith('/discover');
    });
  });

  describe('getPersonalizedRecommendationsAction', () => {
    it('requires an authenticated user', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValueOnce(null);

      const res = await getPersonalizedRecommendationsAction();

      expect(res.error).toBe(
        'You must be signed in to view personalized recommendations.',
      );
      expect(mockGetPersonalizedDiscoverData).not.toHaveBeenCalled();
    });

    it('rejects invalid preset override with explicit error', async () => {
      const res = await getPersonalizedRecommendationsAction({
        preset: 'invalid_preset' as any,
      });

      expect(res.error).toContain(
        "Invalid recommendation preset: 'invalid_preset'",
      );
      expect(res.success).toBeUndefined();
      expect(mockGetPersonalizedDiscoverData).not.toHaveBeenCalled();
    });

    it('sanitizes unexpected internal exceptions without leaking SQL or private diagnostics', async () => {
      mockGetPersonalizedDiscoverData.mockRejectedValueOnce(
        new Error(
          'SELECT * FROM events WHERE id = "bad" syntax error at position 42',
        ),
      );

      const res = await getPersonalizedRecommendationsAction({
        preset: 'balanced',
      });

      expect(res.error).toBe(
        'Unable to load recommendations. Please try again.',
      );
      expect(res.error).not.toContain('SELECT');
      expect(res.error).not.toContain('syntax error');
      expect(res.success).toBeUndefined();
    });
  });

  describe('getPublicDiscoverAction', () => {
    it('retrieves public events without requiring auth', async () => {
      mockGetPublicDiscoverData.mockResolvedValueOnce({
        isGuest: true,
        events: [],
        isEmptyCatalog: true,
      });

      const res = await getPublicDiscoverAction({ city: 'Boulder' });

      expect(res.success).toBe(true);
      expect(mockGetPublicDiscoverData).toHaveBeenCalledWith({
        city: 'Boulder',
        region: undefined,
        searchQuery: undefined,
      });
    });

    it('sanitizes public discovery errors without leaking internals', async () => {
      mockGetPublicDiscoverData.mockRejectedValueOnce(
        new Error('Database socket /tmp/s.PGSQL.5432 closed unexpectedly'),
      );

      const res = await getPublicDiscoverAction({ city: 'Denver' });

      expect(res.error).toBe('Unable to load public events. Please try again.');
      expect(res.error).not.toContain('5432');
      expect(res.error).not.toContain('PGSQL');
      expect(res.success).toBeUndefined();
    });
  });
});
