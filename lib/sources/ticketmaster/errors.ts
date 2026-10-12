import { redactSensitiveString } from './types';

export type IngestionErrorCategory =
  | 'auth_failure'
  | 'rate_limit_exceeded'
  | 'network_error'
  | 'validation_error'
  | 'database_error';

export interface IngestionErrorReport {
  category: IngestionErrorCategory;
  message: string;
  statusCode?: number;
  sanitizedUrl?: string;
  details?: unknown;
}

/**
 * Base class for all Ticketmaster ingestion errors.
 */
export class TicketmasterError extends Error {
  readonly category: IngestionErrorCategory;
  readonly statusCode?: number;
  readonly sanitizedUrl?: string;

  constructor(
    message: string,
    options: {
      category: IngestionErrorCategory;
      statusCode?: number;
      sanitizedUrl?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'TicketmasterError';
    this.category = options.category;
    this.statusCode = options.statusCode;
    this.sanitizedUrl = options.sanitizedUrl;
  }
}

/**
 * Non-retryable error during Ticketmaster API processing (e.g., auth failure, schema validation).
 * Fail immediately without executing exponential backoff retries.
 */
export class NonRetryableError extends TicketmasterError {
  constructor(
    message: string,
    options: {
      category?: IngestionErrorCategory;
      statusCode?: number;
      sanitizedUrl?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, {
      category: options.category ?? 'validation_error',
      statusCode: options.statusCode,
      sanitizedUrl: options.sanitizedUrl,
      cause: options.cause,
    });
    this.name = 'NonRetryableError';
  }
}

/**
 * Authentication or authorization failure (HTTP 401, 403, or missing API key).
 */
export class TicketmasterAuthError extends NonRetryableError {
  constructor(
    message: string,
    options: {
      statusCode?: number;
      sanitizedUrl?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, {
      category: 'auth_failure',
      statusCode: options.statusCode ?? 401,
      sanitizedUrl: options.sanitizedUrl,
      cause: options.cause,
    });
    this.name = 'TicketmasterAuthError';
  }
}

/**
 * Rate limit exhausted (HTTP 429 when retry quota or max backoff attempts are exceeded).
 */
export class TicketmasterRateLimitError extends TicketmasterError {
  constructor(
    message: string,
    options: {
      statusCode?: number;
      sanitizedUrl?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, {
      category: 'rate_limit_exceeded',
      statusCode: options.statusCode ?? 429,
      sanitizedUrl: options.sanitizedUrl,
      cause: options.cause,
    });
    this.name = 'TicketmasterRateLimitError';
  }
}

/**
 * Network failure, connection abort, or timeout when retries are exhausted.
 */
export class TicketmasterNetworkError extends TicketmasterError {
  constructor(
    message: string,
    options: {
      statusCode?: number;
      sanitizedUrl?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, {
      category: 'network_error',
      statusCode: options.statusCode,
      sanitizedUrl: options.sanitizedUrl,
      cause: options.cause,
    });
    this.name = 'TicketmasterNetworkError';
  }
}

/**
 * Payload validation error (Zod schema mismatch, malformed JSON, or invalid parameters).
 */
export class TicketmasterValidationError extends NonRetryableError {
  constructor(
    message: string,
    options: {
      statusCode?: number;
      sanitizedUrl?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, {
      category: 'validation_error',
      statusCode: options.statusCode ?? 422,
      sanitizedUrl: options.sanitizedUrl,
      cause: options.cause,
    });
    this.name = 'TicketmasterValidationError';
  }
}

/**
 * Database error occurring during persistence or canonicalization.
 */
export class PipelineDatabaseError extends Error {
  readonly category: IngestionErrorCategory = 'database_error';
  readonly originalError?: unknown;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'PipelineDatabaseError';
    this.originalError = originalError;
  }
}

/**
 * Classifies an unknown ingestion failure into a structured report with credentials redacted.
 */
export function classifyIngestionError(
  err: unknown,
  apiKeyToRedact?: string,
): IngestionErrorReport {
  if (err instanceof TicketmasterError) {
    return {
      category: err.category,
      message: redactSensitiveString(err.message, apiKeyToRedact),
      statusCode: err.statusCode,
      sanitizedUrl: err.sanitizedUrl,
    };
  }

  if (err instanceof PipelineDatabaseError) {
    return {
      category: 'database_error',
      message: redactSensitiveString(err.message, apiKeyToRedact),
      details: err.originalError,
    };
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = redactSensitiveString(rawMsg, apiKeyToRedact);

  if (
    /HTTP\s*(?:401|403)|unauthorized|forbidden|api key.*(?:invalid|required|missing)/i.test(
      msg,
    )
  ) {
    return {
      category: 'auth_failure',
      message: msg,
      statusCode: /403/.test(msg) ? 403 : 401,
    };
  }

  if (/HTTP\s*429|rate limit|too many requests/i.test(msg)) {
    return {
      category: 'rate_limit_exceeded',
      message: msg,
      statusCode: 429,
    };
  }

  if (
    /schema validation failed|malformed json|invalid page parameter|invalid size parameter|deep pagination/i.test(
      msg,
    )
  ) {
    return {
      category: 'validation_error',
      message: msg,
    };
  }

  if (
    /network|fetch failed|timeout|econnreset|econnrefused|aborted|socket/i.test(
      msg,
    )
  ) {
    return {
      category: 'network_error',
      message: msg,
    };
  }

  if (
    /database|postgres|supabase|relation|constraint|foreign key|unique constraint|rollback/i.test(
      msg,
    )
  ) {
    return {
      category: 'database_error',
      message: msg,
    };
  }

  return {
    category: 'network_error',
    message: msg,
  };
}
