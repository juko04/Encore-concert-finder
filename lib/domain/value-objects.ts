/**
 * Phase 1 Value Objects and Normalization Rules
 * Includes conservative URL normalization, name normalization, IANA timezone validation,
 * local calendar date derivation, and ISO currency formatting.
 */

const KNOWN_TRACKING_PARAMS = new Set(['gclid', 'fbclid']);

const DISALLOWED_TIMEZONE_ABBREVIATIONS = new Set([
  'EST',
  'EDT',
  'CST',
  'CDT',
  'MST',
  'MDT',
  'PST',
  'PDT',
]);

/**
 * Conservatively normalizes URLs for matching and deduplication.
 * - Normalizes scheme and host casing (lowercased)
 * - Removes default ports (80 for http, 443 for https)
 * - Removes trailing slashes from pathname (preserving root '/')
 * - Strips fragments (#...)
 * - Strips known tracking parameters: utm_* parameters, gclid, and fbclid
 * - PRESERVES all other provider-specific query parameters
 * - Sorts query parameters deterministically
 */
export function normalizeUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('URL must be a non-empty string');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  // Scheme and host are lowercased by URL parser
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove default ports
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Remove trailing slash from pathname (except root '/')
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Strip fragment
  parsed.hash = '';

  // Filter query parameters: strip utm_*, gclid, fbclid; keep all others
  const keptParams: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('utm_') || KNOWN_TRACKING_PARAMS.has(lowerKey)) {
      return;
    }
    keptParams.push([key, value]);
  });

  // Sort deterministically by key, then value
  keptParams.sort(([k1, v1], [k2, v2]) => {
    const keyCompare = k1.localeCompare(k2);
    if (keyCompare !== 0) return keyCompare;
    return v1.localeCompare(v2);
  });

  // Rebuild search string
  if (keptParams.length > 0) {
    const newSearch = new URLSearchParams();
    for (const [k, v] of keptParams) {
      newSearch.append(k, v);
    }
    parsed.search = newSearch.toString();
  } else {
    parsed.search = '';
  }

  return parsed.toString();
}

/**
 * Normalizes artist, venue, promoter, and event names for match lookups.
 * - Trims whitespace
 * - Collapses consecutive whitespace
 * - Unicode NFKC normalization
 * - Lowercases
 * - Strips leading English articles ("the ", "a ", "an ")
 * - Strips punctuation marks
 */
export function normalizeName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  let normalized = name.normalize('NFKC').toLowerCase().trim();

  // Strip leading articles
  normalized = normalized.replace(/^(?:the|a|an)\s+/i, '');

  // Strip punctuation and special characters
  normalized = normalized.replace(/[.,/#!$%^&*;:{}=\-_`~()'"?@[\]]/g, ' ');

  // Collapse consecutive whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Validates that a string is a legitimate IANA time zone identifier.
 * Rejects 3-letter abbreviations like MST, EST, PST.
 */
export function validateIanaTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') {
    return false;
  }

  const trimmed = tz.trim();

  // Reject disallowed time zone abbreviations
  if (DISALLOWED_TIMEZONE_ABBREVIATIONS.has(trimmed.toUpperCase())) {
    return false;
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Derives the local calendar date (YYYY-MM-DD) from a UTC instant and an IANA timezone.
 * Never uses simple substring(0, 10) on UTC timestamps.
 */
export function deriveLocalDateFromInstant(
  instantIso: string,
  timeZone: string,
): string {
  if (!validateIanaTimezone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }

  const date = new Date(instantIso);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid instant ISO string: ${instantIso}`);
  }

  // en-CA produces YYYY-MM-DD in the specified timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

/**
 * Validates ISO-4217 currency code (3 uppercase letters).
 */
export function validateCurrency(currency: string): boolean {
  if (!currency || typeof currency !== 'string') {
    return false;
  }
  return /^[A-Z]{3}$/.test(currency.trim());
}

/**
 * Validates a monetary price.
 */
export function validatePrice(amount: number): boolean {
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0;
}

/**
 * Formats monetary price to 2 decimal places.
 */
export function formatPrice(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Formats a monetary amount according to its ISO currency code.
 * Uses Intl.NumberFormat instead of hardcoding any currency symbol.
 */
export function formatCurrencyAmount(
  amount: number,
  currency: string = 'USD',
  locale: string = 'en-US',
): string {
  const safeCurrency = validateCurrency(currency)
    ? currency.toUpperCase()
    : 'USD';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${safeCurrency} ${amount.toFixed(2)}`;
  }
}
