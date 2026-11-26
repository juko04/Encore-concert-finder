import 'server-only';

/**
 * Supabase-backed MarketPriceStore. Catalog reads are read-only; the two write methods are
 * only called by the pipeline in `--write` mode, after the destination guard has passed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseRawIngestRepository } from '@/lib/repositories/raw-ingest-repository';
import type { MarketPriceStore } from './pipeline';
import {
  SEATGEEK_PARSER_VERSION,
  type CatalogEventForMatch,
  type MarketPriceObservationInput,
} from './types';

interface CatalogRow {
  id: string;
  name: string;
  event_kind: string;
  local_start_date: string;
  local_end_date: string | null;
  starts_at: string | null;
  min_price: number | string | null;
  max_price: number | string | null;
  festival_group_id: string | null;
  festival_group_primary: boolean | null;
  festival_group_end_date: string | null;
  venues: {
    name: string | null;
    region: string | null;
    lat: number | string | null;
    lng: number | string | null;
    venue_aliases: Array<{ alias: string | null }> | null;
  } | null;
  event_artists: Array<{ artists: { name: string | null } | null }> | null;
}

const PAGE = 1000;

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapCatalogRow(row: CatalogRow): CatalogEventForMatch {
  const end =
    row.festival_group_end_date ?? row.local_end_date ?? row.local_start_date;
  return {
    id: row.id,
    name: row.name,
    eventKind: row.event_kind,
    localStartDate: row.local_start_date,
    localEndDate: end < row.local_start_date ? row.local_start_date : end,
    startsAt: row.starts_at,
    hasListedPrice:
      toNumber(row.min_price) !== null || toNumber(row.max_price) !== null,
    festivalGroupId: row.festival_group_id,
    festivalGroupPrimary: row.festival_group_primary === true,
    venue: {
      name: row.venues?.name ?? null,
      aliases: (row.venues?.venue_aliases ?? [])
        .map((a) => a.alias)
        .filter((a): a is string => Boolean(a)),
      region: row.venues?.region ?? null,
      lat: toNumber(row.venues?.lat),
      lng: toNumber(row.venues?.lng),
    },
    artistNames: (row.event_artists ?? [])
      .map((ea) => ea.artists?.name)
      .filter((n): n is string => Boolean(n)),
  };
}

export class SupabaseMarketPriceStore implements MarketPriceStore {
  private readonly client: SupabaseClient;
  private readonly rawIngests: SupabaseRawIngestRepository;

  constructor(client?: SupabaseClient) {
    this.client = client ?? createAdminClient();
    this.rawIngests = new SupabaseRawIngestRepository(this.client);
  }

  async loadCatalogEvents(
    fromDate: string,
    toDate: string,
  ): Promise<CatalogEventForMatch[]> {
    const out: CatalogEventForMatch[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await this.client
        .from('events')
        .select(
          'id, name, event_kind, local_start_date, local_end_date, starts_at, min_price, max_price, ' +
            'festival_group_id, festival_group_primary, festival_group_end_date, ' +
            'venues(name, region, lat, lng, venue_aliases(alias)), event_artists(artists(name))',
        )
        .gte('local_start_date', fromDate)
        .lte('local_start_date', toDate)
        .neq('status', 'cancelled')
        .order('local_start_date', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error)
        throw new Error(`Failed to load catalog events: ${error.message}`);
      const rows = (data ?? []) as unknown as CatalogRow[];
      out.push(...rows.map(mapCatalogRow));
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async saveRawIngest(page: {
    sourceId: string;
    sourceUrl: string;
    body: string;
    status: number;
    contentHash: string;
    fetchedAt: string;
  }): Promise<string> {
    const saved = await this.rawIngests.create({
      sourceId: page.sourceId,
      sourceUrl: page.sourceUrl,
      acquisitionMethod: 'api',
      fetchedAt: page.fetchedAt,
      contentHash: page.contentHash,
      contentType: 'application/json',
      rawContent: page.body,
      httpStatus: page.status,
      parserVersion: SEATGEEK_PARSER_VERSION,
    });
    return saved.id;
  }

  async insertObservations(
    rows: MarketPriceObservationInput[],
  ): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => {
        if (!r.rawIngestId)
          throw new Error('Observation is missing its raw ingest id');
        return {
          event_id: r.eventId,
          source_id: r.sourceId,
          raw_ingest_id: r.rawIngestId,
          marketplace_event_id: r.marketplaceEventId,
          marketplace_url: r.marketplaceUrl,
          lowest_price: r.lowestPrice,
          average_price: r.averagePrice,
          highest_price: r.highestPrice,
          listing_count: r.listingCount,
          currency: r.currency,
          observed_at: r.observedAt,
          match_method: r.matchMethod,
          match_confidence: r.matchConfidence,
          parser_version: r.parserVersion,
        };
      });
      const { data, error } = await this.client
        .from('market_price_observations')
        .upsert(chunk, {
          onConflict: 'raw_ingest_id,marketplace_event_id,event_id,observed_at',
          ignoreDuplicates: true,
        })
        .select('id');
      if (error)
        throw new Error(
          `Failed to insert market price observations: ${error.message}`,
        );
      inserted += data?.length ?? 0;
    }
    return inserted;
  }
}
