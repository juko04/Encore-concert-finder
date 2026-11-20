/**
 * Destination Safety Guard
 *
 * Enforces strict destination safety for database operations to prevent
 * destructive commands, fixture loading, or test runs from inadvertently
 * targeting production or unverified remote databases.
 *
 * Rejects generic wildcard Supabase URLs (*.supabase.co). Production targets
 * must be explicitly allowlisted via ENCORE_APPROVED_PROD_HOSTS or ENCORE_PROD_PROJECT_REF.
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
 * All remote hostnames are treated as non-local by default unless explicitly listed in ENCORE_APPROVED_DEV_HOSTS.
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
 * Checks whether a given database URL targets an explicitly approved production Supabase instance.
 *
 * Invariant: Does NOT accept generic *.supabase.co wildcards. The specific production hostname
 * or project reference MUST be explicitly authorized via ENCORE_APPROVED_PROD_HOSTS,
 * ENCORE_PROD_PROJECT_REF, or ENCORE_PROD_SUPABASE_URL.
 */
export function isVerifiedProductionDatabase(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Collect explicitly approved production hosts
    const approvedProdHosts = new Set<string>();

    if (process.env.ENCORE_APPROVED_PROD_HOSTS) {
      process.env.ENCORE_APPROVED_PROD_HOSTS.split(',').forEach((h) => {
        const trimmed = h.trim().toLowerCase();
        if (trimmed) approvedProdHosts.add(trimmed);
      });
    }

    if (process.env.ENCORE_PROD_PROJECT_REF) {
      const ref = process.env.ENCORE_PROD_PROJECT_REF.trim().toLowerCase();
      if (ref) {
        approvedProdHosts.add(`${ref}.supabase.co`);
      }
    }

    if (process.env.ENCORE_PROD_SUPABASE_URL) {
      try {
        const prodUrl = new URL(process.env.ENCORE_PROD_SUPABASE_URL);
        approvedProdHosts.add(prodUrl.hostname.toLowerCase());
      } catch {
        // ignore malformed env var
      }
    }

    if (approvedProdHosts.size > 0 && approvedProdHosts.has(hostname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Backward compatibility alias for isVerifiedProductionDatabase.
 * Verifies that the URL targets an explicitly approved production instance.
 */
export function isVerifiedSupabaseInstance(urlStr: string): boolean {
  return isVerifiedProductionDatabase(urlStr);
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
 *    a) Target URL is an explicitly approved production instance (via ENCORE_APPROVED_PROD_HOSTS / project ref).
 *    b) allowProductionWrite === true (explicit opt-in flag).
 * 3. STRICT INVARIANT: If isFixture === true, writing to production is strictly forbidden under all circumstances.
 * 4. Unapproved remote destinations (including arbitrary *.supabase.co URLs) are unconditionally rejected.
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

  // STRICT INVARIANT: If isFixture === true or synthetic fixtures are being run,
  // writing to production or remote is STRICTLY FORBIDDEN under all circumstances.
  if (isFixture) {
    throw new Error(
      `${context} aborted: Synthetic fixture execution or test data writes are strictly forbidden against remote or production databases (${urlStr || 'unknown'}).`,
    );
  }

  const isProd = isVerifiedProductionDatabase(urlStr);

  if (!isProd) {
    throw new Error(
      `${context} aborted: Target database (${urlStr || 'unknown'}) is not a verified local or development instance, and not an approved local, development, or production instance. ` +
        'Remote destinations must be explicitly allowlisted in ENCORE_APPROVED_PROD_HOSTS or match ENCORE_PROD_PROJECT_REF.',
    );
  }

  if (!allowProductionWrite) {
    throw new Error(
      `${context} aborted: Target database (${urlStr || 'unknown'}) is an approved remote production instance. ` +
        'Writing to remote or production databases requires deliberate authorization via --allow-production-write.',
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
