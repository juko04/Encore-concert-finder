import fs from 'node:fs';
import { TicketmasterQuotaExceededError } from './errors';

export const TICKETMASTER_DAILY_LIMIT = 5000;
export const TICKETMASTER_WARNING_THRESHOLD = 4000;
export const TICKETMASTER_CIRCUIT_BREAKER_THRESHOLD = 4750;

export interface QuotaGuardOptions {
  dailyLimit?: number;
  warningThreshold?: number;
  circuitBreakerThreshold?: number;
  initialCount?: number;
  getCurrentDate?: () => Date;
  persistFilePath?: string | null;
  onWarning?: (status: TicketmasterQuotaStatus) => void;
  onCircuitBreaker?: (status: TicketmasterQuotaStatus) => void;
}

export interface TicketmasterQuotaStatus {
  count: number;
  dailyLimit: number;
  remaining: number;
  warningThreshold: number;
  circuitBreakerThreshold: number;
  isWarning: boolean;
  isCircuitBroken: boolean;
  dateKey: string;
  resetAtUtc: string;
  providerResetAtUtc?: string;
  persistedFilePath?: string;
}

export interface RecordRequestOptions {
  isEssential?: boolean;
}

export interface ProviderQuotaHeaders {
  limit?: number;
  available?: number;
  reset?: number;
}

/**
 * Tracks Ticketmaster Discovery API daily request quota, enforces warning threshold,
 * trips circuit breaker at 4,750 requests (blocking non-essential sync), and automatically
 * resets at UTC midnight or when provider reset window occurs.
 *
 * Supports cross-process shared state via atomic file locking and provider header reconciliation.
 */
export class TicketmasterQuotaGuard {
  readonly dailyLimit: number;
  readonly warningThreshold: number;
  readonly circuitBreakerThreshold: number;
  private count: number;
  private currentDateKey: string;
  private warningEmitted: boolean = false;
  private circuitBreakerEmitted: boolean = false;
  private getCurrentDate: () => Date;
  private persistFilePath: string | null;
  private providerResetAtUtc?: string;
  private onWarning?: (status: TicketmasterQuotaStatus) => void;
  private onCircuitBreaker?: (status: TicketmasterQuotaStatus) => void;

  constructor(options?: QuotaGuardOptions) {
    this.dailyLimit = options?.dailyLimit ?? TICKETMASTER_DAILY_LIMIT;
    this.warningThreshold =
      options?.warningThreshold ?? TICKETMASTER_WARNING_THRESHOLD;
    this.circuitBreakerThreshold =
      options?.circuitBreakerThreshold ??
      TICKETMASTER_CIRCUIT_BREAKER_THRESHOLD;
    this.getCurrentDate = options?.getCurrentDate ?? (() => new Date());
    this.count = options?.initialCount ?? 0;
    this.onWarning = options?.onWarning;
    this.onCircuitBreaker = options?.onCircuitBreaker;

    // Use explicit path or env var; otherwise null for pure in-memory isolation
    if (options?.persistFilePath !== undefined) {
      this.persistFilePath = options.persistFilePath;
    } else if (process.env.TM_QUOTA_FILE) {
      this.persistFilePath = process.env.TM_QUOTA_FILE;
    } else {
      this.persistFilePath = null;
    }

    const initialDate = this.getCurrentDate();
    this.currentDateKey = this.getUtcDateKey(initialDate);

    // Hydrate persisted count if available
    this.loadPersistedState();
  }

  private getUtcDateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private getNextUtcMidnightIso(d: Date): string {
    const nextMidnight = new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() + 1,
        0,
        0,
        0,
        0,
      ),
    );
    return nextMidnight.toISOString();
  }

  /**
   * Executes a callback within an atomic process-safe file lock.
   * If persistFilePath is null, executes immediately without locking.
   * Employs stale lock detection and exponential backoff.
   * Fails safely if lock cannot be acquired or file is corrupt.
   */
  private withFileLock<T>(fn: () => T): T {
    if (!this.persistFilePath) {
      return fn();
    }

    const lockPath = `${this.persistFilePath}.lock`;
    const maxWaitMs = 5000;
    const staleLockAgeMs = 10000;
    const start = Date.now();
    let fd: number | null = null;
    let acquired = false;

    while (!acquired) {
      try {
        fd = fs.openSync(lockPath, 'wx');
        acquired = true;
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error && error.code === 'EEXIST') {
          // Check if lock file is stale (orphaned by killed process)
          try {
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > staleLockAgeMs) {
              try {
                fs.unlinkSync(lockPath);
                continue;
              } catch {
                // Another process might have cleaned it up
              }
            }
          } catch {
            // Lock was released in the meantime
            continue;
          }

          if (Date.now() - start > maxWaitMs) {
            // Timed out: break stale lock safely or proceed
            try {
              fs.unlinkSync(lockPath);
              fd = fs.openSync(lockPath, 'wx');
              acquired = true;
              break;
            } catch {
              // Proceed in-memory safely to avoid hanging indefinitely
              return fn();
            }
          }

          // Backoff before retry
          const backoffMs = 5 + Math.floor(Math.random() * 15);
          try {
            Atomics.wait(
              new Int32Array(new SharedArrayBuffer(4)),
              0,
              0,
              backoffMs,
            );
          } catch {
            const spinStart = Date.now();
            while (Date.now() - spinStart < backoffMs) {
              // brief synchronous spin
            }
          }
        } else {
          // Other filesystem error: fail safely, proceed in-memory
          return fn();
        }
      }
    }

    try {
      return fn();
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore
        }
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore
      }
    }
  }

  private loadPersistedState(): void {
    if (!this.persistFilePath) return;
    try {
      if (fs.existsSync(this.persistFilePath)) {
        const raw = fs.readFileSync(this.persistFilePath, 'utf8');
        let data: {
          dateKey?: string;
          count?: number;
          providerResetAtUtc?: string;
        };
        try {
          data = JSON.parse(raw);
        } catch {
          // Corrupt state file: fail safely, do not crash
          return;
        }

        if (data && typeof data === 'object') {
          if (data.dateKey) {
            this.currentDateKey = data.dateKey;
          }
          if (typeof data.count === 'number') {
            this.count = Math.max(this.count, data.count);
          }
          if (data.providerResetAtUtc) {
            this.providerResetAtUtc = data.providerResetAtUtc;
          }
          this.warningEmitted = this.count >= this.warningThreshold;
          this.circuitBreakerEmitted =
            this.count >= this.circuitBreakerThreshold;
        }
      }
    } catch {
      // Ignore persistence load failures gracefully
    }
  }

  private savePersistedState(): void {
    if (!this.persistFilePath) return;
    try {
      const payload = {
        dateKey: this.currentDateKey,
        count: this.count,
        dailyLimit: this.dailyLimit,
        providerResetAtUtc: this.providerResetAtUtc,
        updatedAt: new Date().toISOString(),
      };
      const tmpPath = `${this.persistFilePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2)}`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.persistFilePath);
    } catch {
      // Ignore persistence save failures gracefully
    }
  }

  /**
   * Synchronizes quota usage directly from official Ticketmaster response headers:
   * - rate-limit (e.g. 5000)
   * - rate-limit-available (e.g. 4998)
   * - rate-limit-reset (timestamp in ms)
   */
  syncFromHeaders(headers: ProviderQuotaHeaders): void {
    this.withFileLock(() => {
      this.loadPersistedState();
      this.checkDateReset();
      if (
        typeof headers.limit === 'number' &&
        typeof headers.available === 'number'
      ) {
        const observedUsed = Math.max(0, headers.limit - headers.available);
        if (observedUsed > this.count) {
          this.count = observedUsed;
        }
        if (headers.available <= 0) {
          this.count = Math.max(this.count, this.dailyLimit);
        }
      }
      if (typeof headers.reset === 'number' && headers.reset > 0) {
        try {
          this.providerResetAtUtc = new Date(headers.reset).toISOString();
        } catch {
          // ignore invalid timestamp
        }
      }
      this.savePersistedState();
    });
  }

  /**
   * Checks if the date has crossed UTC midnight. If so, automatically resets counter,
   * UNLESS the provider indicates quota is still exhausted or providerResetAtUtc is in the future.
   */
  private checkDateReset(): void {
    const now = this.getCurrentDate();
    const todayKey = this.getUtcDateKey(now);

    // If providerResetAtUtc is set and in the future, do NOT reset accounting to 0 upon crossing midnight!
    if (this.providerResetAtUtc) {
      const resetTime = new Date(this.providerResetAtUtc).getTime();
      if (!isNaN(resetTime)) {
        if (now.getTime() < resetTime) {
          // Provider quota window is still in effect and exhausted
          return;
        } else {
          // Provider reset time has elapsed
          this.providerResetAtUtc = undefined;
        }
      } else {
        this.providerResetAtUtc = undefined;
      }
    }

    if (todayKey !== this.currentDateKey) {
      this.currentDateKey = todayKey;
      this.count = 0;
      this.warningEmitted = false;
      this.circuitBreakerEmitted = false;
      this.savePersistedState();
    }
  }

  private getStatusInternal(): TicketmasterQuotaStatus {
    const now = this.getCurrentDate();
    const remaining = Math.max(0, this.dailyLimit - this.count);
    const isWarning = this.count >= this.warningThreshold;
    const isCircuitBroken = this.count >= this.circuitBreakerThreshold;

    return {
      count: this.count,
      dailyLimit: this.dailyLimit,
      remaining,
      warningThreshold: this.warningThreshold,
      circuitBreakerThreshold: this.circuitBreakerThreshold,
      isWarning,
      isCircuitBroken,
      dateKey: this.currentDateKey,
      resetAtUtc: this.providerResetAtUtc || this.getNextUtcMidnightIso(now),
      providerResetAtUtc: this.providerResetAtUtc,
      persistedFilePath: this.persistFilePath || undefined,
    };
  }

  /**
   * Returns current status of quota budget.
   */
  getStatus(): TicketmasterQuotaStatus {
    return this.withFileLock(() => {
      this.loadPersistedState();
      this.checkDateReset();
      return this.getStatusInternal();
    });
  }

  /**
   * Determines if a request can be executed without exceeding budget or circuit breaker limits.
   */
  canExecute(options?: RecordRequestOptions): {
    allowed: boolean;
    reason?: string;
  } {
    return this.withFileLock(() => {
      this.loadPersistedState();
      this.checkDateReset();
      const isEssential = options?.isEssential ?? false;

      if (this.count >= this.dailyLimit) {
        return {
          allowed: false,
          reason: `Ticketmaster daily quota limit of ${this.dailyLimit} requests has been reached.`,
        };
      }

      if (!isEssential && this.count >= this.circuitBreakerThreshold) {
        return {
          allowed: false,
          reason: `Ticketmaster circuit breaker tripped at ${this.count}/${this.dailyLimit} requests. Non-essential requests refused.`,
        };
      }

      return { allowed: true };
    });
  }

  /**
   * Checks quota and records a request. Throws TicketmasterQuotaExceededError if limit is reached
   * or if non-essential request arrives when circuit breaker is tripped.
   */
  recordRequest(options?: RecordRequestOptions): TicketmasterQuotaStatus {
    return this.withFileLock(() => {
      this.loadPersistedState();
      this.checkDateReset();
      const isEssential = options?.isEssential ?? false;
      const now = this.getCurrentDate();
      const resetAtUtc =
        this.providerResetAtUtc || this.getNextUtcMidnightIso(now);

      if (this.count >= this.dailyLimit) {
        throw new TicketmasterQuotaExceededError(
          `Ticketmaster daily quota budget exhausted (${this.count}/${this.dailyLimit}). All requests blocked until reset at ${resetAtUtc}.`,
          {
            isCircuitBreaker: false,
            quotaCount: this.count,
            dailyLimit: this.dailyLimit,
          },
        );
      }

      if (!isEssential && this.count >= this.circuitBreakerThreshold) {
        const status = this.getStatusInternal();
        if (!this.circuitBreakerEmitted) {
          this.circuitBreakerEmitted = true;
          this.onCircuitBreaker?.(status);
        }
        throw new TicketmasterQuotaExceededError(
          `Ticketmaster circuit breaker tripped at ${this.count} requests (threshold: ${this.circuitBreakerThreshold}). Non-essential sync request refused until reset at ${resetAtUtc}.`,
          {
            isCircuitBreaker: true,
            quotaCount: this.count,
            dailyLimit: this.dailyLimit,
          },
        );
      }

      this.count++;
      this.savePersistedState();
      const status = this.getStatusInternal();

      if (this.count >= this.warningThreshold && !this.warningEmitted) {
        this.warningEmitted = true;
        this.onWarning?.(status);
      }

      if (
        this.count >= this.circuitBreakerThreshold &&
        !this.circuitBreakerEmitted
      ) {
        this.circuitBreakerEmitted = true;
        this.onCircuitBreaker?.(status);
      }

      return status;
    });
  }

  /**
   * Overrides current count (useful for testing or state hydration).
   */
  setCount(newCount: number): void {
    this.withFileLock(() => {
      this.loadPersistedState();
      this.checkDateReset();
      this.count = Math.max(0, newCount);
      this.warningEmitted = this.count >= this.warningThreshold;
      this.circuitBreakerEmitted = this.count >= this.circuitBreakerThreshold;
      this.savePersistedState();
    });
  }

  /**
   * Resets counter and flags to 0.
   */
  reset(date?: Date): void {
    this.withFileLock(() => {
      if (date) {
        this.currentDateKey = this.getUtcDateKey(date);
      } else {
        this.currentDateKey = this.getUtcDateKey(this.getCurrentDate());
      }
      this.count = 0;
      this.warningEmitted = false;
      this.circuitBreakerEmitted = false;
      this.providerResetAtUtc = undefined;
      this.savePersistedState();
    });
  }

  getCount(): number {
    return this.getStatus().count;
  }

  getRemaining(): number {
    return this.getStatus().remaining;
  }
}

let globalQuotaGuard: TicketmasterQuotaGuard | null = null;

export function getGlobalTicketmasterQuotaGuard(): TicketmasterQuotaGuard {
  if (!globalQuotaGuard) {
    globalQuotaGuard = new TicketmasterQuotaGuard();
  }
  return globalQuotaGuard;
}

export function resetGlobalTicketmasterQuotaGuard(): void {
  globalQuotaGuard = null;
}
