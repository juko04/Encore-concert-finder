import { describe, expect, it, vi } from 'vitest';
import {
  bisectDateRange,
  planPartitions,
  TicketmasterPartitionCoordinator,
  fetchPartitionedEvents,
} from '@/lib/sources/ticketmaster/partitioner';
import { TicketmasterValidationError } from '@/lib/sources/ticketmaster/errors';
import {
  MemoryCatalogRepository,
  MemoryEventCandidateRepository,
  MemoryRawIngestRepository,
  MemorySourceRepository,
} from '@/lib/repositories/memory-repositories';
import {
  TicketmasterDiscoveryAdapter,
  runTicketmasterIngestion,
} from '@/lib/sources/ticketmaster';
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
    _embedded: {
      venues: [
        {
          id: 'venue-1',
          name: 'Red Rocks Amphitheatre',
          city: { name: 'Morrison' },
          state: { stateCode: 'CO' },
          timezone: 'America/Denver',
        },
      ],
      attractions: [
        {
          id: `artist-${id}`,
          name: `Artist ${id}`,
        },
      ],
    },
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

  describe('Ticketmaster Ingestion Pipeline Partitioning Integration', () => {
    it('integrates partitioned fetching into runTicketmasterIngestion, persisting partitions and deduplicating boundary events', async () => {
      const sourceRepo = new MemorySourceRepository();
      const rawIngestRepo = new MemoryRawIngestRepository();
      const candidateRepo = new MemoryEventCandidateRepository();
      const catalogRepo = new MemoryCatalogRepository();

      const evLeft = createMockEvent('ev-pipe-1', '2026-10-02');
      const evShared = createMockEvent('ev-pipe-shared', '2026-10-06');
      const evRight = createMockEvent('ev-pipe-2', '2026-10-08');

      const mockFetchFn = vi.fn().mockImplementation(async (params) => {
        const { startDateTime, endDateTime } = params;
        if (
          startDateTime === '2026-10-01T00:00:00Z' &&
          endDateTime === '2026-10-11T00:00:00Z'
        ) {
          return {
            response: createMockResponse([], 1400, 0, 200),
            rawJson: JSON.stringify(createMockResponse([], 1400, 0, 200)),
            url: `https://app.ticketmaster.com/discovery/v2/events.json?startDateTime=${startDateTime}&endDateTime=${endDateTime}&page=0`,
          };
        }
        if (startDateTime === '2026-10-01T00:00:00Z') {
          return {
            response: createMockResponse([evLeft, evShared], 2, 0, 200),
            rawJson: JSON.stringify(
              createMockResponse([evLeft, evShared], 2, 0, 200),
            ),
            url: `https://app.ticketmaster.com/discovery/v2/events.json?startDateTime=${startDateTime}&endDateTime=${endDateTime}&page=0`,
          };
        }
        return {
          response: createMockResponse([evShared, evRight], 2, 0, 200),
          rawJson: JSON.stringify(
            createMockResponse([evShared, evRight], 2, 0, 200),
          ),
          url: `https://app.ticketmaster.com/discovery/v2/events.json?startDateTime=${startDateTime}&endDateTime=${endDateTime}&page=0`,
        };
      });

      const adapter = new TicketmasterDiscoveryAdapter();
      const result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        usePartitioner: true,
        persist: true,
        queryParams: {
          startDateTime: '2026-10-01T00:00:00Z',
          endDateTime: '2026-10-11T00:00:00Z',
        },
        partitionOptions: {
          fetchFn: mockFetchFn,
          threshold: 950,
        },
      });

      // Partitions processed
      expect(result.bisectionsCount).toBe(1);
      expect(result.partitionsProcessed).toBe(2);
      expect(result.hasIncompleteCoverage).toBe(false);

      // Raw ingests persisted for each leaf partition page
      expect(result.rawIngestsFetched).toBe(2);
      expect(result.rawIngestsPersisted).toBe(2);

      // Deduplication: 3 unique events (ev-pipe-1, ev-pipe-shared, ev-pipe-2), NOT 4
      expect(result.candidatesParsed).toBe(3);
      expect(result.candidatesPersisted).toBe(3);
      expect(result.canonicalEventsCreated).toBe(3);

      // Verify raw ingests in repo have correct sourceId and content
      const persistedIngests = await rawIngestRepo.listBySource(
        result.source.id,
      );
      expect(persistedIngests.length).toBe(2);
      expect(persistedIngests[0].contentType).toBe('application/json');
      expect(persistedIngests[0].contentHash).toBeDefined();

      // Verify candidates in repo preserve provenance
      const candShared = await candidateRepo.listBySourceEventId(
        result.source.id,
        'ev-pipe-shared',
      );
      expect(candShared.length).toBe(1);
      expect(candShared[0].rawIngestId).toBeDefined();

      const candLeft = await candidateRepo.listBySourceEventId(
        result.source.id,
        'ev-pipe-1',
      );
      expect(candLeft.length).toBe(1);

      const candRight = await candidateRepo.listBySourceEventId(
        result.source.id,
        'ev-pipe-2',
      );
      expect(candRight.length).toBe(1);
    });

    it('detects incomplete coverage when a partition reaches 1-day minimum interval with >1,000 events', async () => {
      const sourceRepo = new MemorySourceRepository();
      const rawIngestRepo = new MemoryRawIngestRepository();
      const candidateRepo = new MemoryEventCandidateRepository();
      const catalogRepo = new MemoryCatalogRepository();

      const denseEvents = Array.from({ length: 5 }, (_, i) =>
        createMockEvent(`dense-ev-${i}`, '2026-10-01'),
      );

      // Simulate 1,500 events on a 1-day interval
      const mockFetchFn = vi.fn().mockImplementation(async (params) => {
        return {
          response: createMockResponse(
            denseEvents,
            1500,
            params.page ?? 0,
            200,
          ),
          rawJson: JSON.stringify(
            createMockResponse(denseEvents, 1500, params.page ?? 0, 200),
          ),
          url: `https://app.ticketmaster.com/discovery/v2/events.json?page=${params.page ?? 0}`,
        };
      });

      const adapter = new TicketmasterDiscoveryAdapter();
      const result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        usePartitioner: true,
        persist: true,
        queryParams: {
          startDateTime: '2026-10-01T00:00:00Z',
          endDateTime: '2026-10-02T00:00:00Z', // 1 day
        },
        partitionOptions: {
          fetchFn: mockFetchFn,
          threshold: 950,
          minIntervalDays: 1,
          pageSize: 200,
        },
      });

      // Bisection not possible because interval is 1 day <= minIntervalDays
      expect(result.bisectionsCount).toBe(0);
      expect(result.partitionsProcessed).toBe(1);

      // Truncation detected! (1500 total elements > 1000 items paginated)
      expect(result.hasIncompleteCoverage).toBe(true);
      expect(result.truncatedPartitions).toBeDefined();
      expect(result.truncatedPartitions?.length).toBe(1);
      expect(result.truncatedPartitions?.[0].totalElements).toBe(1500);
      expect(result.truncatedPartitions?.[0].isTruncated).toBe(true);
    });

    it('successfully processes >1,000 provider events end-to-end through runTicketmasterIngestion across bisected partitions with full coverage', async () => {
      const sourceRepo = new MemorySourceRepository();
      const rawIngestRepo = new MemoryRawIngestRepository();
      const candidateRepo = new MemoryEventCandidateRepository();
      const catalogRepo = new MemoryCatalogRepository();

      // Helper to generate distinct mock events across distinct venues/artists
      const createDistinctEvent = (
        id: string,
        date: string,
      ): TicketmasterEvent => {
        const ev = createMockEvent(id, date);
        ev._embedded!.venues = [
          {
            id: `venue-${id}`,
            name: `Venue ${id}`,
            city: { name: 'Denver' },
            state: { stateCode: 'CO' },
            timezone: 'America/Denver',
          },
        ];
        return ev;
      };

      // Create 1,050 unique mock events (525 left partition, 525 right partition)
      const leftEvents = Array.from({ length: 525 }, (_, i) =>
        createDistinctEvent(`ev-1k-left-${i}`, '2026-10-02'),
      );
      const rightEvents = Array.from({ length: 525 }, (_, i) =>
        createDistinctEvent(`ev-1k-right-${i}`, '2026-10-08'),
      );

      const mockFetchFn = vi.fn().mockImplementation(async (params) => {
        const { startDateTime, endDateTime, page = 0, size = 200 } = params;

        // Root probe across 10-day range returns 1,050 elements (exceeds 950 threshold)
        if (
          startDateTime === '2026-10-01T00:00:00Z' &&
          endDateTime === '2026-10-11T00:00:00Z'
        ) {
          return {
            response: createMockResponse([], 1050, 0, size),
            rawJson: JSON.stringify(createMockResponse([], 1050, 0, size)),
            url: `https://app.ticketmaster.com/discovery/v2/events.json?startDateTime=${startDateTime}&endDateTime=${endDateTime}&page=0`,
          };
        }

        // Left partition [10-01 to 10-06] holds 525 elements (< 950)
        if (startDateTime === '2026-10-01T00:00:00Z') {
          const slice = leftEvents.slice(page * size, (page + 1) * size);
          return {
            response: createMockResponse(slice, 525, page, size),
            rawJson: JSON.stringify(createMockResponse(slice, 525, page, size)),
            url: `https://app.ticketmaster.com/discovery/v2/events.json?startDateTime=${startDateTime}&endDateTime=${endDateTime}&page=${page}`,
          };
        }

        // Right partition [10-06 to 10-11] holds 525 elements (< 950)
        if (startDateTime === '2026-10-06T00:00:00Z') {
          const slice = rightEvents.slice(page * size, (page + 1) * size);
          return {
            response: createMockResponse(slice, 525, page, size),
            rawJson: JSON.stringify(createMockResponse(slice, 525, page, size)),
            url: `https://app.ticketmaster.com/discovery/v2/events.json?startDateTime=${startDateTime}&endDateTime=${endDateTime}&page=${page}`,
          };
        }

        throw new Error(`Unexpected range: ${startDateTime} to ${endDateTime}`);
      });

      const adapter = new TicketmasterDiscoveryAdapter();
      const result = await runTicketmasterIngestion({
        sourceRepo,
        rawIngestRepo,
        candidateRepo,
        catalogRepo,
        adapter,
        usePartitioner: true,
        persist: true,
        queryParams: {
          startDateTime: '2026-10-01T00:00:00Z',
          endDateTime: '2026-10-11T00:00:00Z',
        },
        partitionOptions: {
          fetchFn: mockFetchFn,
          threshold: 950,
          pageSize: 200,
        },
      });

      // Verify partition coordination metrics
      expect(result.bisectionsCount).toBe(1);
      expect(result.partitionsProcessed).toBe(2);
      expect(result.hasIncompleteCoverage).toBe(false);
      expect(result.truncatedPartitions).toEqual([]);

      // Verify >1,000 events: 6 total pages fetched (3 left + 3 right: 200 + 200 + 125 each)
      expect(result.rawIngestsFetched).toBe(6);
      expect(result.rawIngestsPersisted).toBe(6);

      // Verify exactly 1,050 candidates extracted and canonicalized
      expect(result.candidatesParsed).toBe(1050);
      expect(result.candidatesPersisted).toBe(1050);
      expect(result.canonicalEventsCreated).toBe(1050);

      // Verify database repository state
      const persistedIngests = await rawIngestRepo.listBySource(
        result.source.id,
      );
      expect(persistedIngests.length).toBe(6);

      const allEvents = await catalogRepo.listEvents({ limit: 2000 });
      expect(allEvents.length).toBe(1050);
    }, 30000);
  });
});
