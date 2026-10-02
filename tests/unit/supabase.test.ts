import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient as createBrowserClient } from '@/lib/supabase/browser';
import { createAdminClient } from '@/lib/supabase/admin';
import { resetPublicEnvCache } from '@/lib/env/public';
import { resetServerEnvCache } from '@/lib/env/server';

describe('Supabase Client Factories', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetPublicEnvCache();
    resetServerEnvCache();
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-anon-key-valid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-valid';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetPublicEnvCache();
    resetServerEnvCache();
  });

  it('creates browser client with public configuration', () => {
    const client = createBrowserClient();
    expect(client).toBeDefined();
    expect(client.auth).toBeDefined();
  });

  it('creates admin client with service role configuration in server environment', () => {
    const admin = createAdminClient();
    expect(admin).toBeDefined();
    expect(admin.auth).toBeDefined();
  });

  it('prevents admin client creation in browser environment', () => {
    // @ts-expect-error Simulating browser window
    global.window = {};

    try {
      expect(() => createAdminClient()).toThrowError(
        /Supabase admin client cannot be instantiated in a browser environment/,
      );
    } finally {
      // @ts-expect-error cleanup
      delete global.window;
    }
  });

  it('enforces build-time server-only boundary via server-only import', () => {
    const adminFilePath = path.resolve(
      __dirname,
      '../../lib/supabase/admin.ts',
    );
    const content = fs.readFileSync(adminFilePath, 'utf-8');
    expect(content.startsWith("import 'server-only';")).toBe(true);
  });
});
