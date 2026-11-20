import { describe, expect, it, vi } from 'vitest';
import {
  bisectDateRange,
  planPartitions,
  TicketmasterPartitionCoordinator,
  fetchPartitionedEvents,
} from '@/lib/sources/ticketmaster/partitioner';
import { TicketmasterValidationError } from '@/lib/sources/ticketmaster/errors';
import type {
  TicketmasterEvent,
  TicketmasterEventsResponse,
} from '@/lib/sources/ticketmaster/types';

function createMockEvent(id: string, date: string): TicketmasterEvent {
  return {
    id,
    name: `Concert ${id}`,
    url: `https://www.ticketmaster.com/event/${id}`,
    dates: {
      start: {
        localDate: date,
        localTime: '20:00:00',
        dateTime: `${date}T20:00:00Z`,
        dateTBD: false,
        dateTBA: false,
        timeTBA: false,
        noSpecificTime: false,
      },
      status: { code: 'onsale' },
    },
    priceRanges: [{ min: 30, max: 80, currency: 'USD' }],
  };
}

function createMockResponse(
  events: TicketmasterEvent[],
  totalElements: number,
  pageNumber: number = 0,
  pageSize: number = 200,
): TicketmasterEventsResponse {
  const totalPages = Math.ceil(totalElements / pageSize);
  return {
    _embedded: { events },
    page: {
      number: pageNumber,
      size: pageSize,
      totalElements,
      totalPages,
    },
  };
}

describe('Ticketmaster Dynamic Temporal Partitioning (Date Bisection)', () => {
  describe('bisectDateRange', () => {
    it('accurately splits a 10-day range into two 5-day partitions', () => {
      const start = '2026-10-01T00:00:00Z';
      const end = '2026-10-11T00:00:00Z';
      const result = bisectDateRange(start, end, 1);

      expect(result).not.toBeNull();
      const [left, right] = result!;

      expect(left.startUtc).toBe('2026-10-01T00:00:00Z');
      expect(left.endUtc).toBe('2026-10-06T00:00:00Z');
      expect(left.startDateTime).toBe('2026-10-01T00:00:00Z');
      expect(left.endDateTime).toBe('2026-10-06T00:00:00Z');

      expect(right.startUtc).toBe('2026-10-06T00:00:00Z');
      expect(right.endUtc).toBe('2026-10-11T00:00:00Z');
      expect(right.startDateTime).toBe('2026-10-06T00:00:00Z');
      expect(right.endDateTime).toBe('2026-10-11T00:00:00Z');
    });

    it('accepts Date objects and produces UTC ISO strings without fractional seconds', () => {
      const startDate = new Date('2026-06-01T12:00:00Z');
      const endDate = new Date('2026-06-05T12:00:00Z');
      const result = bisectDateRange(startDate, endDate);

      expect(result).not.toBeNull();
      const [left, right] = result!;

      expect(left.startDateTime).toBe('2026-06-01T12:00:00Z');
      expect(left.endDateTime).toBe('2026-06-03T12:00:00Z');
      expect(right.startDateTime).toBe('2026-06-03T12:00:00Z');
      expect(right.endDateTime).toBe('2026-06-05T12:00:00Z');
    });

    it('returns null when duration is exactly 1 day (minIntervalDays = 1)', () => {
      const start = '2026-10-01T00:00:00Z';
      const end = '2026-10-02T00:00:00Z'; // exactly 24 hours
      const result = bisectDateRange(start, end, 1);

      expect(result).toBeNull();
    });

    it('returns null when duration is less than 1 day (e.g. 12 hours)', () => {
      const start = '2026-10-01T00:00:00Z';
      const end = '2026-10-01T12:00:00Z';
      const result = bisectDateRange(start, end, 1);

      expect(result).toBeNull();
    });

    it('respects custom minIntervalDays threshold (e.g. minIntervalDays = 3)', () => {
      const start = '2026-10-01T00:00:00Z';
      const end = '2026-10-03T00:00:00Z'; // 2 days < 3 days
      const result = bisectDateRange(start, end, 3);

      expect(result).toBeNull();

      const validRange = bisectDateRange(
        '2026-10-01T00:00:00Z',
        '2026-10-05T00:00:00Z',
        3,
      );
      expect(validRange).not.toBeNull();
    });

    it('returns null when start >= end', () => {
      expect(
        bisectDateRange('2026-10-10T00:00:00Z', '2026-10-10T00:00:00Z'),
      ).toBeNull();
      expect(
        bisectDateRange('2026-10-15T00:00:00Z', '2026-10-10T00:00:00Z'),
      ).toBeNull();
    });

    it('throws TicketmasterValidationError when date strings are unparseable', () => {
      expect(() =>
        bisectDateRange('invalid-date', '2026-10-10T00:00:00Z'),
      ).toThrow(TicketmasterValidationError);
    });
  });

  describe('planPartitions', () => {
    it('slices a 30-day range into 7-day chunks', () => {
      const start = '2026-10-01T00:00:00Z';
      const end = '2026-10-31T00:00:00Z';
      const partitions = planPartitions(start, end, 7);

      expect(partitions.length).toBe(5);
      expect(partitions[0].startDateTime).toBe('2026-10-01T00:00:00Z');
      expect(partitions[0].endDateTime).toBe('2026-10-08T00:00:00Z');
      expect(partitions[4].startDateTime).toBe('2026-10-29T00:00:00Z');
      expect(partitions[4].endDateTime).toBe('2026-10-31T00:00:00Z');
    });
  });

  describe('TicketmasterPartitionCoordinator & Recursive Fetching', () => {
    it('does not bisect when totalElements < 950 and paginates normally', async () => {
      const mockEventsP0 = [createMockEvent('ev-1', '2026-10-01')];
      const mockEventsP1 = [createMockEvent('ev-2', '2026-10-02')];

      const fetchFn = vi.fn().mockImplementation(async (params) => {
        if (params.page === 0) {
          return {
            response: createMockResponse(mockEventsP0, 2, 0, 1),
          };
        }
        return {
          response: createMockResponse(mockEventsP1, 2, 1, 1),
        };
      });

      const coordinator = new TicketmasterPartitionCoordinator({
        fetchFn,
        threshold: 950,
      });

      const result = await coordinator.fetchEvents({
        startDateTime: '2026-10-01T00:00:00Z',
        endDateTime: '2026-10-10T00:00:00Z',
        pageSize: 1,
      });

      expect(result.bisectionsCount).toBe(0);
      expect(result.totalUniqueEvents).toBe(2);
      expect(result.events.map((e) => e.id)).toEqual(['ev-1', 'ev-2']);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('automatically bisects temporal interval when totalElements >= 950', async () => {
      const evLeft = createMockEvent('ev-left-1', '2026-10-02');
      const evRight = createMockEvent('ev-right-1', '2026-10-07');

      const fetchFn = vi.fn().mockImplementation(async (params) => {
        // Initial wide probe returns 1,200 elements (exceeds 950 threshold)
        if (
          params.startDateTime === '2026-10-01T00:00:00Z' &&
          params.endDateTime === '2026-10-11T00:00:00Z'
        ) {
          return {
            response: createMockResponse([], 1200, 0, 200),
          };
        }

        // Left partition [10-01 to 10-06] returns 300 elements (< 950)
        if (
          params.startDateTime === '2026-10-01T00:00:00Z' &&
          params.endDateTime === '2026-10-06T00:00:00Z'
        ) {
          return {
            response: createMockResponse([evLeft], 1, 0, 200),
          };
        }

        // Right partition [10-06 to 10-11] returns 400 elements (< 950)
        if (
          params.startDateTime === '2026-10-06T00:00:00Z' &&
          params.endDateTime === '2026-10-11T00:00:00Z'
        ) {
          return {
            response: createMockResponse([evRight], 1, 0, 200),
          };
        }

        throw new Error(
          `Unexpected query range: ${params.startDateTime} to ${params.endDateTime}`,
        );
      });

      const result = await fetchPartitionedEvents({
        fetchFn,
        startDateTime: '2026-10-01T00:00:00Z',
        endDateTime: '2026-10-11T00:00:00Z',
        threshold: 950,
      });

      expect(result.bisectionsCount).toBe(1);
      expect(result.partitionsProcessed).toBe(2);
      expect(result.totalUniqueEvents).toBe(2);
      expect(result.events.map((e) => e.id)).toEqual([
        'ev-left-1',
        'ev-right-1',
      ]);
    });

    it('recursively bisects multiple levels down when sub-intervals also exceed threshold', async () => {
      // 20-day range: [Day 0 to 20] -> 2000 events
      // Left [Day 0 to 10] -> 1100 events (bisects again!)
      //   Left-Left [Day 0 to 5] -> 400 events (<950)
      //   Left-Right [Day 5 to 10] -> 500 events (<950)
      // Right [Day 10 to 20] -> 600 events (<950)

      const evLL = createMockEvent('ev-ll', '2026-10-02');
      const evLR = createMockEvent('ev-lr', '2026-10-07');
      const evR = createMockEvent('ev-r', '2026-10-15');

      const fetchFn = vi.fn().mockImplementation(async (params) => {
        const { startDateTime, endDateTime } = params;

        // Root
        if (
          startDateTime === '2026-10-01T00:00:00Z' &&
          endDateTime === '2026-10-21T00:00:00Z'
        ) {
          return { response: createMockResponse([], 2000, 0, 200) };
        }
        // Level 1 Left
        if (
          startDateTime === '2026-10-01T00:00:00Z' &&
          endDateTime === '2026-10-11T00:00:00Z'
        ) {
          return { response: createMockResponse([], 1100, 0, 200) };
        }
        // Level 2 Left-Left
        if (
          startDateTime === '2026-10-01T00:00:00Z' &&
          endDateTime === '2026-10-06T00:00:00Z'
        ) {
          return { response: createMockResponse([evLL], 1, 0, 200) };
        }
        // Level 2 Left-Right
        if (
          startDateTime === '2026-10-06T00:00:00Z' &&
          endDateTime === '2026-10-11T00:00:00Z'
        ) {
          return { response: createMockResponse([evLR], 1, 0, 200) };
        }
        // Level 1 Right
        if (
          startDateTime === '2026-10-11T00:00:00Z' &&
          endDateTime === '2026-10-21T00:00:00Z'
        ) {
          return { response: createMockResponse([evR], 1, 0, 200) };
        }

        throw new Error(`Unexpected query: ${startDateTime} to ${endDateTime}`);
      });

      const result = await fetchPartitionedEvents({
        fetchFn,
        startDateTime: '2026-10-01T00:00:00Z',
        endDateTime: '2026-10-21T00:00:00Z',
        threshold: 950,
      });

      expect(result.bisectionsCount).toBe(2);
      expect(result.partitionsProcessed).toBe(3);
      expect(result.totalUniqueEvents).toBe(3);
      expect(result.events.map((e) => e.id)).toEqual([
        'ev-ll',
        'ev-lr',
        'ev-r',
      ]);
    });

    it('stops bisecting when interval reaches 1 day and does not enter infinite loop', async () => {
      // Single day with 1,500 events: cannot be bisected because minIntervalDays = 1.
      // Must stop bisecting, paginate up to 1,000 items (page * size < 1000), and complete safely.
      const mockEvents = Array.from({ length: 5 }, (_, i) =>
        createMockEvent(`dense-ev-${i}`, '2026-10-01'),
      );

      let pageRequests = 0;
      const fetchFn = vi.fn().mockImplementation(async (params) => {
        pageRequests++;
        return {
          response: createMockResponse(
            mockEvents,
            1500, // exceeds 950 threshold!
            params.page ?? 0,
            200,
          ),
        };
      });

      const result = await fetchPartitionedEvents({
        fetchFn,
        startDateTime: '2026-10-01T00:00:00Z',
        endDateTime: '2026-10-02T00:00:00Z', // 1 day
        minIntervalDays: 1,
        threshold: 950,
        pageSize: 200,
      });

      // Bisection impossible since interval <= minIntervalDays
      expect(result.bisectionsCount).toBe(0);
      expect(result.partitionsProcessed).toBe(1);

      // Deep pagination cap: 5 pages * 200 = 1000 items (pages 0, 1, 2, 3, 4)
      // Page 5 * 200 = 1000, so page 5 is never requested
      expect(pageRequests).toBe(5);
    });

    it('prevents infinite recursion by stopping at maxDepth limit', async () => {
      // Even if threshold is exceeded and minIntervalDays is tiny (0.0001), maxDepth stops recursion
      const fetchFn = vi.fn().mockImplementation(async () => {
        return {
          response: createMockResponse(
            [createMockEvent('ev-deep', '2026-10-01')],
            1500,
            0,
            200,
          ),
        };
      });

      const result = await fetchPartitionedEvents({
        fetchFn,
        startDateTime: '2026-10-01T00:00:00Z',
        endDateTime: '2026-10-05T00:00:00Z',
        minIntervalDays: 0.001,
        maxDepth: 3,
        threshold: 950,
      });

      expect(result.bisectionsCount).toBeGreaterThanOrEqual(1);
      // Verify recursion stopped and did not overflow call stack
      expect(result.totalUniqueEvents).toBe(1);
    });

    it('idempotently deduplicates events appearing on partition boundaries', async () => {
      // An event right on the midpoint '2026-10-06T00:00:00Z' returned by both partitions
      const sharedEvent = createMockEvent('ev-shared', '2026-10-06');
      const uniqueLeft = createMockEvent('ev-left', '2026-10-03');
      const uniqueRight = createMockEvent('ev-right', '2026-10-08');

      const fetchFn = vi.fn().mockImplementation(async (params) => {
        if (
          params.startDateTime === '2026-10-01T00:00:00Z' &&
          params.endDateTime === '2026-10-11T00:00:00Z'
        ) {
          return { response: createMockResponse([], 1000, 0, 200) };
        }
        if (params.startDateTime === '2026-10-01T00:00:00Z') {
          return {
            response: createMockResponse([uniqueLeft, sharedEvent], 2, 0, 200),
          };
        }
        return {
          response: createMockResponse([sharedEvent, uniqueRight], 2, 0, 200),
        };
      });

      const result = await fetchPartitionedEvents({
        fetchFn,
        startDateTime: '2026-10-01T00:00:00Z',
        endDateTime: '2026-10-11T00:00:00Z',
        threshold: 950,
      });

      expect(result.totalUniqueEvents).toBe(3);
      expect(result.events.map((e) => e.id)).toEqual([
        'ev-left',
        'ev-shared',
        'ev-right',
      ]);
    });

    it('avoids duplicate requests for previously probed partitions', async () => {
      const requestedUrls: string[] = [];

      const fetchFn = vi.fn().mockImplementation(async (params) => {
        const key = `${params.startDateTime}__${params.endDateTime}__${params.page}`;
        requestedUrls.push(key);
        return {
          response: createMockResponse(
            [createMockEvent('e1', '2026-10-01')],
            1,
            0,
            200,
          ),
        };
      });

      await fetchPartitionedEvents({
        fetchFn,
        startDateTime: '2026-10-01T00:00:00Z',
        endDateTime: '2026-10-05T00:00:00Z',
      });

      // Every requested URL/key should be unique
      const uniqueRequested = new Set(requestedUrls);
      expect(requestedUrls.length).toBe(uniqueRequested.size);
    });
  });
});
