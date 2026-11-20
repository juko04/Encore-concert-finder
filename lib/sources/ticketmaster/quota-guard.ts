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
}

export interface RecordRequestOptions {
  isEssential?: boolean;
}

/**
 * Tracks Ticketmaster Discovery API daily request quota, enforces warning threshold,
 * trips circuit breaker at 4,750 requests (blocking non-essential sync), and automatically
 * resets at UTC midnight.
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

    const initialDate = this.getCurrentDate();
    this.currentDateKey = this.getUtcDateKey(initialDate);
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
   * Checks if the date has crossed UTC midnight. If so, automatically resets counter.
   */
  private checkDateReset(): void {
    const now = this.getCurrentDate();
    const todayKey = this.getUtcDateKey(now);
    if (todayKey !== this.currentDateKey) {
      this.currentDateKey = todayKey;
      this.count = 0;
      this.warningEmitted = false;
      this.circuitBreakerEmitted = false;
    }
  }

  /**
   * Returns current status of quota budget.
   */
  getStatus(): TicketmasterQuotaStatus {
    this.checkDateReset();
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
      resetAtUtc: this.getNextUtcMidnightIso(now),
    };
  }

  /**
   * Determines if a request can be executed without exceeding budget or circuit breaker limits.
   */
  canExecute(options?: RecordRequestOptions): {
    allowed: boolean;
    reason?: string;
  } {
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
  }

  /**
   * Checks quota and records a request. Throws TicketmasterQuotaExceededError if limit is reached
   * or if non-essential request arrives when circuit breaker is tripped.
   */
  recordRequest(options?: RecordRequestOptions): TicketmasterQuotaStatus {
    this.checkDateReset();
    const isEssential = options?.isEssential ?? false;
    const now = this.getCurrentDate();
    const resetAtUtc = this.getNextUtcMidnightIso(now);

    if (this.count >= this.dailyLimit) {
      throw new TicketmasterQuotaExceededError(
        `Ticketmaster daily quota budget exhausted (${this.count}/${this.dailyLimit}). All requests blocked until UTC midnight reset at ${resetAtUtc}.`,
        {
          isCircuitBreaker: false,
          quotaCount: this.count,
          dailyLimit: this.dailyLimit,
        },
      );
    }

    if (!isEssential && this.count >= this.circuitBreakerThreshold) {
      const status = this.getStatus();
      if (!this.circuitBreakerEmitted) {
        this.circuitBreakerEmitted = true;
        this.onCircuitBreaker?.(status);
      }
      throw new TicketmasterQuotaExceededError(
        `Ticketmaster circuit breaker tripped at ${this.count} requests (threshold: ${this.circuitBreakerThreshold}). Non-essential sync request refused until UTC midnight reset at ${resetAtUtc}.`,
        {
          isCircuitBreaker: true,
          quotaCount: this.count,
          dailyLimit: this.dailyLimit,
        },
      );
    }

    this.count++;
    const status = this.getStatus();

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
  }

  /**
   * Overrides current count (useful for testing or state hydration).
   */
  setCount(newCount: number): void {
    this.checkDateReset();
    this.count = Math.max(0, newCount);
    this.warningEmitted = this.count >= this.warningThreshold;
    this.circuitBreakerEmitted = this.count >= this.circuitBreakerThreshold;
  }

  /**
   * Resets counter and flags to 0.
   */
  reset(date?: Date): void {
    if (date) {
      this.currentDateKey = this.getUtcDateKey(date);
    } else {
      this.currentDateKey = this.getUtcDateKey(this.getCurrentDate());
    }
    this.count = 0;
    this.warningEmitted = false;
    this.circuitBreakerEmitted = false;
  }

  getCount(): number {
    this.checkDateReset();
    return this.count;
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
