import {
  redactSensitiveString,
  redactSensitiveUrl,
  TicketmasterEventQueryParams,
  TicketmasterEventsResponse,
  TicketmasterEventsResponseSchema,
} from './types';
import { getServerEnv } from '@/lib/env/server';

export interface TicketmasterClientOptions {
  apiKey?: string;
  baseUrl?: string;
  requestsPerSecond?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

import {
  NonRetryableError,
  TicketmasterAuthError,
  TicketmasterError,
  TicketmasterNetworkError,
  TicketmasterRateLimitError,
  TicketmasterValidationError,
} from './errors';

export {
  NonRetryableError,
  TicketmasterAuthError,
  TicketmasterError,
  TicketmasterNetworkError,
  TicketmasterRateLimitError,
  TicketmasterValidationError,
};

export class TicketmasterApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private lastRequestTime = 0;
  private rateLimitQueue: Promise<void> = Promise.resolve();

  constructor(options?: TicketmasterClientOptions) {
    let resolvedKey = options?.apiKey || process.env.TICKETMASTER_API_KEY;

    if (!resolvedKey) {
      try {
        const env = getServerEnv();
        resolvedKey = env.TICKETMASTER_API_KEY;
      } catch {
        // getServerEnv throws if in browser or if service role is missing
      }
    }

    this.apiKey = resolvedKey || '';
    this.baseUrl = (
      options?.baseUrl || 'https://app.ticketmaster.com/discovery/v2'
    ).replace(/\/+$/, '');

    // Default conservatively to 2 requests/second (500ms spacing) due to provider FAQ limits
    const rps = options?.requestsPerSecond ?? 2;
    this.minIntervalMs = Math.max(100, Math.ceil(1000 / rps));
    this.maxRetries = options?.maxRetries ?? 3;
    this.timeoutMs = options?.timeoutMs ?? 10000;
  }

  /**
   * Enforces inter-request rate limiting delay in a concurrency-safe manner.
   */
  private async enforceRateLimit(): Promise<void> {
    const queueItem = this.rateLimitQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.minIntervalMs) {
        const waitTime = this.minIntervalMs - elapsed;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
      this.lastRequestTime = Date.now();
    });

    this.rateLimitQueue = queueItem.catch(() => {});
    await queueItem;
  }

  /**
   * Builds the query URL with query parameters.
   */
  buildRequestUrl(params: TicketmasterEventQueryParams): URL {
    const url = new URL(`${this.baseUrl}/events.json`);

    url.searchParams.set('apikey', this.apiKey);
    url.searchParams.set(
      'classificationName',
      params.classificationName ?? 'Music',
    );

    if (params.size !== undefined) {
      url.searchParams.set('size', String(params.size));
    }
    if (params.page !== undefined) {
      url.searchParams.set('page', String(params.page));
    }
    if (params.keyword) {
      url.searchParams.set('keyword', params.keyword);
    }
    if (params.attractionId) {
      url.searchParams.set('attractionId', params.attractionId);
    }
    if (params.venueId) {
      url.searchParams.set('venueId', params.venueId);
    }
    if (params.stateCode) {
      url.searchParams.set('stateCode', params.stateCode);
    }
    if (params.marketId) {
      url.searchParams.set('marketId', params.marketId);
    }
    if (params.city) {
      url.searchParams.set('city', params.city);
    }
    if (params.countryCode) {
      url.searchParams.set('countryCode', params.countryCode);
    }
    if (params.startDateTime) {
      url.searchParams.set('startDateTime', params.startDateTime);
    }
    if (params.endDateTime) {
      url.searchParams.set('endDateTime', params.endDateTime);
    }
    if (params.sort) {
      url.searchParams.set('sort', params.sort);
    }

    return url;
  }

  /**
   * Fetches events with rate limiting, retries on 429/5xx, and credential redaction.
   */
  async fetchEvents(params: TicketmasterEventQueryParams = {}): Promise<{
    response: TicketmasterEventsResponse;
    rawJson: string;
    url: string;
  }> {
    if (!this.apiKey) {
      throw new TicketmasterAuthError(
        'Ticketmaster API key is required. Provide it in constructor options or set TICKETMASTER_API_KEY environment variable.',
      );
    }

    if (params.page !== undefined) {
      if (!Number.isInteger(params.page) || params.page < 0) {
        throw new TicketmasterValidationError(
          `Invalid page parameter: ${params.page}. Page must be a non-negative integer.`,
          { statusCode: 400 },
        );
      }
    }
    if (params.size !== undefined) {
      if (
        !Number.isInteger(params.size) ||
        params.size < 1 ||
        params.size > 200
      ) {
        throw new TicketmasterValidationError(
          `Invalid size parameter: ${params.size}. Size must be an integer between 1 and 200.`,
          { statusCode: 400 },
        );
      }
    }

    const size = params.size ?? 20;
    const page = params.page ?? 0;

    // Enforce Ticketmaster Discovery API deep pagination boundary
    if (page * size >= 1000) {
      throw new TicketmasterValidationError(
        `Ticketmaster API deep pagination limit exceeded: page (${page}) * size (${size}) = ${
          page * size
        } >= 1000. Use narrower date or geographic filters.`,
        { statusCode: 400 },
      );
    }

    const url = this.buildRequestUrl({ ...params, size, page });
    const sanitizedUrl = redactSensitiveUrl(url.toString());

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      await this.enforceRateLimit();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await fetch(url.toString(), {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Encore-Concert-Finder/0.1.0',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const rawText = await res.text();
          let json: unknown;
          try {
            json = JSON.parse(rawText);
          } catch (parseErr) {
            throw new TicketmasterValidationError(
              `Malformed JSON response from Ticketmaster API at ${sanitizedUrl}: ${
                parseErr instanceof Error ? parseErr.message : String(parseErr)
              }`,
              { statusCode: 200, sanitizedUrl, cause: parseErr },
            );
          }

          const parsed = TicketmasterEventsResponseSchema.safeParse(json);
          if (!parsed.success) {
            const errorDetails = parsed.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ');
            throw new TicketmasterValidationError(
              `Ticketmaster API response schema validation failed at ${sanitizedUrl}: ${errorDetails}`,
              { statusCode: 200, sanitizedUrl, cause: parsed.error },
            );
          }

          return {
            response: parsed.data,
            rawJson: rawText,
            url: sanitizedUrl,
          };
        }

        // Handle 429 Too Many Requests (retryable with Retry-After)
        if (res.status === 429) {
          attempt++;
          if (attempt > this.maxRetries) {
            throw new TicketmasterRateLimitError(
              `Ticketmaster API rate limit exceeded (HTTP 429) at ${sanitizedUrl}. Max retries (${this.maxRetries}) reached.`,
              { statusCode: 429, sanitizedUrl },
            );
          }

          const retryAfterHeader = res.headers.get('Retry-After');
          let delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 250;

          if (retryAfterHeader) {
            const parsedSeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
              delayMs = parsedSeconds * 1000;
            } else {
              // Support HTTP-date in Retry-After (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
              const parsedDate = Date.parse(retryAfterHeader);
              if (!isNaN(parsedDate)) {
                const diffMs = parsedDate - Date.now();
                if (diffMs > 0) {
                  delayMs = diffMs;
                }
              }
            }
          }

          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // Handle 5xx Server Errors (retryable with exponential backoff)
        if (res.status >= 500) {
          attempt++;
          if (attempt > this.maxRetries) {
            throw new TicketmasterNetworkError(
              `Ticketmaster API server error (HTTP ${res.status}) at ${sanitizedUrl}. Max retries reached.`,
              { statusCode: res.status, sanitizedUrl },
            );
          }

          const delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 250;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // Client errors (400, 401, 403, 404, etc.) - non-retryable, fail immediately!
        const errBody = await res.text().catch(() => '');
        const sanitizedBody = redactSensitiveString(errBody, this.apiKey);
        if (res.status === 401 || res.status === 403) {
          throw new TicketmasterAuthError(
            `Ticketmaster API request failed with HTTP ${res.status} at ${sanitizedUrl}: ${sanitizedBody}`,
            { statusCode: res.status, sanitizedUrl },
          );
        }
        throw new NonRetryableError(
          `Ticketmaster API request failed with HTTP ${res.status} at ${sanitizedUrl}: ${sanitizedBody}`,
          { statusCode: res.status, sanitizedUrl },
        );
      } catch (err) {
        if (err instanceof NonRetryableError) {
          // Non-retryable error: fail immediately without executing retry loop
          err.message = redactSensitiveString(err.message, this.apiKey);
          throw err;
        }

        if (attempt >= this.maxRetries) {
          if (err instanceof TicketmasterError) {
            err.message = redactSensitiveString(err.message, this.apiKey);
            throw err;
          }
          const rawMessage = err instanceof Error ? err.message : String(err);
          throw new TicketmasterNetworkError(
            redactSensitiveString(rawMessage, this.apiKey),
            { sanitizedUrl, cause: err },
          );
        }

        // Network / Abort timeout error: retry with backoff
        attempt++;
        const delayMs = 1000 * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new TicketmasterNetworkError(
      `Failed to fetch from Ticketmaster API after ${this.maxRetries} attempts at ${sanitizedUrl}`,
      { sanitizedUrl },
    );
  }
}
