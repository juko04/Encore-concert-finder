import { describe, expect, it } from 'vitest';
import {
  isVerifiedLocalOrDevDatabase,
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

  it('rejects remote production databases by default', () => {
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

  it('assertSafeDatabaseTarget enforces safety overrides', () => {
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

    // Misleading remote fails without override
    expect(() =>
      assertSafeDatabaseTarget('https://evil-local.com', false),
    ).toThrow(/aborted: Target database/);
  });
});
