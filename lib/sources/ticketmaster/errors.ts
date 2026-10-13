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
 * Recursively sanitizes any detail object or Error instance to ensure:
 * 1. It is safe to serialize with JSON.stringify() (no circular references, non-enumerable Error fields converted).
 * 2. Sensitive credentials (API keys, tokens, passwords, secrets) are redacted across strings, URLs, and object properties.
 */
export function sanitizeErrorDetails(
  details: unknown,
  secretToRedact?: string,
  seen = new WeakSet<object>(),
): unknown {
  if (details === null || details === undefined) {
    return undefined;
  }

  if (typeof details === 'string') {
    return redactSensitiveString(details, secretToRedact);
  }

  if (typeof details === 'number' || typeof details === 'boolean') {
    return details;
  }

  if (typeof details === 'bigint') {
    return details.toString();
  }

  if (typeof details === 'symbol' || typeof details === 'function') {
    return undefined;
  }

  if (typeof details === 'object') {
    if (seen.has(details)) {
      return '[Circular Reference]';
    }
    seen.add(details);

    if (details instanceof Error) {
      const errObj: Record<string, unknown> = {
        name: details.name,
        message: redactSensitiveString(details.message, secretToRedact),
      };
      if (
        'code' in details &&
        (details as { code?: unknown }).code !== undefined
      ) {
        errObj.code = (details as { code?: unknown }).code;
      }
      if (
        'statusCode' in details &&
        (details as { statusCode?: unknown }).statusCode !== undefined
      ) {
        errObj.statusCode = (details as { statusCode?: unknown }).statusCode;
      }
      if (details.cause !== undefined) {
        errObj.cause = sanitizeErrorDetails(
          details.cause,
          secretToRedact,
          seen,
        );
      }
      return errObj;
    }

    if (Array.isArray(details)) {
      return details.map((item) =>
        sanitizeErrorDetails(item, secretToRedact, seen),
      );
    }

    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
      if (/key|token|secret|password|auth|cookie|credential/i.test(key)) {
        sanitizedObj[key] = '[REDACTED]';
      } else {
        sanitizedObj[key] = sanitizeErrorDetails(value, secretToRedact, seen);
      }
    }
    return sanitizedObj;
  }

  return redactSensitiveString(String(details), secretToRedact);
}

/**
 * Classifies an unknown ingestion failure into a structured report with credentials redacted.
 */
export function classifyIngestionError(
  err: unknown,
  apiKeyToRedact?: string,
): IngestionErrorReport {
  if (err instanceof TicketmasterError) {
    const details = err.cause
      ? sanitizeErrorDetails(err.cause, apiKeyToRedact)
      : undefined;
    return {
      category: err.category,
      message: redactSensitiveString(err.message, apiKeyToRedact),
      statusCode: err.statusCode,
      sanitizedUrl: err.sanitizedUrl
        ? redactSensitiveString(err.sanitizedUrl, apiKeyToRedact)
        : undefined,
      ...(details !== undefined ? { details } : {}),
    };
  }

  if (err instanceof PipelineDatabaseError) {
    const details = sanitizeErrorDetails(err.originalError, apiKeyToRedact);
    return {
      category: 'database_error',
      message: redactSensitiveString(err.message, apiKeyToRedact),
      ...(details !== undefined ? { details } : {}),
    };
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  const msg = redactSensitiveString(rawMsg, apiKeyToRedact);
  const details =
    err instanceof Error && err.cause
      ? sanitizeErrorDetails(err.cause, apiKeyToRedact)
      : undefined;

  if (
    /HTTP\s*(?:401|403)|unauthorized|forbidden|api key.*(?:invalid|required|missing)/i.test(
      msg,
    )
  ) {
    return {
      category: 'auth_failure',
      message: msg,
      statusCode: /403/.test(msg) ? 403 : 401,
      ...(details !== undefined ? { details } : {}),
    };
  }

  if (/HTTP\s*429|rate limit|too many requests/i.test(msg)) {
    return {
      category: 'rate_limit_exceeded',
      message: msg,
      statusCode: 429,
      ...(details !== undefined ? { details } : {}),
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
      ...(details !== undefined ? { details } : {}),
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
      ...(details !== undefined ? { details } : {}),
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
      ...(details !== undefined ? { details } : {}),
    };
  }

  return {
    category: 'network_error',
    message: msg,
    ...(details !== undefined ? { details } : {}),
  };
}
