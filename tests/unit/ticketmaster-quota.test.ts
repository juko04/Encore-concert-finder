import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  TicketmasterQuotaGuard,
  TICKETMASTER_DAILY_LIMIT,
  TICKETMASTER_WARNING_THRESHOLD,
  TICKETMASTER_CIRCUIT_BREAKER_THRESHOLD,
  resetGlobalTicketmasterQuotaGuard,
} from '@/lib/sources/ticketmaster/quota-guard';
import {
  TicketmasterApiClient,
  TicketmasterQuotaExceededError,
} from '@/lib/sources/ticketmaster';

describe('Ticketmaster Quota Guard & Budget Enforcement', () => {
  beforeEach(() => {
    resetGlobalTicketmasterQuotaGuard();
  });

  describe('Daily Quota Budget Tracker', () => {
    it('initializes with default 5,000 limit, 4,000 warning, 4,750 circuit breaker thresholds', () => {
      const guard = new TicketmasterQuotaGuard();
      const status = guard.getStatus();

      expect(status.dailyLimit).toBe(TICKETMASTER_DAILY_LIMIT); // 5000
      expect(status.warningThreshold).toBe(TICKETMASTER_WARNING_THRESHOLD); // 4000
      expect(status.circuitBreakerThreshold).toBe(
        TICKETMASTER_CIRCUIT_BREAKER_THRESHOLD,
      ); // 4750
      expect(status.count).toBe(0);
      expect(status.remaining).toBe(5000);
      expect(status.isWarning).toBe(false);
      expect(status.isCircuitBroken).toBe(false);
    });

    it('increments request count and decrements remaining budget accurately', () => {
      const guard = new TicketmasterQuotaGuard();

      guard.recordRequest();
      guard.recordRequest();
      guard.recordRequest();

      const status = guard.getStatus();
      expect(status.count).toBe(3);
      expect(status.remaining).toBe(4997);
    });
  });

  describe('Warning Threshold (4,000 requests)', () => {
    it('triggers warning callback and marks isWarning = true at 4,000 requests without blocking', () => {
      const onWarning = vi.fn();
      const guard = new TicketmasterQuotaGuard({
        initialCount: 3999,
        onWarning,
      });

      expect(guard.getStatus().isWarning).toBe(false);
      expect(onWarning).not.toHaveBeenCalled();

      // 4000th request
      guard.recordRequest();

      const status = guard.getStatus();
      expect(status.count).toBe(4000);
      expect(status.isWarning).toBe(true);
      expect(status.isCircuitBroken).toBe(false);
      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          count: 4000,
          isWarning: true,
        }),
      );

      // Subsequent requests continue to be allowed and callback is not redundantly re-fired
      guard.recordRequest();
      expect(guard.getStatus().count).toBe(4001);
      expect(onWarning).toHaveBeenCalledTimes(1);
    });
  });

  describe('Circuit Breaker (4,750 requests)', () => {
    it('trips circuit breaker at 4,750 requests and refuses non-essential sync requests', () => {
      const onCircuitBreaker = vi.fn();
      const guard = new TicketmasterQuotaGuard({
        initialCount: 4749,
        onCircuitBreaker,
      });

      // 4,750th request trips the breaker
      guard.recordRequest();
      expect(guard.getStatus().count).toBe(4750);
      expect(guard.getStatus().isCircuitBroken).toBe(true);
      expect(onCircuitBreaker).toHaveBeenCalledTimes(1);

      // Next non-essential request must be refused
      expect(() => {
        guard.recordRequest({ isEssential: false });
      }).toThrow(TicketmasterQuotaExceededError);

      try {
        guard.recordRequest({ isEssential: false });
      } catch (err) {
        expect(err).toBeInstanceOf(TicketmasterQuotaExceededError);
        const quotaErr = err as TicketmasterQuotaExceededError;
        expect(quotaErr.isCircuitBreaker).toBe(true);
        expect(quotaErr.statusCode).toBe(429);
        expect(quotaErr.message).toContain('circuit breaker tripped');
      }
    });

    it('allows essential requests through the circuit breaker between 4,750 and 5,000', () => {
      const guard = new TicketmasterQuotaGuard({
        initialCount: 4750,
      });

      expect(guard.getStatus().isCircuitBroken).toBe(true);

      // Essential request succeeds
      const status = guard.recordRequest({ isEssential: true });
      expect(status.count).toBe(4751);

      // Non-essential request is still refused
      expect(() => guard.recordRequest({ isEssential: false })).toThrow(
        TicketmasterQuotaExceededError,
      );
    });

    it('refuses even essential requests when daily budget limit of 5,000 is exhausted', () => {
      const guard = new TicketmasterQuotaGuard({
        initialCount: 5000,
      });

      expect(() => guard.recordRequest({ isEssential: true })).toThrow(
        TicketmasterQuotaExceededError,
      );

      try {
        guard.recordRequest({ isEssential: true });
      } catch (err) {
        expect(err).toBeInstanceOf(TicketmasterQuotaExceededError);
        const quotaErr = err as TicketmasterQuotaExceededError;
        expect(quotaErr.isCircuitBreaker).toBe(false);
        expect(quotaErr.message).toContain('daily quota budget exhausted');
      }
    });

    it('canExecute returns accurate permission and refusal reasons', () => {
      const guard = new TicketmasterQuotaGuard({ initialCount: 4750 });

      expect(guard.canExecute({ isEssential: false })).toEqual({
        allowed: false,
        reason: expect.stringContaining('circuit breaker tripped'),
      });
      expect(guard.canExecute({ isEssential: true })).toEqual({
        allowed: true,
      });

      guard.setCount(5000);
      expect(guard.canExecute({ isEssential: true })).toEqual({
        allowed: false,
        reason: expect.stringContaining('daily quota limit'),
      });
    });
  });

  describe('Automatic UTC Midnight Reset', () => {
    it('automatically resets request counter and flags when passing UTC midnight', () => {
      let simulatedTime = new Date('2026-11-20T23:59:50Z');
      const getCurrentDate = () => simulatedTime;

      const guard = new TicketmasterQuotaGuard({
        initialCount: 4800,
        getCurrentDate,
      });

      const beforeMidnight = guard.getStatus();
      expect(beforeMidnight.count).toBe(4800);
      expect(beforeMidnight.isCircuitBroken).toBe(true);
      expect(beforeMidnight.dateKey).toBe('2026-11-20');
      expect(beforeMidnight.resetAtUtc).toBe('2026-11-21T00:00:00.000Z');

      // Cross UTC midnight to 00:00:05 UTC next day
      simulatedTime = new Date('2026-11-21T00:00:05Z');

      const afterMidnight = guard.getStatus();
      expect(afterMidnight.count).toBe(0);
      expect(afterMidnight.remaining).toBe(5000);
      expect(afterMidnight.isWarning).toBe(false);
      expect(afterMidnight.isCircuitBroken).toBe(false);
      expect(afterMidnight.dateKey).toBe('2026-11-21');
      expect(afterMidnight.resetAtUtc).toBe('2026-11-22T00:00:00.000Z');

      // Subsequent requests on the new UTC day increment from 0
      guard.recordRequest();
      expect(guard.getStatus().count).toBe(1);
    });

    it('reset method explicitly clears counter and flags', () => {
      const guard = new TicketmasterQuotaGuard({ initialCount: 4200 });
      expect(guard.getStatus().isWarning).toBe(true);

      guard.reset();
      expect(guard.getStatus().count).toBe(0);
      expect(guard.getStatus().isWarning).toBe(false);
    });
  });

  describe('Integration with TicketmasterApiClient.request() & fetchEvents()', () => {
    it('records quota request when client.fetchEvents() is called', async () => {
      const guard = new TicketmasterQuotaGuard();
      const client = new TicketmasterApiClient({
        apiKey: 'test-api-key',
        quotaGuard: guard,
        requestsPerSecond: 100,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            _embedded: { events: [] },
            page: { size: 20, totalElements: 0, totalPages: 0, number: 0 },
          }),
      });

      expect(guard.getCount()).toBe(0);
      await client.fetchEvents();
      expect(guard.getCount()).toBe(1);
      await client.fetchEvents();
      expect(guard.getCount()).toBe(2);
    });

    it('blocks non-essential client requests when circuit breaker is tripped without calling fetch', async () => {
      const guard = new TicketmasterQuotaGuard({ initialCount: 4750 });
      const client = new TicketmasterApiClient({
        apiKey: 'test-api-key',
        quotaGuard: guard,
        requestsPerSecond: 100,
      });

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      await expect(
        client.fetchEvents({}, { isEssential: false }),
      ).rejects.toThrow(TicketmasterQuotaExceededError);

      // Verify network fetch was NEVER called
      expect(fetchMock).not.toHaveBeenCalled();
      // Quota count remains at 4750
      expect(guard.getCount()).toBe(4750);
    });

    it('allows essential requests when circuit breaker is tripped via client.request() and client.fetchEvents()', async () => {
      const guard = new TicketmasterQuotaGuard({ initialCount: 4750 });
      const client = new TicketmasterApiClient({
        apiKey: 'test-api-key',
        quotaGuard: guard,
        requestsPerSecond: 100,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            _embedded: { events: [] },
            page: { size: 20, totalElements: 0, totalPages: 0, number: 0 },
          }),
      });

      const res = await client.request({}, { isEssential: true });
      expect(res.response._embedded?.events).toBeDefined();
      expect(guard.getCount()).toBe(4751);
    });

    it('supports client.request(url, init) and enforces quota', async () => {
      const guard = new TicketmasterQuotaGuard();
      const client = new TicketmasterApiClient({
        apiKey: 'test-api-key',
        quotaGuard: guard,
        requestsPerSecond: 100,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '{"status":"ok"}',
      });

      const res = await client.request('https://app.ticketmaster.com/status');
      expect(res.status).toBe(200);
      expect(guard.getCount()).toBe(1);
    });
  });
});
