/**
 * Shared URL validation helpers.
 */

/**
 * Validates that a string is a valid HTTP or HTTPS URL.
 * Rejects non-HTTP schemes (e.g. javascript:, file:), malformed URLs, and non-string inputs.
 */
export function isValidHttpUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
