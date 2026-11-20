import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { cleanLiveTestSources } from '@/scripts/verify-live-ingestion';

describe('Live Verification Cleanup Isolation & Safety Guards (Finding 4)', () => {
  const originalEnv = process.env;
  const mockAdminClient = {
    from: vi.fn(),
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Point to local development database URL
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('strictly refuses cleanup and throws error when ENCORE_DISPOSABLE_TEST_DB is not set to true', async () => {
    delete process.env.ENCORE_DISPOSABLE_TEST_DB;

    await expect(
      cleanLiveTestSources(
        mockAdminClient as unknown as Parameters<
          typeof cleanLiveTestSources
        >[0],
        { confirmDisposableCleanup: true },
      ),
    ).rejects.toThrow(
      /\[CLEANUP SAFETY VIOLATION\] Destructive test cleanup requires ENCORE_DISPOSABLE_TEST_DB=true/i,
    );
  });

  it('strictly refuses cleanup and throws error when confirmDisposableCleanup flag is omitted or false', async () => {
    process.env.ENCORE_DISPOSABLE_TEST_DB = 'true';

    await expect(
      cleanLiveTestSources(
        mockAdminClient as unknown as Parameters<
          typeof cleanLiveTestSources
        >[0],
        { confirmDisposableCleanup: false },
      ),
    ).rejects.toThrow(
      /\[CLEANUP SAFETY VIOLATION\] Destructive test cleanup requires ENCORE_DISPOSABLE_TEST_DB=true/i,
    );

    await expect(
      cleanLiveTestSources(
        mockAdminClient as unknown as Parameters<
          typeof cleanLiveTestSources
        >[0],
        {},
      ),
    ).rejects.toThrow(
      /\[CLEANUP SAFETY VIOLATION\] Destructive test cleanup requires ENCORE_DISPOSABLE_TEST_DB=true/i,
    );
  });

  it('strictly refuses cleanup against non-local databases even when both safety flags are present', async () => {
    process.env.ENCORE_DISPOSABLE_TEST_DB = 'true';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://some-remote-db.supabase.co';

    await expect(
      cleanLiveTestSources(
        mockAdminClient as unknown as Parameters<
          typeof cleanLiveTestSources
        >[0],
        { confirmDisposableCleanup: true },
      ),
    ).rejects.toThrow(/strictly prohibited against non-local databases/i);
  });
});
