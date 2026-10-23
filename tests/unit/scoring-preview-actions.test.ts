import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getScoringPreviewAction } from '@/app/discover/scoring-preview/actions';
import * as previewGuard from '@/lib/recommendation/preview-guard';

// Mock Supabase server client
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: mockGetUser,
    },
    from: mockFrom,
  })),
}));

describe('Scoring Preview Server Action — Controlled Failures & Security Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(previewGuard, 'isScoringPreviewAllowed').mockReturnValue(true);
  });

  it('Condition 1: Supabase client initialization failure returns sanitized error without synthetic fallback', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    vi.mocked(createClient).mockRejectedValueOnce(
      new Error('Connection refused to postgres://internal-host:5432/db'),
    );

    const res = await getScoringPreviewAction();

    expect(res.error).toBeDefined();
    expect(res.error).toContain('Authentication client initialization failed');
    expect(res.error).not.toContain('postgres://');
    expect(res.error).not.toContain('internal-host');
    expect(res.usingFixtures).toBe(false);
    expect(res.dataSource).toBe('canonical_catalog');
    expect(res.isSyntheticDemo).toBe(false);
    expect(res.result.recommendations).toHaveLength(0);
  });

  it('Condition 2: Thrown auth.getUser() failure returns sanitized error without synthetic fallback', async () => {
    mockGetUser.mockRejectedValueOnce(
      new Error('ETIMEDOUT to auth.supabase.co/auth/v1/user'),
    );

    const res = await getScoringPreviewAction();

    expect(res.error).toBeDefined();
    expect(res.error).toContain('Authentication service request failed');
    expect(res.error).not.toContain('ETIMEDOUT');
    expect(res.error).not.toContain('supabase.co');
    expect(res.usingFixtures).toBe(false);
    expect(res.dataSource).toBe('canonical_catalog');
    expect(res.isSyntheticDemo).toBe(false);
    expect(res.result.recommendations).toHaveLength(0);
  });

  it('Condition 3: Actual auth.getUser() error response (not normal no-session) returns sanitized error without fixture substitution', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: 'AuthApiError',
        message: 'Invalid JWT signature or upstream Auth token revoked',
        status: 401,
      },
    });

    const res = await getScoringPreviewAction();

    expect(res.error).toBeDefined();
    expect(res.error).toContain('Authentication session verification failed');
    expect(res.usingFixtures).toBe(false);
    expect(res.dataSource).toBe('canonical_catalog');
    expect(res.isSyntheticDemo).toBe(false);
    expect(res.result.recommendations).toHaveLength(0);
  });

  it('Condition 4: Genuine unauthenticated guest (normal no-session) loads clearly identified guest demo mode', async () => {
    // Normal no-session response (AuthSessionMissingError or null error with null user)
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: {
        name: 'AuthSessionMissingError',
        message: 'Auth session missing!',
      },
    });

    const res = await getScoringPreviewAction();

    expect(res.error).toBeUndefined();
    expect(res.isGuest).toBe(true);
    expect(res.usingFixtures).toBe(true);
    expect(res.dataSource).toBe('synthetic_fixtures');
    expect(res.isSyntheticDemo).toBe(true);
    expect(res.result.recommendations.length).toBeGreaterThan(0);
  });

  it('Condition 5: Explicit useFixtures: true loads labeled synthetic data for approved preview', async () => {
    // Authenticated user, but explicitly requesting fixture preview
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'authenticated-user-uuid' } },
      error: null,
    });

    const res = await getScoringPreviewAction({ useFixtures: true });

    expect(res.error).toBeUndefined();
    expect(res.isGuest).toBe(false);
    expect(res.usingFixtures).toBe(true);
    expect(res.dataSource).toBe('synthetic_fixtures');
    expect(res.isSyntheticDemo).toBe(true);
    expect(res.result.recommendations.length).toBeGreaterThan(0);
  });

  it('Condition 6: Authenticated live catalog query failure returns sanitized error without fixture substitution', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'authenticated-user-uuid' } },
      error: null,
    });

    // Mock catalog database failure
    mockFrom.mockImplementationOnce(() => {
      throw new Error('relation "events" does not exist in schema "public"');
    });

    const res = await getScoringPreviewAction({ useFixtures: false });

    expect(res.error).toBeDefined();
    expect(res.error).toContain(
      'Unable to load live catalog events from the database',
    );
    expect(res.error).not.toContain('relation "events"');
    expect(res.usingFixtures).toBe(false);
    expect(res.dataSource).toBe('canonical_catalog');
    expect(res.isSyntheticDemo).toBe(false);
    expect(res.result.recommendations).toHaveLength(0);
  });

  it('Condition 7: Disabled environment strictly prevents execution and leaks zero data', async () => {
    vi.spyOn(previewGuard, 'isScoringPreviewAllowed').mockReturnValue(false);

    const res = await getScoringPreviewAction({ useFixtures: true });

    expect(res.error).toContain('disabled in this environment');
    expect(res.usingFixtures).toBe(false);
    expect(res.dataSource).toBe('canonical_catalog');
    expect(res.isSyntheticDemo).toBe(false);
    expect(res.result.recommendations).toHaveLength(0);
  });
});
