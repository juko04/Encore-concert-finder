import { describe, expect, it } from 'vitest';
import {
  RunRequestBudget,
  TicketmasterRunBudgetExceededError,
  TicketmasterApiClient,
  TicketmasterPartitionCoordinator,
} from '@/lib/sources/ticketmaster';

describe('Ticketmaster Per-Run Request Budget Enforcement (Finding 2)', () => {
  it('rejects invalid maxRequests values during budget construction', () => {
    expect(() => new RunRequestBudget(0)).toThrow(/positive integer/i);
    expect(() => new RunRequestBudget(-5)).toThrow(/positive integer/i);
    expect(() => new RunRequestBudget(1.5)).toThrow(/positive integer/i);
    expect(() => new RunRequestBudget(NaN)).toThrow(/positive integer/i);
  });

  it('tracks consumed requests and throws TicketmasterRunBudgetExceededError upon exhaustion', () => {
    const budget = new RunRequestBudget(3);
    expect(budget.getMaxRequests()).toBe(3);
    expect(budget.getConsumed()).toBe(0);
    expect(budget.getRemaining()).toBe(3);
    expect(budget.isExhausted()).toBe(false);

    budget.reserveRequest();
    expect(budget.getConsumed()).toBe(1);
    expect(budget.getRemaining()).toBe(2);

    budget.reserveRequest();
    expect(budget.getConsumed()).toBe(2);
    expect(budget.getRemaining()).toBe(1);

    budget.reserveRequest();
    expect(budget.getConsumed()).toBe(3);
    expect(budget.getRemaining()).toBe(0);
    expect(budget.isExhausted()).toBe(true);

    // 4th request must throw typed TicketmasterRunBudgetExceededError
    expect(() => budget.reserveRequest()).toThrow(
      TicketmasterRunBudgetExceededError,
    );
  });

  it('proves client fetchEvents strictly respects RunRequestBudget and never exceeds it', async () => {
    const runBudget = new RunRequestBudget(2);
    let fetchCount = 0;

    const mockFetch = async () => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          _embedded: {
            events: [
              {
                id: `ev-${fetchCount}`,
                name: `Concert ${fetchCount}`,
                dates: { start: { localDate: '2026-12-01' } },
                _embedded: {
                  venues: [
                    {
                      id: 'ven-1',
                      name: 'Test Venue',
                      city: { name: 'Denver' },
                      state: { stateCode: 'CO' },
                    },
                  ],
                },
              },
            ],
          },
          page: {
            size: 1,
            totalElements: 10,
            totalPages: 10,
            number: fetchCount - 1,
          },
        }),
        {
          headers: {
            'content-type': 'application/json',
            'rate-limit': '5000',
            'rate-limit-available': '4990',
          },
        },
      );
    };

    // Override global fetch
    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const client = new TicketmasterApiClient({
        apiKey: 'test-api-key',
        requestsPerSecond: 100, // fast for testing
        runBudget,
      });

      // Request 1: succeeds
      const res1 = await client.fetchEvents({ size: 1, page: 0 });
      expect(res1.response.page.number).toBe(0);
      expect(runBudget.getConsumed()).toBe(1);

      // Request 2: succeeds
      const res2 = await client.fetchEvents({ size: 1, page: 1 });
      expect(res2.response.page.number).toBe(1);
      expect(runBudget.getConsumed()).toBe(2);
      expect(runBudget.isExhausted()).toBe(true);

      // Request 3: must throw TicketmasterRunBudgetExceededError BEFORE dispatching HTTP fetch!
      await expect(client.fetchEvents({ size: 1, page: 2 })).rejects.toThrow(
        TicketmasterRunBudgetExceededError,
      );

      // Verify that fetch was called exactly 2 times and never a 3rd time
      expect(fetchCount).toBe(2);
      expect(runBudget.getConsumed()).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('proves partition coordinator catches budget exhaustion gracefully, marks hasIncompleteCoverage, and returns partial events', async () => {
    const runBudget = new RunRequestBudget(2); // Only allow 2 requests total
    let requestIndex = 0;

    const customFetchFn = async () => {
      runBudget.reserveRequest(); // Enforce budget atomically
      requestIndex++;
      return {
        response: {
          _embedded: {
            events: [
              {
                id: `ev-partition-${requestIndex}`,
                name: `Partition Event ${requestIndex}`,
                url: `https://ticketmaster.com/events/${requestIndex}`,
                dates: { start: { localDate: '2026-12-05' } },
                _embedded: {
                  venues: [
                    {
                      id: 'ven-p',
                      name: 'Boulder Theater',
                      city: { name: 'Boulder' },
                      state: { stateCode: 'CO' },
                    },
                  ],
                },
              },
            ],
          },
          // Claim there are 5 pages (would normally require 5 requests)
          page: {
            size: 1,
            totalElements: 5,
            totalPages: 5,
            number: requestIndex - 1,
          },
        } as any,
        rawJson: JSON.stringify({ ok: true }),
        url: `https://app.ticketmaster.com/discovery/v2/events.json?page=${requestIndex - 1}`,
      };
    };

    const coordinator = new TicketmasterPartitionCoordinator({
      fetchFn: customFetchFn,
      pageSize: 1,
    });

    const result = await coordinator.fetchEvents({
      startDateTime: '2026-12-01T00:00:00Z',
      endDateTime: '2026-12-10T00:00:00Z',
    });

    // Exactly 2 requests made before hitting budget ceiling
    expect(result.totalRequestsMade).toBe(2);
    expect(runBudget.getConsumed()).toBe(2);
    expect(runBudget.isExhausted()).toBe(true);

    // Partial coverage must be flagged
    expect(result.hasIncompleteCoverage).toBe(true);

    // The events fetched within budget must be preserved
    expect(result.events.length).toBe(2);
    expect(result.events[0].id).toBe('ev-partition-1');
    expect(result.events[1].id).toBe('ev-partition-2');
  });
});
