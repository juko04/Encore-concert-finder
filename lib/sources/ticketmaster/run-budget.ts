import { TicketmasterRunBudgetExceededError } from './errors';

export interface RunRequestBudgetStatus {
  maxRequests: number;
  consumed: number;
  remaining: number;
  isExhausted: boolean;
}

/**
 * Manages atomic request reservations for an individual synchronization run.
 * Guarantees that total requests across all queries (regional partitions,
 * bisection sub-intervals, pagination pages, retries, favorite artist tours,
 * and nationwide festival queries) strictly never exceed the allocated run budget.
 */
export class RunRequestBudget {
  private readonly maxRequests: number;
  private consumed = 0;

  constructor(maxRequests: number) {
    if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
      throw new Error(
        `Invalid maxRequests parameter: ${maxRequests}. Must be a positive integer.`,
      );
    }
    this.maxRequests = maxRequests;
  }

  getMaxRequests(): number {
    return this.maxRequests;
  }

  getConsumed(): number {
    return this.consumed;
  }

  getRemaining(): number {
    return Math.max(0, this.maxRequests - this.consumed);
  }

  isExhausted(): boolean {
    return this.consumed >= this.maxRequests;
  }

  /**
   * Atomically reserves a request against the per-run budget.
   * Throws TicketmasterRunBudgetExceededError if the budget is exhausted.
   */
  reserveRequest(): void {
    if (this.consumed >= this.maxRequests) {
      throw new TicketmasterRunBudgetExceededError(
        `Per-run Ticketmaster request budget of ${this.maxRequests} requests has been exhausted (consumed: ${this.consumed}). Halting further requests for this run.`,
        {
          maxRequests: this.maxRequests,
          consumed: this.consumed,
        },
      );
    }
    this.consumed++;
  }

  getStatus(): RunRequestBudgetStatus {
    return {
      maxRequests: this.maxRequests,
      consumed: this.consumed,
      remaining: this.getRemaining(),
      isExhausted: this.isExhausted(),
    };
  }
}
