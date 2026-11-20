import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isVerifiedLocalOrDevDatabase,
  isVerifiedProductionDatabase,
  isVerifiedSupabaseInstance,
  validateDatabaseTarget,
  assertSafeDatabaseTarget,
} from '@/lib/supabase/destination-guard';

describe('Destination Safety Guard: Database Target Verification', () => {
  const originalApprovedProdHosts = process.env.ENCORE_APPROVED_PROD_HOSTS;
  const originalApprovedDevHosts = process.env.ENCORE_APPROVED_DEV_HOSTS;
  const originalProdProjectRef = process.env.ENCORE_PROD_PROJECT_REF;
  const originalProdUrl = process.env.ENCORE_PROD_SUPABASE_URL;

  beforeEach(() => {
    delete process.env.ENCORE_APPROVED_PROD_HOSTS;
    delete process.env.ENCORE_APPROVED_DEV_HOSTS;
    delete process.env.ENCORE_PROD_PROJECT_REF;
    delete process.env.ENCORE_PROD_SUPABASE_URL;
  });

  afterEach(() => {
    if (originalApprovedProdHosts !== undefined) {
      process.env.ENCORE_APPROVED_PROD_HOSTS = originalApprovedProdHosts;
    } else {
      delete process.env.ENCORE_APPROVED_PROD_HOSTS;
    }
    if (originalApprovedDevHosts !== undefined) {
      process.env.ENCORE_APPROVED_DEV_HOSTS = originalApprovedDevHosts;
    } else {
      delete process.env.ENCORE_APPROVED_DEV_HOSTS;
    }
    if (originalProdProjectRef !== undefined) {
      process.env.ENCORE_PROD_PROJECT_REF = originalProdProjectRef;
    } else {
      delete process.env.ENCORE_PROD_PROJECT_REF;
    }
    if (originalProdUrl !== undefined) {
      process.env.ENCORE_PROD_SUPABASE_URL = originalProdUrl;
    } else {
      delete process.env.ENCORE_PROD_SUPABASE_URL;
    }
  });

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

  it('rejects generic *.supabase.co wildcards by default unless explicitly allowlisted', () => {
    // Unapproved arbitrary Supabase URLs must be rejected
    expect(isVerifiedProductionDatabase('https://xyzcompany.supabase.co')).toBe(
      false,
    );
    expect(
      isVerifiedProductionDatabase('https://project-ref-123.supabase.co'),
    ).toBe(false);
    expect(isVerifiedProductionDatabase('https://supabase.co')).toBe(false);
    expect(isVerifiedProductionDatabase('https://evil-local.com')).toBe(false);

    // Explicitly allowlisted via ENCORE_APPROVED_PROD_HOSTS
    process.env.ENCORE_APPROVED_PROD_HOSTS =
      'xyzcompany.supabase.co, encore-prod.supabase.co';
    expect(isVerifiedProductionDatabase('https://xyzcompany.supabase.co')).toBe(
      true,
    );
    expect(
      isVerifiedProductionDatabase('https://encore-prod.supabase.co'),
    ).toBe(true);
    // An attacker-controlled or unapproved Supabase host is still rejected!
    expect(
      isVerifiedProductionDatabase('https://attacker-project.supabase.co'),
    ).toBe(false);
  });

  it('authorizes production target via ENCORE_PROD_PROJECT_REF', () => {
    process.env.ENCORE_PROD_PROJECT_REF = 'my-project-ref';
    expect(
      isVerifiedProductionDatabase('https://my-project-ref.supabase.co'),
    ).toBe(true);
    expect(
      isVerifiedProductionDatabase('https://other-project.supabase.co'),
    ).toBe(false);
  });

  it('rejects remote production databases by default in isVerifiedLocalOrDevDatabase', () => {
    process.env.ENCORE_APPROVED_PROD_HOSTS = 'xyzcompany.supabase.co';
    expect(isVerifiedLocalOrDevDatabase('https://xyzcompany.supabase.co')).toBe(
      false,
    );
    expect(
      isVerifiedLocalOrDevDatabase('https://api.encore-production.com'),
    ).toBe(false);
  });

  it('allows staging remote dev hosts when explicitly listed in ENCORE_APPROVED_DEV_HOSTS', () => {
    process.env.ENCORE_APPROVED_DEV_HOSTS = 'staging.encore.internal';
    expect(
      isVerifiedLocalOrDevDatabase('https://staging.encore.internal'),
    ).toBe(true);
    expect(isVerifiedLocalOrDevDatabase('https://other.encore.internal')).toBe(
      false,
    );
  });

  it('rejects misleading remote hostnames containing "local" or ".dev"', () => {
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

  it('validateDatabaseTarget enforces local vs production authorization and fixture isolation', () => {
    process.env.ENCORE_APPROVED_PROD_HOSTS = 'xyzcompany.supabase.co';

    // 1. Local passes without allowProductionWrite
    const localRes = validateDatabaseTarget('http://127.0.0.1:54321');
    expect(localRes).toEqual({ isLocal: true, isProduction: false });

    // Local passes even with isFixture: true
    const localFixtureRes = validateDatabaseTarget('http://localhost:54321', {
      isFixture: true,
    });
    expect(localFixtureRes).toEqual({ isLocal: true, isProduction: false });

    // 2. Unapproved remote fails even with allowProductionWrite
    expect(() =>
      validateDatabaseTarget('https://unapproved.supabase.co', {
        allowProductionWrite: true,
      }),
    ).toThrow(/not an approved local, development, or production instance/);

    // 3. Approved remote without allowProductionWrite fails
    expect(() =>
      validateDatabaseTarget('https://xyzcompany.supabase.co', {
        allowProductionWrite: false,
      }),
    ).toThrow(
      /Writing to remote or production databases requires deliberate authorization/,
    );

    // 4. Approved remote with allowProductionWrite passes
    const remoteProdRes = validateDatabaseTarget(
      'https://xyzcompany.supabase.co',
      {
        allowProductionWrite: true,
        isFixture: false,
      },
    );
    expect(remoteProdRes).toEqual({ isLocal: false, isProduction: true });

    // 5. Approved remote with flag + fixtures fails (STRICT INVARIANT)
    expect(() =>
      validateDatabaseTarget('https://xyzcompany.supabase.co', {
        allowProductionWrite: true,
        isFixture: true,
      }),
    ).toThrow(
      /Synthetic fixture execution or test data writes are strictly forbidden against remote or production databases/,
    );
  });

  it('assertSafeDatabaseTarget enforces safety overrides and fixture boundary', () => {
    process.env.ENCORE_APPROVED_PROD_HOSTS = 'xyzcompany.supabase.co';

    // Local passes without override
    expect(() =>
      assertSafeDatabaseTarget('http://127.0.0.1:54321', false),
    ).not.toThrow();

    // Approved remote fails without override
    expect(() =>
      assertSafeDatabaseTarget('https://xyzcompany.supabase.co', false),
    ).toThrow(/aborted: Target database/);

    // Approved remote passes with deliberate override
    expect(() =>
      assertSafeDatabaseTarget('https://xyzcompany.supabase.co', true),
    ).not.toThrow();

    // Approved remote fails with deliberate override if isFixture is true
    expect(() =>
      assertSafeDatabaseTarget(
        'https://xyzcompany.supabase.co',
        true,
        'Test Suite',
        true,
      ),
    ).toThrow(/Synthetic fixture execution/);

    // Unapproved remote fails even with override
    expect(() =>
      assertSafeDatabaseTarget('https://evil-supabase.co', true),
    ).toThrow(/not an approved local, development, or production instance/);
  });
});
