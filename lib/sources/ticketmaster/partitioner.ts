import { TicketmasterApiClient } from './client';
import { TicketmasterValidationError } from './errors';
import type {
  TicketmasterEvent,
  TicketmasterEventQueryParams,
  TicketmasterEventsResponse,
} from './types';

export interface DatePartition {
  startUtc: string;
  endUtc: string;
  startDateTime: string;
  endDateTime: string;
}

export interface PartitionSummary {
  startDateTime: string;
  endDateTime: string;
  totalElements: number;
  fetchedEventsCount: number;
  bisected: boolean;
  pagesFetched: number;
  depth: number;
}

export interface PartitionCoordinatorOptions {
  client?: TicketmasterApiClient;
  fetchFn?: (params: TicketmasterEventQueryParams) => Promise<{
    response: TicketmasterEventsResponse;
    rawJson?: string;
    url?: string;
  }>;
  baseParams?: TicketmasterEventQueryParams;
  startDateTime?: string;
  endDateTime?: string;
  threshold?: number; // default: 950
  minIntervalDays?: number; // default: 1
  maxDepth?: number; // default: 10
  pageSize?: number; // default: 200 (Ticketmaster max per page)
  isEssential?: boolean;
}

export interface PartitionCoordinatorResult {
  events: TicketmasterEvent[];
  totalUniqueEvents: number;
  totalRequestsMade: number;
  partitionsProcessed: number;
  bisectionsCount: number;
  partitions: PartitionSummary[];
}

/**
 * Formats a Date object as an ISO-8601 UTC string (YYYY-MM-DDTHH:mm:ssZ).
 */
export function toIsoUtc(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Splits a temporal date interval [startUtc, endUtc] into two equal halves [start, mid] and [mid, end].
 * Returns null if the interval is already less than or equal to minIntervalDays, or if start >= end.
 */
export function bisectDateRange(
  startUtc: string | Date,
  endUtc: string | Date,
  minIntervalDays: number = 1,
): [DatePartition, DatePartition] | null {
  const startDate =
    typeof startUtc === 'string' ? new Date(startUtc) : startUtc;
  const endDate = typeof endUtc === 'string' ? new Date(endUtc) : endUtc;

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new TicketmasterValidationError(
      `Invalid date range for bisection: start=${String(startUtc)}, end=${String(endUtc)}`,
    );
  }

  const durationMs = endDate.getTime() - startDate.getTime();
  if (durationMs <= 0) {
    return null;
  }

  const effectiveMinDays = Math.max(0.001, minIntervalDays);
  const minIntervalMs = effectiveMinDays * 24 * 60 * 60 * 1000;

  if (durationMs <= minIntervalMs) {
    return null;
  }

  const midMs = Math.floor((startDate.getTime() + endDate.getTime()) / 2);
  const midDate = new Date(midMs);

  const startStr = toIsoUtc(startDate);
  const midStr = toIsoUtc(midDate);
  const endStr = toIsoUtc(endDate);

  const left: DatePartition = {
    startUtc: startStr,
    endUtc: midStr,
    startDateTime: startStr,
    endDateTime: midStr,
  };

  const right: DatePartition = {
    startUtc: midStr,
    endUtc: endStr,
    startDateTime: midStr,
    endDateTime: endStr,
  };

  return [left, right];
}

/**
 * Plans static partitions of a date range into chunks of targetIntervalDays.
 */
export function planPartitions(
  startUtc: string | Date,
  endUtc: string | Date,
  targetIntervalDays: number = 7,
): DatePartition[] {
  const startDate =
    typeof startUtc === 'string' ? new Date(startUtc) : startUtc;
  const endDate = typeof endUtc === 'string' ? new Date(endUtc) : endUtc;

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new TicketmasterValidationError(
      `Invalid date range for partition planning: start=${String(startUtc)}, end=${String(endUtc)}`,
    );
  }

  const partitions: DatePartition[] = [];
  const chunkMs = Math.max(1, targetIntervalDays) * 24 * 60 * 60 * 1000;
  let cur = startDate.getTime();
  const endLimit = endDate.getTime();

  while (cur < endLimit) {
    const next = Math.min(cur + chunkMs, endLimit);
    const startStr = toIsoUtc(new Date(cur));
    const endStr = toIsoUtc(new Date(next));
    partitions.push({
      startUtc: startStr,
      endUtc: endStr,
      startDateTime: startStr,
      endDateTime: endStr,
    });
    cur = next;
  }

  return partitions;
}

/**
 * Coordinates recursive date bisection when Ticketmaster queries return >= 950 results
 * (approaching the strict 1,000-item pagination limit).
 * Idempotently fetches and combines results across sub-intervals without duplicate requests.
 */
export class TicketmasterPartitionCoordinator {
  private readonly client?: TicketmasterApiClient;
  private readonly customFetchFn?: (
    params: TicketmasterEventQueryParams,
  ) => Promise<{
    response: TicketmasterEventsResponse;
    rawJson?: string;
    url?: string;
  }>;
  private readonly threshold: number;
  private readonly minIntervalDays: number;
  private readonly maxDepth: number;
  private readonly pageSize: number;

  constructor(options: PartitionCoordinatorOptions) {
    this.client = options.client;
    this.customFetchFn = options.fetchFn;
    this.threshold = options.threshold ?? 950;
    this.minIntervalDays = options.minIntervalDays ?? 1;
    this.maxDepth = options.maxDepth ?? 10;
    this.pageSize = options.pageSize ?? options.baseParams?.size ?? 200;

    if (!this.client && !this.customFetchFn) {
      throw new TicketmasterValidationError(
        'TicketmasterPartitionCoordinator requires either a TicketmasterApiClient or custom fetchFn.',
      );
    }
  }

  private async executeFetch(
    params: TicketmasterEventQueryParams,
    isEssential?: boolean,
  ): Promise<{
    response: TicketmasterEventsResponse;
    rawJson?: string;
    url?: string;
  }> {
    if (this.customFetchFn) {
      return this.customFetchFn(params);
    }
    if (this.client) {
      return this.client.fetchEvents(params, { isEssential });
    }
    throw new TicketmasterValidationError('No client or fetchFn available.');
  }

  /**
   * Recursively fetches events within the specified time window, bisecting whenever
   * totalElements >= threshold until totalElements < threshold or minIntervalDays is reached.
   */
  async fetchEvents(
    options: Omit<
      PartitionCoordinatorOptions,
      'client' | 'fetchFn' | 'threshold' | 'minIntervalDays' | 'maxDepth'
    > & {
      threshold?: number;
      minIntervalDays?: number;
      maxDepth?: number;
    } = {},
  ): Promise<PartitionCoordinatorResult> {
    const threshold = options.threshold ?? this.threshold;
    const minIntervalDays = options.minIntervalDays ?? this.minIntervalDays;
    const maxDepth = options.maxDepth ?? this.maxDepth;
    const pageSize = Math.min(
      200,
      Math.max(1, options.pageSize ?? this.pageSize),
    );
    const isEssential = options.isEssential ?? false;
    const baseParams: TicketmasterEventQueryParams = {
      ...(options.baseParams || {}),
      allInclusivePricing: options.baseParams?.allInclusivePricing ?? true,
    };

    const startDateTime =
      options.startDateTime || baseParams.startDateTime || toIsoUtc(new Date());
    const endDateTime =
      options.endDateTime ||
      baseParams.endDateTime ||
      toIsoUtc(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

    const seenEventIds = new Set<string>();
    const uniqueEvents: TicketmasterEvent[] = [];
    const executedRequests = new Set<string>();
    const page0Cache = new Map<string, TicketmasterEventsResponse>();
    const partitionsSummary: PartitionSummary[] = [];
    let requestsMade = 0;
    let bisectionsCount = 0;

    const processInterval = async (
      start: string,
      end: string,
      depth: number,
    ): Promise<void> => {
      const intervalKey = `${start}__${end}`;
      let page0Response = page0Cache.get(intervalKey);

      if (!page0Response) {
        const reqKey0 = `${intervalKey}__0`;
        executedRequests.add(reqKey0);
        const result0 = await this.executeFetch(
          {
            ...baseParams,
            startDateTime: start,
            endDateTime: end,
            page: 0,
            size: pageSize,
          },
          isEssential,
        );
        requestsMade++;
        page0Response = result0.response;
        page0Cache.set(intervalKey, page0Response);
      }

      const totalElements = page0Response.page.totalElements;
      const shouldBisect = totalElements >= threshold;

      if (shouldBisect && depth < maxDepth) {
        const bisected = bisectDateRange(start, end, minIntervalDays);
        if (bisected !== null) {
          bisectionsCount++;
          partitionsSummary.push({
            startDateTime: start,
            endDateTime: end,
            totalElements,
            fetchedEventsCount: 0,
            bisected: true,
            pagesFetched: 1,
            depth,
          });

          // Recursively process left and right sub-intervals
          await processInterval(
            bisected[0].startDateTime,
            bisected[0].endDateTime,
            depth + 1,
          );
          await processInterval(
            bisected[1].startDateTime,
            bisected[1].endDateTime,
            depth + 1,
          );
          return;
        }
      }

      // Interval is either small enough (< threshold), reached minIntervalDays, or hit maxDepth.
      // Collect events from page 0
      const page0Events = page0Response._embedded?.events || [];
      let intervalFetched = 0;
      for (const ev of page0Events) {
        if (!seenEventIds.has(ev.id)) {
          seenEventIds.add(ev.id);
          uniqueEvents.push(ev);
          intervalFetched++;
        }
      }

      // Paginate remaining pages while page * size < 1000
      const totalPages = page0Response.page.totalPages;
      let pagesFetched = 1;

      for (let p = 1; p < totalPages; p++) {
        if (p * pageSize >= 1000) {
          // Deep pagination limit reached
          break;
        }

        const pageKey = `${intervalKey}__${p}`;
        if (executedRequests.has(pageKey)) {
          continue;
        }
        executedRequests.add(pageKey);

        const pageResult = await this.executeFetch(
          {
            ...baseParams,
            startDateTime: start,
            endDateTime: end,
            page: p,
            size: pageSize,
          },
          isEssential,
        );
        requestsMade++;
        pagesFetched++;

        const events = pageResult.response._embedded?.events || [];
        for (const ev of events) {
          if (!seenEventIds.has(ev.id)) {
            seenEventIds.add(ev.id);
            uniqueEvents.push(ev);
            intervalFetched++;
          }
        }
      }

      partitionsSummary.push({
        startDateTime: start,
        endDateTime: end,
        totalElements,
        fetchedEventsCount: intervalFetched,
        bisected: false,
        pagesFetched,
        depth,
      });
    };

    await processInterval(startDateTime, endDateTime, 0);

    return {
      events: uniqueEvents,
      totalUniqueEvents: uniqueEvents.length,
      totalRequestsMade: requestsMade,
      partitionsProcessed: partitionsSummary.filter((p) => !p.bisected).length,
      bisectionsCount,
      partitions: partitionsSummary,
    };
  }
}

/**
 * Convenience function to fetch partitioned events using TicketmasterPartitionCoordinator.
 */
export async function fetchPartitionedEvents(
  options: PartitionCoordinatorOptions,
): Promise<PartitionCoordinatorResult> {
  const coordinator = new TicketmasterPartitionCoordinator(options);
  return coordinator.fetchEvents(options);
}
