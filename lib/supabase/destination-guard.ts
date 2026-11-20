/**
 * Destination Safety Guard
 *
 * Enforces strict destination safety for database operations to prevent
 * destructive commands, fixture loading, or test runs from inadvertently
 * targeting production or unverified remote databases.
 */

const VERIFIED_LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'host.docker.internal',
]);

/**
 * Checks whether a given database URL strictly targets a verified local or development instance.
 *
 * Rejects substring-matching traps (e.g. "evil-local.com", "attacker.dev", "local.supabase.co").
 * All remote hostnames are treated as non-local by default.
 */
export function isVerifiedLocalOrDevDatabase(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(urlStr);

    // Protocol must be standard http or https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check strict equality against verified local hostnames
    if (VERIFIED_LOCAL_HOSTNAMES.has(hostname)) {
      return true;
    }

    // Check optional explicit approved development hostnames via environment
    const approvedHosts = process.env.ENCORE_APPROVED_DEV_HOSTS
      ? process.env.ENCORE_APPROVED_DEV_HOSTS.split(',').map((h) =>
          h.trim().toLowerCase(),
        )
      : [];

    if (approvedHosts.length > 0 && approvedHosts.includes(hostname)) {
      return true;
    }

    // Any other hostname (including remote Supabase projects, .dev domains, etc.) is non-local
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks whether a given database URL targets a verified Supabase instance or approved production domain.
 */
export function isVerifiedSupabaseInstance(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Must be a valid subdomain of supabase.co (e.g. xyzcompany.supabase.co, not just supabase.co)
    if (hostname.endsWith('.supabase.co') && hostname !== 'supabase.co') {
      return true;
    }

    // Check optional approved production hosts via environment
    const approvedProdHosts = process.env.ENCORE_APPROVED_PROD_HOSTS
      ? process.env.ENCORE_APPROVED_PROD_HOSTS.split(',').map((h) =>
          h.trim().toLowerCase(),
        )
      : [];

    if (approvedProdHosts.length > 0 && approvedProdHosts.includes(hostname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export interface ValidateDatabaseTargetOptions {
  allowProductionWrite?: boolean;
  isFixture?: boolean;
  context?: string;
}

/**
 * Validates a target database URL against safety invariants.
 *
 * Enforces that:
 * 1. Verified local/dev instances are always permitted.
 * 2. Remote/production writes are permitted ONLY when BOTH:
 *    a) allowProductionWrite === true (explicit opt-in flag).
 *    b) Target URL is a verified Supabase instance (.supabase.co) or approved production domain.
 * 3. STRICT INVARIANT: If isFixture === true, writing to production is strictly forbidden under all circumstances.
 */
export function validateDatabaseTarget(
  urlStr: string,
  options: ValidateDatabaseTargetOptions = {},
): { isLocal: boolean; isProduction: boolean } {
  const {
    allowProductionWrite = false,
    isFixture = false,
    context = 'Database operation',
  } = options;

  const isLocal = isVerifiedLocalOrDevDatabase(urlStr);

  if (isLocal) {
    return { isLocal: true, isProduction: false };
  }

  const isProd = isVerifiedSupabaseInstance(urlStr);

  // STRICT INVARIANT: If isFixture === true or synthetic fixtures are being run,
  // writing to production is STRICTLY FORBIDDEN under all circumstances.
  if (isFixture) {
    throw new Error(
      `${context} aborted: Synthetic fixture execution or test data writes are strictly forbidden against remote or production databases (${urlStr || 'unknown'}).`,
    );
  }

  if (!allowProductionWrite) {
    throw new Error(
      `${context} aborted: Target database (${urlStr || 'unknown'}) is not a verified local or development instance. ` +
        'Writing to remote or production databases requires deliberate authorization via --allow-production-write.',
    );
  }

  if (!isProd) {
    throw new Error(
      `${context} aborted: Target database (${urlStr || 'unknown'}) is not a verified Supabase instance (.supabase.co) or approved production domain.`,
    );
  }

  return { isLocal: false, isProduction: true };
}

/**
 * Asserts that a target database URL is safe for execution.
 * Throws an explicit error if safety criteria are not met.
 */
export function assertSafeDatabaseTarget(
  urlStr: string,
  allowProductionWrite = false,
  context = 'Database operation',
  isFixture = false,
): void {
  validateDatabaseTarget(urlStr, {
    allowProductionWrite,
    context,
    isFixture,
  });
}
