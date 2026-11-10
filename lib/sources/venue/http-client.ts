export interface VenueHttpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  userAgent?: string;
}

export interface VenueHttpGetOptions {
  redirect?: RequestRedirect;
  validateRedirectUrl?: (url: string) => boolean;
  maxRedirects?: number;
}

export interface VenueHttpResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  fetchedAt: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; EncoreConcertFinder/1.0; +https://encore.live)';

/**
 * Validates that a string is a well-formed HTTP/HTTPS URL and not a script/javascript link.
 */
export function isValidHttpUrl(urlStr?: string | null): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const trimmed = urlStr.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (/^javascript:/i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Shared polite HTTP client for fetching external venue calendars and pages.
 * Handles timeouts, polite headers, and exponential backoff on transient errors.
 */
export class VenueHttpClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly userAgent: string;

  constructor(options?: VenueHttpClientOptions) {
    this.timeoutMs = options?.timeoutMs ?? 10_000;
    this.maxRetries = options?.maxRetries ?? 2;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 500;
    this.userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
  }

  async get(
    url: string,
    options?: VenueHttpGetOptions,
  ): Promise<VenueHttpResponse> {
    let attempt = 0;
    let lastError: Error | null = null;

    // Validate initial URL if validateRedirectUrl is provided
    if (options?.validateRedirectUrl && !options.validateRedirectUrl(url)) {
      throw new Error(`Disallowed initial destination URL: ${url}`);
    }

    const maxRedirects = options?.maxRedirects ?? 3;
    const isManualRedirect = Boolean(options?.validateRedirectUrl);

    while (attempt <= this.maxRetries) {
      const fetchedAt = new Date().toISOString();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        let currentUrl = url;
        let redirectsFollowed = 0;
        let response: Response | null = null;

        while (true) {
          response = await fetch(currentUrl, {
            method: 'GET',
            headers: {
              'User-Agent': this.userAgent,
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache',
            },
            redirect: isManualRedirect
              ? 'manual'
              : (options?.redirect ?? 'follow'),
            signal: controller.signal,
          });

          // If manual redirect validation is active and a redirect status is returned:
          if (
            isManualRedirect &&
            response.status >= 300 &&
            response.status < 400
          ) {
            redirectsFollowed++;
            if (redirectsFollowed > maxRedirects) {
              throw new Error(
                `Exceeded maximum redirect limit of ${maxRedirects}`,
              );
            }

            const location = response.headers.get('location');
            if (!location) {
              throw new Error(
                `Redirect response from ${currentUrl} missing Location header`,
              );
            }

            let nextUrl: string;
            try {
              nextUrl = new URL(location, currentUrl).toString();
            } catch {
              throw new Error(
                `Invalid redirect Location header from ${currentUrl}: ${location}`,
              );
            }

            // CRITICAL: Validate destination URL BEFORE making the next network request!
            if (!options!.validateRedirectUrl!(nextUrl)) {
              throw new Error(`Disallowed redirect destination: ${nextUrl}`);
            }

            currentUrl = nextUrl;
            continue;
          }

          break;
        }

        clearTimeout(timeoutId);

        if (!response) {
          throw new Error(`No response received for ${url}`);
        }

        // Handle retryable status codes (429 Too Many Requests, 502/503/504 server errors)
        if (
          (response.status === 429 ||
            (response.status >= 500 && response.status <= 504)) &&
          attempt < this.maxRetries
        ) {
          const retryAfterSec = Number(response.headers.get('Retry-After'));
          const delay =
            !isNaN(retryAfterSec) && retryAfterSec > 0
              ? retryAfterSec * 1000
              : this.retryBaseDelayMs * Math.pow(2, attempt) +
                Math.random() * 200;

          attempt++;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (!response.ok) {
          throw new Error(
            `Venue HTTP fetch failed for ${currentUrl} with status ${response.status} (${response.statusText})`,
          );
        }

        const contentType = response.headers.get('content-type') || 'text/html';
        const body = await response.text();

        return {
          url: response.url || currentUrl,
          status: response.status,
          contentType,
          body,
          fetchedAt,
        };
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;

        // Never retry security validation or redirect limit errors
        if (
          error.message.includes('Disallowed') ||
          error.message.includes('redirect')
        ) {
          throw error;
        }

        // If aborted due to timeout, retry if attempts remain
        if (attempt < this.maxRetries) {
          attempt++;
          const delay =
            this.retryBaseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        break;
      }
    }

    throw (
      lastError ??
      new Error(`Failed to fetch ${url} after ${this.maxRetries} retries`)
    );
  }
}
