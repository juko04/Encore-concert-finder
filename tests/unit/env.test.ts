import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPublicEnv, resetPublicEnvCache } from '@/lib/env/public';
import { getServerEnv, resetServerEnvCache } from '@/lib/env/server';

describe('Environment Variable Modules', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetPublicEnvCache();
    resetServerEnvCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetPublicEnvCache();
    resetServerEnvCache();
  });

  describe('Public Environment', () => {
    it('throws descriptive error when required variables are missing', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      expect(() => getPublicEnv()).toThrowError(
        /Invalid public environment configuration/,
      );
    });

    it('successfully parses valid public environment', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

      const env = getPublicEnv();
      expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://example.supabase.co');
      expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
        'test-publishable-key',
      );
      expect(env.NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    });

    it('falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY if publishable key is not set', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

      const env = getPublicEnv();
      expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe('test-anon-key');
    });
  });

  describe('Server Environment', () => {
    it('throws error when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      expect(() => getServerEnv()).toThrowError(
        /SUPABASE_SERVICE_ROLE_KEY is required/,
      );
    });

    it('successfully parses valid server environment', () => {
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      const env = getServerEnv();
      expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('test-service-role-key');
    });

    it('throws error when accessed in browser context', () => {
      // Simulate browser window object
      // @ts-expect-error simulating window
      global.window = {};

      try {
        expect(() => getServerEnv()).toThrowError(
          /Server environment variables cannot be accessed in the browser/,
        );
      } finally {
        // @ts-expect-error cleaning up window
        delete global.window;
      }
    });
  });
});
