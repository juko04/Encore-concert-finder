import { describe, expect, it } from 'vitest';
import {
  isVerifiedLocalOrDevDatabase,
  isVerifiedSupabaseInstance,
  validateDatabaseTarget,
  assertSafeDatabaseTarget,
} from '@/lib/supabase/destination-guard';

describe('Destination Safety Guard: Database Target Verification', () => {
  it('correctly identifies valid local development hostnames', () => {
    expect(isVerifiedLocalOrDevDatabase('http://127.0.0.1:54321')).toBe(true);
    expect(isVerifiedLocalOrDevDatabase('http://localhost:54321')).toBe(true);
    expect(isVerifiedLocalOrDevDatabase('http://localhost:3000')).toBe(true);
    expect(isVerifiedLocalOrDevDatabase('http://0.0.0.0:54321')).toBe(true);
    expect(
      isVerifiedLocalOrDevDatabase('http://host.docker.internal:54321'),
    ).toBe(true);
    expect(isVerifiedLocalOrDevDatabase('http://[::1]:54321')).toBe(true);
  });

  it('correctly identifies verified Supabase instances', () => {
    expect(isVerifiedSupabaseInstance('https://xyzcompany.supabase.co')).toBe(
      true,
    );
    expect(
      isVerifiedSupabaseInstance('https://project-ref-123.supabase.co'),
    ).toBe(true);
    expect(isVerifiedSupabaseInstance('https://supabase.co')).toBe(false);
    expect(isVerifiedSupabaseInstance('https://evil-local.com')).toBe(false);
    expect(isVerifiedSupabaseInstance('https://not-supabase.co.evil.com')).toBe(
      false,
    );
  });

  it('rejects remote production databases by default in isVerifiedLocalOrDevDatabase', () => {
    expect(isVerifiedLocalOrDevDatabase('https://xyzcompany.supabase.co')).toBe(
      false,
    );
    expect(
      isVerifiedLocalOrDevDatabase('https://api.encore-production.com'),
    ).toBe(false);
  });

  it('rejects misleading remote hostnames containing "local" or ".dev"', () => {
    // Misleading URLs that substring checks would mistakenly classify as local/dev
    expect(isVerifiedLocalOrDevDatabase('https://evil-local.com')).toBe(false);
    expect(
      isVerifiedLocalOrDevDatabase('https://not-local-really.example.com'),
    ).toBe(false);
    expect(
      isVerifiedLocalOrDevDatabase('https://local.supabase.co:54321'),
    ).toBe(false);
    expect(
      isVerifiedLocalOrDevDatabase('https://supabase-local.attacker.net'),
    ).toBe(false);
    expect(isVerifiedLocalOrDevDatabase('https://attacker.dev')).toBe(false);
    expect(isVerifiedLocalOrDevDatabase('https://api.dev.company.com')).toBe(
      false,
    );
    expect(isVerifiedLocalOrDevDatabase('https://my-app.dev:54321')).toBe(
      false,
    );
    expect(isVerifiedLocalOrDevDatabase('https://supabase.local')).toBe(false);
  });

  it('rejects invalid or malformed URLs', () => {
    expect(isVerifiedLocalOrDevDatabase('')).toBe(false);
    expect(isVerifiedLocalOrDevDatabase('not-a-valid-url')).toBe(false);
    expect(isVerifiedLocalOrDevDatabase('ftp://localhost:21')).toBe(false);
    expect(isVerifiedLocalOrDevDatabase('javascript:void(0)')).toBe(false);
  });

  it('validateDatabaseTarget verifies all safety paths', () => {
    // 1. Local passes without allowProductionWrite
    const localRes = validateDatabaseTarget('http://127.0.0.1:54321');
    expect(localRes).toEqual({ isLocal: true, isProduction: false });

    // Local passes even with isFixture: true
    const localFixtureRes = validateDatabaseTarget('http://localhost:54321', {
      isFixture: true,
    });
    expect(localFixtureRes).toEqual({ isLocal: true, isProduction: false });

    // 2. Remote without flag fails
    expect(() =>
      validateDatabaseTarget('https://xyzcompany.supabase.co'),
    ).toThrow(/not a verified local or development instance/);

    expect(() =>
      validateDatabaseTarget('https://xyzcompany.supabase.co', {
        allowProductionWrite: false,
      }),
    ).toThrow(/not a verified local or development instance/);

    // 3. Remote with flag + fixtures fails (STRICT INVARIANT)
    expect(() =>
      validateDatabaseTarget('https://xyzcompany.supabase.co', {
        allowProductionWrite: true,
        isFixture: true,
      }),
    ).toThrow(
      /Synthetic fixture execution or test data writes are strictly forbidden against remote or production databases/,
    );

    // 4. Remote with flag + live passes
    const remoteProdRes = validateDatabaseTarget(
      'https://xyzcompany.supabase.co',
      {
        allowProductionWrite: true,
        isFixture: false,
      },
    );
    expect(remoteProdRes).toEqual({ isLocal: false, isProduction: true });

    // 5. Remote with flag, but unverified remote domain fails
    expect(() =>
      validateDatabaseTarget('https://evil-local.com', {
        allowProductionWrite: true,
      }),
    ).toThrow(/not a verified Supabase instance/);
  });

  it('assertSafeDatabaseTarget enforces safety overrides and fixture boundary', () => {
    // Local passes without override
    expect(() =>
      assertSafeDatabaseTarget('http://127.0.0.1:54321', false),
    ).not.toThrow();

    // Remote fails without override
    expect(() =>
      assertSafeDatabaseTarget('https://xyzcompany.supabase.co', false),
    ).toThrow(/aborted: Target database/);

    // Remote passes with deliberate override
    expect(() =>
      assertSafeDatabaseTarget('https://xyzcompany.supabase.co', true),
    ).not.toThrow();

    // Remote fails with deliberate override if isFixture is true
    expect(() =>
      assertSafeDatabaseTarget(
        'https://xyzcompany.supabase.co',
        true,
        'Test Suite',
        true,
      ),
    ).toThrow(/Synthetic fixture execution/);

    // Misleading remote fails without override
    expect(() =>
      assertSafeDatabaseTarget('https://evil-local.com', false),
    ).toThrow(/aborted: Target database/);

    // Misleading remote fails even with override because it's not a verified Supabase instance
    expect(() =>
      assertSafeDatabaseTarget('https://evil-local.com', true),
    ).toThrow(/not a verified Supabase instance/);
  });
});
