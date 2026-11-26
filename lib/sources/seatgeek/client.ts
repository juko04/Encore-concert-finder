/**
 * SeatGeek Platform API client (read-only, `/2/events`).
 *
 * - The client id is sent as a query parameter, as SeatGeek documents, and is stripped from
 *   every URL this module returns or throws, so it never reaches raw_ingests, logs or reports.
 * - Polite by default: one request per second and a hard per-run request budget.
 * - 429 and 5xx are retried with backoff. 401/403 stop the run (bad or revoked key, or the
 *   terms changed) instead of retrying.
 */

const DEFAULT_BASE_URL = 'https://api.seatgeek.com/2';

export class SeatGeekAuthError extends Error {
  constructor(public readonly status: number) {
    super(
      `SeatGeek rejected the client id (HTTP ${status}). Check SEATGEEK_CLIENT_ID and the API terms.`,
    );
    this.name = 'SeatGeekAuthError';
  }
}

export class SeatGeekRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = 'SeatGeekRequestError';
  }
}

export class SeatGeekBudgetExceededError extends Error {
  constructor(public readonly budget: number) {
    super(`SeatGeek request budget of ${budget} reached for this run`);
    this.name = 'SeatGeekBudgetExceededError';
  }
}

export interface SeatGeekEventsQuery {
  stateCode: string;
  /** Inclusive UTC date bounds, YYYY-MM-DD. */
  fromDate: string;
  toDate: string;
  page: number;
  perPage?: number;
}

export interface SeatGeekPage {
  /** Request URL with the client id removed (safe to store and log). */
  sourceUrl: string;
  status: number;
  body: string;
}

export interface SeatGeekClientOptions {
  clientId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  maxRequests?: number;
  maxRetries?: number;
}

/** Remove credentials from a SeatGeek URL or message. */
export function redactSeatGeekSecrets(text: string): string {
  return text.replace(
    /([?&](?:client_id|client_secret)=)[^&\s"']*/gi,
    '$1REDACTED',
  );
}

/** Build the `/events` query. Taxonomy filters repeat, which SeatGeek treats as OR. */
export function buildEventsQuery(query: SeatGeekEventsQuery): URLSearchParams {
  if (!/^[A-Z]{2}$/.test(query.stateCode)) {
    throw new Error(`Invalid state code: ${query.stateCode}`);
  }
  const params = new URLSearchParams();
  params.set('venue.state', query.stateCode);
  params.append('taxonomies.name', 'concert');
  params.append('taxonomies.name', 'music_festival');
  params.set('datetime_utc.gte', query.fromDate);
  params.set('datetime_utc.lte', query.toDate);
  params.set('listing_count.gt', '0');
  params.set('sort', 'datetime_utc.asc');
  params.set('per_page', String(query.perPage ?? 100));
  params.set('page', String(query.page));
  return params;
}

export class SeatGeekClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly maxRequests: number;
  private readonly maxRetries: number;
  private requests = 0;
  private lastRequestAt = 0;

  constructor(private readonly options: SeatGeekClientOptions) {
    if (!options.clientId) {
      throw new Error('SeatGeekClient requires a client id');
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.maxRequests = options.maxRequests ?? 60;
    this.maxRetries = options.maxRetries ?? 3;
  }

  get requestCount(): number {
    return this.requests;
  }

  async fetchEventsPage(query: SeatGeekEventsQuery): Promise<SeatGeekPage> {
    const params = buildEventsQuery(query);
    const publicUrl = `${this.baseUrl}/events?${params.toString()}`;
    params.set('client_id', this.options.clientId);
    const requestUrl = `${this.baseUrl}/events?${params.toString()}`;

    for (let attempt = 0; ; attempt += 1) {
      if (this.requests >= this.maxRequests) {
        throw new SeatGeekBudgetExceededError(this.maxRequests);
      }
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (this.lastRequestAt > 0 && wait > 0) await this.sleep(wait);
      this.requests += 1;
      this.lastRequestAt = Date.now();

      let response: Response;
      try {
        response = await this.fetchImpl(requestUrl, {
          headers: { Accept: 'application/json' },
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw new SeatGeekRequestError(
          redactSeatGeekSecrets(
            `SeatGeek request failed: ${(err as Error).message}`,
          ),
          null,
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new SeatGeekAuthError(response.status);
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw new SeatGeekRequestError(
          `SeatGeek returned HTTP ${response.status} after ${attempt + 1} attempts`,
          response.status,
        );
      }
      if (!response.ok) {
        throw new SeatGeekRequestError(
          `SeatGeek returned HTTP ${response.status} for ${publicUrl}`,
          response.status,
        );
      }
      return {
        sourceUrl: publicUrl,
        status: response.status,
        body: await response.text(),
      };
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** attempt);
}
