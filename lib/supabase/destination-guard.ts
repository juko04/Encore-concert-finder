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
 * All remote hostnames are treated as production by default.
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
 * Asserts that a target database URL is safe for execution.
 * Throws an explicit error if the database is remote and no safety override was provided.
 */
export function assertSafeDatabaseTarget(
  urlStr: string,
  allowProductionWrite = false,
  context = 'Database operation',
): void {
  const isLocal = isVerifiedLocalOrDevDatabase(urlStr);

  if (!isLocal && !allowProductionWrite) {
    throw new Error(
      `${context} aborted: Target database (${urlStr || 'unknown'}) is not a verified local or development instance. ` +
        'Writing to remote or production databases requires deliberate authorization via --allow-production-write.',
    );
  }
}
