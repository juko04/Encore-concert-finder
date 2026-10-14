/**
 * Authentication Redirect Safety
 * Validates and sanitizes post-authentication redirection destinations.
 * Enforces strict destination safety by restricting redirects to safe internal relative application paths.
 * Rejects external URLs, protocol-relative paths (//...), backslashes, control characters, and scheme injections.
 */

export function sanitizeRedirectPath(
  rawPath?: string | null,
  fallback = '/profile/taste',
): string {
  if (!rawPath || typeof rawPath !== 'string') {
    return fallback;
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return fallback;
  }

  // Must begin with a single forward slash
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return fallback;
  }

  // Reject backslashes which browsers may normalize into domain separators
  if (trimmed.includes('\\')) {
    return fallback;
  }

  // Reject control characters and newlines
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return fallback;
  }

  // Reject protocol scheme injections (e.g. /https://evil.com or /javascript:...)
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, 'http://localhost');
    if (parsed.origin !== 'http://localhost') {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
