import 'server-only';

import { cleanLineupForDisplay } from '@/lib/events/lineup';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidCoordinatePair } from '@/lib/location/coordinates';
import type {
  Artist,
  ArtistExternalId,
  BillingPosition,
  CandidateResolution,
  CanonicalEventDetail,
  CanonicalEventSourceSummary,
  CanonicalEventSummary,
  CanonicalizationPayload,
  Event,
  EventArtist,
  EventFieldEvidence,
  EventPromoter,
  EventSourceRecord,
  EventTicketLink,
  Promoter,
  PromoterRelationshipType,
  TicketInventoryStatus,
  Venue,
} from '@/lib/domain/catalog';
import { escapeLikePattern, normalizeUrl } from '@/lib/domain/value-objects';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  EventListFilters,
  EventLocationRow,
  EventSortOption,
  FestivalDay,
  ICatalogRepository,
} from './interfaces';
import {
  canonicalGenreLabel,
  genreDbTerms,
  normalizeGenreFacets,
  resolveGenreQuery,
} from '@/lib/genres/catalog-genres';

/**
 * PostgREST `or=` clause for the genre filter. Canonical labels expand to every stored spelling
 * (Hip-Hop -> "hip-hop", "hip hop", "rap", ...); other strings keep the previous substring match.
 */
function buildGenreFilterClause(rawGenre: string): string {
  const trimmed = rawGenre.trim();
  const label = canonicalGenreLabel(trimmed);
  const terms = label ? genreDbTerms(label) : [];
  const needles = terms.length > 0 ? terms : [trimmed];
  const parts: string[] = [];
  for (const needle of needles) {
    const e = escapeLikePattern(needle).replace(/"/g, '""');
    parts.push(`genre.ilike."%${e}%"`);
  }
  const arr = trimmed.toLowerCase().replace(/"/g, '');
  parts.push(`genres.cs.{"${arr}"}`);
  return parts.join(',');
}

// Database row interfaces
interface ArtistRow {
  id: string;
  name: string;
  normalized_name: string;
  image_url: string | null;
  /** Optional: column added by migration 20261124010000; tolerate absence. */
  genres?: string[] | null;
  created_at: string;
  updated_at: string;
}

interface VenueRow {
  id: string;
  name: string;
  normalized_name: string;
  city: string;
  region: string | null;
  country_code: string;
  lat: number | null;
  lng: number | null;
  timezone: string | null;
  website: string | null;
  capacity: number | null;
  /** Added by migration 20261124000000; undefined until that migration is applied. */
  image_url?: string | null;
  created_at: string;
  updated_at: string;
}

interface PromoterRow {
  id: string;
  name: string;
  normalized_name: string;
  website: string | null;
  calendar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  name: string;
  normalized_name: string;
  event_kind: Event['eventKind'];
  status: Event['status'];
  venue_id: string | null;
  city: string | null;
  region: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  local_start_date: string;
  local_end_date: string | null;
  starts_at: string | null;
  ends_at: string | null;
  start_time_precision: Event['startTimePrecision'];
  doors_at: string | null;
  is_multi_day: boolean;
  official_url: string | null;
  primary_ticket_url: string | null;
  min_price?: number | null;
  max_price?: number | null;
  currency?: string | null;
  announced_at: string | null;
  genre?: string | null;
  genres?: string[] | null;
  /** Added by migration 20261126050000; undefined until applied. */
  genres_source?: string | null;
  /** Added by migration 20261126070000; undefined until applied. */
  festival_group_primary?: boolean | null;
  festival_group_size?: number | null;
  festival_group_end_date?: string | null;
  /** Added by migration 20261124000000; undefined until that migration is applied. */
  image_url?: string | null;
  created_at: string;
  updated_at: string;
}

interface EventArtistRow {
  id: string;
  event_id: string;
  artist_id: string;
  billing_position: BillingPosition;
  sort_order: number;
  created_at: string;
  artists?: ArtistRow | null;
}

interface EventPromoterRow {
  id: string;
  event_id: string;
  promoter_id: string;
  relationship_type: PromoterRelationshipType;
  created_at: string;
  promoters?: PromoterRow;
}

interface EventTicketLinkRow {
  id: string;
  event_id: string;
  ticket_provider_source_id: string | null;
  url: string;
  normalized_url: string;
  min_price: number | string | null;
  max_price: number | string | null;
  currency: string | null;
  inventory_status: TicketInventoryStatus;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EventSourceRow {
  id: string;
  event_id: string;
  source_id: string;
  candidate_id: string | null;
  raw_ingest_id: string | null;
  source_event_id: string | null;
  source_url: string;
  confidence: number | string;
  first_seen_at: string;
  last_seen_at: string;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

interface EventFieldEvidenceRow {
  id: string;
  event_id: string;
  field_name: string;
  event_source_id: string | null;
  source_id: string;
  raw_ingest_id: string | null;
  candidate_id: string | null;
  observed_value: unknown;
  value_hash: string;
  confidence: number | string;
  observed_at: string;
  parser_version: string;
  created_at: string;
}

interface CandidateResolutionRow {
  id: string;
  event_candidate_id: string;
  event_id: string | null;
  status: CandidateResolution['status'];
  matcher_version: string;
  confidence: number | string;
  reasons: Record<string, unknown> | string[];
  resolved_at: string;
  created_at: string;
}

function normalizeGenreList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (g): g is string => typeof g === 'string' && g.trim() !== '',
  );
}

function mapArtistRow(row: ArtistRow): Artist {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    imageUrl: row.image_url,
    genres: normalizeGenreList(row.genres),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVenueRow(row: VenueRow): Venue {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    city: row.city,
    region: row.region,
    countryCode: row.country_code,
    lat: row.lat,
    lng: row.lng,
    timezone: row.timezone,
    website: row.website,
    capacity: row.capacity,
    imageUrl: row.image_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPromoterRow(row: PromoterRow): Promoter {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    website: row.website,
    calendarUrl: row.calendar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEventRow(row: EventRow): Event {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    eventKind: row.event_kind,
    status: row.status,
    venueId: row.venue_id,
    city: row.city,
    region: row.region,
    countryCode: row.country_code,
    lat: row.lat,
    lng: row.lng,
    timezone: row.timezone,
    localStartDate: row.local_start_date,
    localEndDate: row.local_end_date,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startTimePrecision: row.start_time_precision,
    doorsAt: row.doors_at,
    isMultiDay: row.is_multi_day,
    officialUrl: row.official_url,
    primaryTicketUrl: row.primary_ticket_url,
    minPrice:
      row.min_price !== undefined
        ? row.min_price !== null
          ? Number(row.min_price)
          : null
        : undefined,
    maxPrice:
      row.max_price !== undefined
        ? row.max_price !== null
          ? Number(row.max_price)
          : null
        : undefined,
    currency: row.currency,
    announcedAt: row.announced_at,
    genre: row.genre ?? null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    genresSource: row.genres_source ?? null,
    festivalGroupEndDate:
      row.festival_group_primary !== false && (row.festival_group_size ?? 1) > 1
        ? (row.festival_group_end_date ?? null)
        : null,
    imageUrl: row.image_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTicketLinkRow(row: EventTicketLinkRow): EventTicketLink {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketProviderSourceId: row.ticket_provider_source_id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    minPrice: row.min_price !== null ? Number(row.min_price) : null,
    maxPrice: row.max_price !== null ? Number(row.max_price) : null,
    currency: row.currency,
    inventoryStatus: row.inventory_status,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSourceRecordRow(row: EventSourceRow): EventSourceRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    sourceId: row.source_id,
    candidateId: row.candidate_id,
    rawIngestId: row.raw_ingest_id,
    sourceEventId: row.source_event_id,
    sourceUrl: row.source_url,
    confidence: Number(row.confidence),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    isCurrent: row.is_current,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFieldEvidenceRow(row: EventFieldEvidenceRow): EventFieldEvidence {
  return {
    id: row.id,
    eventId: row.event_id,
    fieldName: row.field_name,
    eventSourceId: row.event_source_id,
    sourceId: row.source_id,
    rawIngestId: row.raw_ingest_id,
    candidateId: row.candidate_id,
    observedValue: row.observed_value,
    valueHash: row.value_hash,
    confidence: Number(row.confidence),
    observedAt: row.observed_at,
    parserVersion: row.parser_version,
    createdAt: row.created_at,
  };
}

function mapResolutionRow(row: CandidateResolutionRow): CandidateResolution {
  return {
    id: row.id,
    eventCandidateId: row.event_candidate_id,
    eventId: row.event_id,
    status: row.status,
    matcherVersion: row.matcher_version,
    confidence: Number(row.confidence),
    reasons: row.reasons,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

/** Internal option: a single, already-resolved PostgREST `or=` search group. */
interface SearchOpts {
  searchOr?: string;
}

const ID_PAGE_SIZE = 1000;
const LIGHT_SCAN_CONCURRENCY = 6;
/** Columns the radius scan needs plus the sort keys (for multi-group merges). */
const LIGHT_EVENT_SELECT =
  'id, city, region, lat, lng, name, local_start_date, starts_at, min_price, venues(city, region, lat, lng)';

interface LightEventRow {
  id: string;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  name: string;
  local_start_date: string;
  starts_at: string | null;
  min_price: number | string | null;
  venues?: {
    city: string | null;
    region: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
}

/** Same venue-first resolution as the summary mapping in hydrateEventRows. */
function lightRowToLocation(r: LightEventRow): EventLocationRow {
  return {
    id: r.id,
    city: r.venues?.city ?? r.city ?? null,
    region: r.venues?.region ?? r.region ?? null,
    lat: r.venues?.lat ?? r.lat ?? null,
    lng: r.venues?.lng ?? r.lng ?? null,
  };
}
/** ~37 chars per uuid => ~3 KB of ids per request, safely under URL limits. */
const SEARCH_IDS_PER_GROUP = 80;
const SEARCH_GROUP_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const idx = next++;
        results[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Ascending/descending with NULLs always last (matches nullsFirst:false). */
const cmpNullable = (
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 1 | -1,
) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
};
const startsAtMs = (e: CanonicalEventSummary) =>
  e.startsAt ? Date.parse(e.startsAt) : null;

/** In-memory mirror of the ORDER BY chains used by listEvents (id tiebreaker). */
export function compareEventSummaries(
  sortBy: string,
): (a: CanonicalEventSummary, b: CanonicalEventSummary) => number {
  return (a, b) => {
    switch (sortBy) {
      case 'price_asc':
        return (
          cmpNullable(a.minPrice, b.minPrice, 1) ||
          cmpStr(a.localStartDate, b.localStartDate) ||
          cmpStr(a.id, b.id)
        );
      case 'price_desc':
        return (
          cmpNullable(a.minPrice, b.minPrice, -1) ||
          cmpStr(a.localStartDate, b.localStartDate) ||
          cmpStr(a.id, b.id)
        );
      case 'date_desc':
        return (
          cmpStr(b.localStartDate, a.localStartDate) ||
          cmpNullable(startsAtMs(a), startsAtMs(b), -1) ||
          cmpStr(a.id, b.id)
        );
      case 'title_asc':
        return (
          cmpStr(a.title, b.title) ||
          cmpStr(a.localStartDate, b.localStartDate) ||
          cmpStr(a.id, b.id)
        );
      default:
        return (
          cmpStr(a.localStartDate, b.localStartDate) ||
          cmpNullable(startsAtMs(a), startsAtMs(b), 1) ||
          cmpStr(a.id, b.id)
        );
    }
  };
}

export class SupabaseCatalogRepository implements ICatalogRepository {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? createAdminClient();
  }

  async getEventById(id: string): Promise<CanonicalEventDetail | null> {
    const { data: eventData, error: eventError } = await this.client
      .from('events')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (eventError) {
      throw new Error(`Failed to get event by ID: ${eventError.message}`);
    }
    if (!eventData) return null;

    const event = mapEventRow(eventData as EventRow);

    // Fetch venue
    let venue: Venue | null = null;
    if (event.venueId) {
      const { data: venueData } = await this.client
        .from('venues')
        .select('*')
        .eq('id', event.venueId)
        .maybeSingle();
      if (venueData) {
        venue = mapVenueRow(venueData as VenueRow);
      }
    }

    // Fetch artists
    const { data: artistLinks } = await this.client
      .from('event_artists')
      .select('*, artists(*, artist_external_ids(provider, external_id))')
      .eq('event_id', id)
      .order('sort_order', { ascending: true });

    interface EventArtistDetailRow extends EventArtistRow {
      artists?:
        | (ArtistRow & {
            artist_external_ids?: Array<{
              provider: string;
              external_id: string;
            }> | null;
          })
        | null;
    }

    const artists = (
      (artistLinks as unknown as EventArtistDetailRow[]) || []
    ).map((row) => ({
      id: row.artist_id,
      name: row.artists?.name ?? 'Unknown Artist',
      billingPosition: row.billing_position,
      spotifyArtistId:
        row.artists?.artist_external_ids?.find(
          (ext) => ext.provider === 'spotify',
        )?.external_id ?? null,
      imageUrl: row.artists?.image_url ?? null,
    }));

    // Fetch ticket links
    const { data: ticketLinksData } = await this.client
      .from('event_ticket_links')
      .select('*')
      .eq('event_id', id);

    const ticketLinks = ((ticketLinksData as EventTicketLinkRow[]) || []).map(
      mapTicketLinkRow,
    );

    // Fetch promoters
    const { data: promoterLinks } = await this.client
      .from('event_promoters')
      .select('*, promoters(*)')
      .eq('event_id', id);

    const promoters = (
      (promoterLinks as unknown as EventPromoterRow[]) || []
    ).map((row) => ({
      id: row.promoter_id,
      name: row.promoters?.name ?? 'Unknown Promoter',
      relationshipType: row.relationship_type,
    }));

    // Fetch sources
    const { data: sourcesData } = await this.client
      .from('event_sources')
      .select('*')
      .eq('event_id', id);

    const sources = ((sourcesData as EventSourceRow[]) || []).map((row) => ({
      sourceId: row.source_id,
      sourceUrl: row.source_url,
      confidence: Number(row.confidence),
    }));

    // Fetch field evidence
    const { data: evidenceData } = await this.client
      .from('event_field_evidence')
      .select('*')
      .eq('event_id', id);

    const fieldEvidence = ((evidenceData as EventFieldEvidenceRow[]) || []).map(
      mapFieldEvidenceRow,
    );

    return {
      ...event,
      artists: cleanLineupForDisplay(artists, event.name),
      venue: venue
        ? {
            id: venue.id,
            name: venue.name,
            normalizedName: venue.normalizedName,
            city: venue.city,
            region: venue.region,
            imageUrl: venue.imageUrl ?? null,
            lat: venue.lat ?? null,
            lng: venue.lng ?? null,
            website: venue.website ?? null,
          }
        : null,
      ticketLinks,
      promoters,
      sources,
      fieldEvidence,
    };
  }

  async listEvents(
    filters?: EventListFilters,
    opts?: SearchOpts,
  ): Promise<CanonicalEventSummary[]> {
    if (filters?.searchQuery?.trim() && opts?.searchOr === undefined) {
      const groups = await this.resolveSearchGroups(
        filters.searchQuery,
        SupabaseCatalogRepository.collapsesFestivalDays(filters),
      );
      if (groups.length === 1) {
        return this.listEvents(filters, { searchOr: groups[0] });
      }
      return this.listEventsAcrossSearchGroups(filters, groups);
    }
    // If a large number of artist IDs is supplied, chunk into batches of 50 to avoid oversized request URIs
    const CHUNK_SIZE = 50;
    if (filters?.artistIds && filters.artistIds.length > CHUNK_SIZE) {
      const chunks: string[][] = [];
      for (let i = 0; i < filters.artistIds.length; i += CHUNK_SIZE) {
        chunks.push(filters.artistIds.slice(i, i + CHUNK_SIZE));
      }

      const globalOffset = filters.offset ?? 0;
      const globalLimit = filters.limit;
      // Fetch up to (globalOffset + globalLimit) from each chunk so globally sorted top records are available
      const chunkFetchLimit =
        globalLimit !== undefined ? globalOffset + globalLimit : undefined;

      const chunkPromises = chunks.map((chunk) =>
        this.listEvents(
          {
            ...filters,
            artistIds: chunk,
            offset: undefined,
            limit: chunkFetchLimit,
          },
          opts,
        ),
      );
      const chunkResults = await Promise.all(chunkPromises);
      const mergedMap = new Map<string, CanonicalEventSummary>();
      for (const res of chunkResults) {
        for (const ev of res) {
          if (!mergedMap.has(ev.id)) {
            mergedMap.set(ev.id, ev);
          }
        }
      }
      const allMerged = Array.from(mergedMap.values());
      if (filters?.sortBy === 'price_asc') {
        allMerged.sort(
          (a, b) =>
            (a.minPrice ?? Infinity) - (b.minPrice ?? Infinity) ||
            a.localStartDate.localeCompare(b.localStartDate) ||
            a.id.localeCompare(b.id),
        );
      } else {
        allMerged.sort(
          (a, b) =>
            a.localStartDate.localeCompare(b.localStartDate) ||
            a.id.localeCompare(b.id),
        );
      }
      const limit = globalLimit !== undefined ? globalLimit : allMerged.length;
      return allMerged.slice(globalOffset, globalOffset + limit);
    }

    let selectString = '*, venues(*)';
    if (
      (filters?.artistIds && filters.artistIds.length > 0) ||
      filters?.artistId
    ) {
      selectString = '*, venues(*), event_artists!inner(artist_id)';
    }

    let query = this.client.from('events').select(selectString);

    const filtered = await this.applyEventFilters(query, filters, opts);
    if (filtered === null) return [];
    query = filtered.query;

    // Database-level sorting BEFORE pagination
    query = this.applyEventSort(query, filters?.sortBy ?? 'date_asc');

    if (filters?.offset !== undefined && filters.offset > 0) {
      const limit = filters.limit ?? 20;
      query = query.range(filters.offset, filters.offset + limit - 1);
    } else if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data: eventsData, error } = await query;
    if (error) {
      throw new Error(`Failed to list events: ${error.message}`);
    }

    const rawRows = eventsData || [];
    if (rawRows.length === 0) {
      return [];
    }

    // Artist-filtered lists do not hide festival days in SQL (the favourite may play day 2), so a
    // matched later day is shown as its festival's single card instead.
    const rows =
      filters?.collapseFestivalDays &&
      !SupabaseCatalogRepository.collapsesFestivalDays(filters)
        ? await this.swapToFestivalPrimaries(
            rawRows as unknown as Array<{
              id: string;
              festival_group_id?: string | null;
              festival_group_primary?: boolean | null;
            }>,
          )
        : rawRows;

    return this.hydrateEventRows(rows, {
      mergeFestivalLineup: Boolean(filters?.collapseFestivalDays),
    });
  }

  /** Replaces rows that are a non-first festival day with their group's primary row (deduped). */
  private async swapToFestivalPrimaries<
    T extends {
      id: string;
      festival_group_id?: string | null;
      festival_group_primary?: boolean | null;
    },
  >(rows: T[]): Promise<T[]> {
    const primaryIds = [
      ...new Set(
        rows
          .filter(
            (r) => r.festival_group_primary === false && r.festival_group_id,
          )
          .map((r) => r.festival_group_id as string),
      ),
    ];
    if (primaryIds.length === 0) return rows;
    const primaries = new Map<string, T>();
    for (let i = 0; i < primaryIds.length; i += 50) {
      const { data, error } = await this.client
        .from('events')
        .select('*, venues(*)')
        .in('id', primaryIds.slice(i, i + 50));
      if (error) {
        throw new Error(`Failed to load festival primaries: ${error.message}`);
      }
      for (const p of (data ?? []) as unknown as T[]) primaries.set(p.id, p);
    }
    const seen = new Set<string>();
    const out: T[] = [];
    for (const r of rows) {
      const swapped =
        r.festival_group_primary === false && r.festival_group_id
          ? (primaries.get(r.festival_group_id) ?? r)
          : r;
      if (seen.has(swapped.id)) continue;
      seen.add(swapped.id);
      out.push(swapped);
    }
    return out;
  }

  /**
   * Applies every non-sort filter of listEvents to `query`. Returns null when the filters can
   * match nothing (venue name with no venue). Shared by listEvents and the light radius scan
   * so both always agree on the matching set.
   */
  /**
   * True when the one-card-per-festival collapse applies. It is skipped for artist-id filters:
   * "events featuring artist X" must return the day X actually plays, and a collapsed group's
   * non-primary days would otherwise be hidden (the favourite artist's festival would vanish).
   */
  private static collapsesFestivalDays(
    filters: EventListFilters | undefined,
  ): boolean {
    return (
      Boolean(filters?.collapseFestivalDays) &&
      !(filters?.artistIds && filters.artistIds.length > 0) &&
      !filters?.artistId
    );
  }

  private async applyEventFilters(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: any,
    filters: EventListFilters | undefined,
    opts: SearchOpts | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ query: any } | null> {
    // Filter by status if specified
    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status);
      } else {
        query = query.eq('status', filters.status);
      }
    }

    // Database-side relation join & filter:
    // Avoids unpaginated event_artists subqueries that truncate at PostgREST row limits.
    // Joins event_artists!inner in PostgreSQL, ensuring chronological ordering (local_start_date ASC)
    // and limits are evaluated inside PostgreSQL across all matching rows.
    if (filters?.artistIds && filters.artistIds.length > 0) {
      query = query.in('event_artists.artist_id', filters.artistIds);
    } else if (filters?.artistId) {
      query = query.eq('event_artists.artist_id', filters.artistId);
    }

    // Text search is resolved up-front into request-sized OR groups (see
    // resolveSearchGroups); each query only ever carries one bounded group.
    if (opts?.searchOr) {
      query = query.or(opts.searchOr);
    }

    const collapsing = SupabaseCatalogRepository.collapsesFestivalDays(filters);
    if (collapsing) {
      // One card per multi-day festival: hide every day but the group's first.
      query = query.eq('festival_group_primary', true);
    }

    // A collapsed festival card stays listed while the run is still going (its first day may
    // already be past), so "from today" also accepts a group that ends today or later.
    if (filters?.excludePastShowtimes && filters?.fromDate) {
      const today = filters.fromDate;
      const nowIso = filters.referenceNowIso || new Date().toISOString();
      query = query.or(
        [
          `local_start_date.gt.${today}`,
          `and(local_start_date.eq.${today},starts_at.gte.${nowIso})`,
          `and(local_start_date.eq.${today},starts_at.is.null)`,
          ...(collapsing ? [`festival_group_end_date.gte.${today}`] : []),
        ].join(','),
      );
    } else if (filters?.fromDate) {
      query = collapsing
        ? query.or(
            `local_start_date.gte.${filters.fromDate},festival_group_end_date.gte.${filters.fromDate}`,
          )
        : query.gte('local_start_date', filters.fromDate);
    }
    if (filters?.toDate) {
      query = query.lte('local_start_date', filters.toDate);
    }
    if (filters?.venueId) {
      const UUID_PATTERN =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (UUID_PATTERN.test(filters.venueId)) {
        query = query.eq('venue_id', filters.venueId);
      } else {
        const escaped = escapeLikePattern(filters.venueId.trim());
        const { data: vData, error: vErr } = await this.client
          .from('venues')
          .select('id')
          .ilike('name', `%${escaped}%`);
        if (vErr) {
          throw new Error(`Failed to query venues by name: ${vErr.message}`);
        }
        const vIds = (vData || []).map((v) => v.id);
        if (vIds.length === 0) {
          return null;
        }
        query = query.in('venue_id', vIds);
      }
    } else if (filters?.venueName) {
      const escaped = escapeLikePattern(filters.venueName.trim());
      const { data: vData, error: vErr } = await this.client
        .from('venues')
        .select('id')
        .ilike('name', `%${escaped}%`);
      if (vErr) {
        throw new Error(`Failed to query venues by name: ${vErr.message}`);
      }
      const vIds = (vData || []).map((v) => v.id);
      if (vIds.length === 0) {
        return null;
      }
      query = query.in('venue_id', vIds);
    }
    if (filters?.city) {
      query = query.ilike('city', `%${filters.city}%`);
    }
    if (filters?.region) {
      query = query.eq('region', filters.region);
    }
    if (filters?.genre) {
      const g = filters.genre.trim().toLowerCase();
      if (g === 'festival') {
        query = query.or(
          'event_kind.eq.festival,event_kind.eq.multi_day_festival,genre.ilike.festival,genres.cs.{festival}',
        );
      } else {
        query = query.or(buildGenreFilterClause(filters.genre));
      }
    }

    // Database-level price filtering BEFORE pagination
    if (filters?.freeOnly) {
      query = query.or('event_kind.eq.free_event,min_price.eq.0');
    }
    if (filters?.minPrice !== undefined) {
      query = query.gte('min_price', filters.minPrice);
    }
    if (filters?.maxPrice !== undefined) {
      const includeUnknown = filters.includeUnknownPrice ?? true;
      if (includeUnknown) {
        query = query.or(
          `min_price.is.null,min_price.lte.${filters.maxPrice},event_kind.eq.free_event`,
        );
      } else {
        query = query.or(
          `min_price.lte.${filters.maxPrice},event_kind.eq.free_event`,
        );
      }
    }

    // Wrapped: a PostgREST builder is thenable, so returning it bare from an async function
    // would execute the request.
    return { query };
  }

  /** Database ORDER BY chain for a sort option (id is always the final tiebreaker). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyEventSort(query: any, sortBy: EventSortOption): any {
    if (sortBy === 'price_asc') {
      query = query
        .order('min_price', { ascending: true, nullsFirst: false })
        .order('local_start_date', { ascending: true })
        .order('id', { ascending: true });
    } else if (sortBy === 'price_desc') {
      query = query
        .order('min_price', { ascending: false, nullsFirst: false })
        .order('local_start_date', { ascending: true })
        .order('id', { ascending: true });
    } else if (sortBy === 'date_desc') {
      query = query
        .order('local_start_date', { ascending: false })
        .order('starts_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: true });
    } else if (sortBy === 'title_asc') {
      query = query
        .order('name', { ascending: true })
        .order('local_start_date', { ascending: true })
        .order('id', { ascending: true });
    } else {
      // date_asc (default)
      query = query
        .order('local_start_date', { ascending: true })
        .order('starts_at', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });
    }

    return query;
  }

  /** Hydrates event rows (artists, ticket links, sources) into summaries, preserving row order. */
  private async hydrateEventRows(
    rawRows: unknown[],
    opts?: { mergeFestivalLineup?: boolean },
  ): Promise<CanonicalEventSummary[]> {
    // Deduplicate event rows by ID in case multi-artist matches returned duplicate rows
    const seenEventIds = new Set<string>();
    const rows: EventRow[] = [];
    for (const r of rawRows) {
      const row = r as unknown as EventRow;
      if (!seenEventIds.has(row.id)) {
        seenEventIds.add(row.id);
        rows.push(row);
      }
    }

    const eventIds = rows.map((r) => r.id);
    if (eventIds.length === 0) {
      return [];
    }

    // Chunk eventIds in batches of 25 to prevent PostgREST URI buffer overflow (HTTP 414 URI Too Long)
    const BATCH_CHUNK_SIZE = 25;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allArtistLinks: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allTicketLinks: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSourceLinks: any[] = [];

    for (let i = 0; i < eventIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = eventIds.slice(i, i + BATCH_CHUNK_SIZE);

      const [artistRes, ticketRes, sourceRes] = await Promise.all([
        this.client
          .from('event_artists')
          .select('*, artists(*, artist_external_ids(provider, external_id))')
          .in('event_id', chunk)
          .order('sort_order', { ascending: true }),
        this.client
          .from('event_ticket_links')
          .select('*')
          .in('event_id', chunk),
        this.client
          .from('event_sources')
          .select('event_id, source_id, source_url, is_current, sources(*)')
          .in('event_id', chunk)
          .eq('is_current', true),
      ]);

      if (artistRes.error) {
        throw new Error(
          `Failed to batch-fetch event artists: ${artistRes.error.message}`,
        );
      }
      if (ticketRes.error) {
        throw new Error(
          `Failed to batch-fetch event ticket links: ${ticketRes.error.message}`,
        );
      }
      if (sourceRes.error) {
        throw new Error(
          `Failed to batch-fetch event sources: ${sourceRes.error.message}`,
        );
      }

      if (artistRes.data) allArtistLinks.push(...artistRes.data);
      if (ticketRes.data) allTicketLinks.push(...ticketRes.data);
      if (sourceRes.data) allSourceLinks.push(...sourceRes.data);
    }

    if (opts?.mergeFestivalLineup) {
      // A collapsed festival card stands for the whole run: append the other days' artists so
      // the lineup (and artist scoring) is not limited to day one.
      const primaryIds = rows
        .filter(
          (r) =>
            r.festival_group_primary !== false &&
            (r.festival_group_size ?? 1) > 1,
        )
        .map((r) => r.id);
      for (let i = 0; i < primaryIds.length; i += BATCH_CHUNK_SIZE) {
        const chunk = primaryIds.slice(i, i + BATCH_CHUNK_SIZE);
        const { data: days, error: daysErr } = await this.client
          .from('events')
          .select('id, festival_group_id, local_start_date')
          .in('festival_group_id', chunk)
          .order('local_start_date', { ascending: true })
          .order('id', { ascending: true });
        if (daysErr) {
          throw new Error(
            `Failed to load festival days for lineup: ${daysErr.message}`,
          );
        }
        const otherDays = (
          (days ?? []) as Array<{ id: string; festival_group_id: string }>
        ).filter((d) => d.id !== d.festival_group_id);
        const primaryOf = new Map(
          otherDays.map((d) => [d.id, d.festival_group_id] as const),
        );
        for (let j = 0; j < otherDays.length; j += BATCH_CHUNK_SIZE) {
          const dayChunk = otherDays.slice(j, j + BATCH_CHUNK_SIZE);
          const { data: links, error: linkErr } = await this.client
            .from('event_artists')
            .select('*, artists(*, artist_external_ids(provider, external_id))')
            .in(
              'event_id',
              dayChunk.map((d) => d.id),
            )
            .order('sort_order', { ascending: true });
          if (linkErr) {
            throw new Error(
              `Failed to load festival day artists: ${linkErr.message}`,
            );
          }
          const byDay = new Map<string, unknown[]>();
          for (const l of (links ?? []) as Array<{ event_id: string }>) {
            const list = byDay.get(l.event_id) ?? [];
            list.push(l);
            byDay.set(l.event_id, list);
          }
          // Keep day order (otherDays is date-ordered), then billing order within each day.
          for (const d of dayChunk) {
            for (const l of byDay.get(d.id) ?? []) {
              allArtistLinks.push({
                ...(l as object),
                event_id: primaryOf.get(d.id),
              });
            }
          }
        }
      }
    }

    // Group relations in-memory by event_id
    interface EventArtistWithExtIds extends Omit<EventArtistRow, 'artists'> {
      artists?:
        | (ArtistRow & {
            artist_external_ids?: Array<{
              provider: string;
              external_id: string;
            }>;
          })
        | null;
    }

    const artistsByEventId = new Map<
      string,
      Array<{
        id?: string;
        name: string;
        billingPosition: BillingPosition;
        spotifyArtistId?: string | null;
        imageUrl?: string | null;
        genres?: string[];
      }>
    >();
    for (const aRow of (allArtistLinks as unknown as EventArtistWithExtIds[]) ||
      []) {
      const list = artistsByEventId.get(aRow.event_id) || [];
      // Merged festival lineups can list the same artist on several days.
      if (list.some((a) => a.id === aRow.artist_id)) continue;
      const spotifyArtistId =
        aRow.artists?.artist_external_ids?.find(
          (ext) => ext.provider === 'spotify',
        )?.external_id ?? null;

      list.push({
        id: aRow.artist_id,
        name: aRow.artists?.name ?? 'Unknown Artist',
        billingPosition: aRow.billing_position as BillingPosition,
        spotifyArtistId,
        imageUrl: aRow.artists?.image_url ?? null,
        genres: normalizeGenreList(aRow.artists?.genres),
      });
      artistsByEventId.set(aRow.event_id, list);
    }

    const ticketLinksByEventId = new Map<string, EventTicketLink[]>();
    for (const tRow of (allTicketLinks as EventTicketLinkRow[]) || []) {
      const list = ticketLinksByEventId.get(tRow.event_id) || [];
      list.push(mapTicketLinkRow(tRow));
      ticketLinksByEventId.set(tRow.event_id, list);
    }

    interface EventSourceJoinRow extends EventSourceRow {
      sources?: {
        id: string;
        name: string;
        slug: string;
      } | null;
    }

    const sourcesByEventId = new Map<string, CanonicalEventSourceSummary[]>();
    for (const sRow of (allSourceLinks as unknown as EventSourceJoinRow[]) ||
      []) {
      const list = sourcesByEventId.get(sRow.event_id) || [];
      list.push({
        id: sRow.source_id,
        name: sRow.sources?.name ?? 'Unknown Source',
        slug: sRow.sources?.slug ?? 'unknown-source',
        sourceUrl: sRow.source_url,
      });
      sourcesByEventId.set(sRow.event_id, list);
    }

    const summaries: CanonicalEventSummary[] = [];

    for (const row of rows) {
      const event = mapEventRow(row as EventRow);
      const venueRow = (row as { venues?: VenueRow | null }).venues;
      const venue = venueRow ? mapVenueRow(venueRow) : null;

      const artists = artistsByEventId.get(event.id) || [];
      const ticketLinks = ticketLinksByEventId.get(event.id) || [];
      const sources = sourcesByEventId.get(event.id) || [];

      let minPrice = ticketLinks.reduce<number | null>((min, tl) => {
        if (tl.minPrice === null || tl.minPrice === undefined) return min;
        return min === null ? tl.minPrice : Math.min(min, tl.minPrice);
      }, null);

      if (minPrice === null && event.eventKind === 'free_event') {
        minPrice = 0;
      }

      const maxPrice = ticketLinks.reduce<number | null>((max, tl) => {
        if (tl.maxPrice === null || tl.maxPrice === undefined) return max;
        return max === null ? tl.maxPrice : Math.max(max, tl.maxPrice);
      }, null);

      const currency = ticketLinks.find((tl) => tl.currency)?.currency ?? null;

      let inventoryStatus: TicketInventoryStatus = 'unknown';
      if (ticketLinks.length > 0) {
        const statuses = ticketLinks.map((tl) => tl.inventoryStatus);
        if (statuses.every((s) => s === 'sold_out')) {
          inventoryStatus = 'sold_out';
        } else if (statuses.some((s) => s === 'low_inventory')) {
          inventoryStatus = 'low_inventory';
        } else if (statuses.some((s) => s === 'available')) {
          inventoryStatus = 'available';
        } else if (statuses.some((s) => s === 'cancelled')) {
          inventoryStatus = 'cancelled';
        }
      } else if (event.status === 'cancelled') {
        inventoryStatus = 'cancelled';
      }

      summaries.push({
        id: event.id,
        title: event.name,
        venueName: venue?.name ?? 'Venue TBA',
        venueId: event.venueId,
        venue,
        city: venue?.city ?? event.city ?? undefined,
        region: venue?.region ?? event.region ?? undefined,
        lat: venue?.lat ?? event.lat ?? null,
        lng: venue?.lng ?? event.lng ?? null,
        localStartDate: event.localStartDate,
        startsAt: event.startsAt,
        timezone: event.timezone,
        startTimePrecision: event.startTimePrecision,
        status: event.status,
        eventKind: event.eventKind,
        artists: cleanLineupForDisplay(artists, event.name),
        ticketUrl: event.primaryTicketUrl,
        officialUrl: event.officialUrl ?? null,
        minPrice,
        maxPrice,
        currency,
        sourceName: sources.length > 0 ? sources[0].name : undefined,
        sources,
        ticketLinks,
        inventoryStatus,
        genre:
          event.genre ??
          (event.eventKind === 'festival' ||
          event.eventKind === 'multi_day_festival'
            ? 'Festival'
            : null),
        genres: event.genres ?? [],
        genresSource: event.genresSource ?? null,
        festivalGroupEndDate: event.festivalGroupEndDate ?? null,
        imageUrl: event.imageUrl ?? null,
      });
    }

    return summaries;
  }

  /**
   * Resolve a free-text query into one or more PostgREST `or=` filter strings.
   *
   * Short queries ("a") match hundreds of artists/venues/events. Putting every
   * matched id into one URL used to fail with "URI too long" (HTTP 500 on
   * /api/catalog/search). Each returned group is bounded to SEARCH_IDS_PER_GROUP
   * ids so a single request stays well below URL limits. A match is the UNION of
   * all groups; callers must dedupe across groups.
   */
  private async resolveSearchGroups(
    searchQuery: string,
    collapseFestivalDays = false,
  ): Promise<string[]> {
    const escaped = escapeLikePattern(searchQuery.trim());
    const quotedEscaped = escaped.replace(/"/g, '""');
    // Genre-aware search: "hip hop", "hiphop", "rap" etc. also match events by genre column.
    const genreLabel = resolveGenreQuery(searchQuery);
    const genreTerms = genreDbTerms(genreLabel).map((t) => {
      const e = escapeLikePattern(t).replace(/"/g, '""');
      return `genre.ilike."%${e}%"`;
    });
    const nameClause = [`name.ilike."%${quotedEscaped}%"`, ...genreTerms].join(
      ',',
    );

    const pageAll = async (table: 'venues' | 'artists'): Promise<string[]> => {
      const ids: string[] = [];
      for (let from = 0; ; from += ID_PAGE_SIZE) {
        const { data, error } = await this.client
          .from(table)
          .select('id')
          .ilike('name', `%${escaped}%`)
          .order('id', { ascending: true })
          .range(from, from + ID_PAGE_SIZE - 1);
        if (error) {
          throw new Error(
            `Failed to query ${table} for search: ${error.message}`,
          );
        }
        if (!data || data.length === 0) break;
        for (const row of data) ids.push(row.id);
        if (data.length < ID_PAGE_SIZE) break;
      }
      return ids;
    };

    const [venueIds, artistIds] = await Promise.all([
      pageAll('venues'),
      pageAll('artists'),
    ]);

    // Events that feature a matched artist (artist-id list is chunked too).
    const eventIdSet = new Set<string>();
    const artistChunks: string[][] = [];
    for (let i = 0; i < artistIds.length; i += SEARCH_IDS_PER_GROUP) {
      artistChunks.push(artistIds.slice(i, i + SEARCH_IDS_PER_GROUP));
    }
    await mapWithConcurrency(
      artistChunks,
      SEARCH_GROUP_CONCURRENCY,
      async (chunk) => {
        for (let from = 0; ; from += ID_PAGE_SIZE) {
          const { data, error } = await this.client
            .from('event_artists')
            .select('event_id')
            .in('artist_id', chunk)
            .order('event_id', { ascending: true })
            .range(from, from + ID_PAGE_SIZE - 1);
          if (error) {
            throw new Error(
              `Failed to query event_artists for search: ${error.message}`,
            );
          }
          if (!data || data.length === 0) break;
          for (const ea of data) eventIdSet.add(ea.event_id);
          if (data.length < ID_PAGE_SIZE) break;
        }
      },
    );

    if (collapseFestivalDays && eventIdSet.size > 0) {
      // Collapsed lists only show a festival's first day, so an artist who plays a later day
      // must surface that group's primary card (days of one group share festival_group_id =
      // primary id). The primary still has to satisfy every other filter.
      const matchedIds = Array.from(eventIdSet);
      const chunks: string[][] = [];
      for (let i = 0; i < matchedIds.length; i += SEARCH_IDS_PER_GROUP) {
        chunks.push(matchedIds.slice(i, i + SEARCH_IDS_PER_GROUP));
      }
      await mapWithConcurrency(
        chunks,
        SEARCH_GROUP_CONCURRENCY,
        async (chunk) => {
          const { data, error } = await this.client
            .from('events')
            .select('festival_group_id')
            .in('id', chunk)
            .eq('festival_group_primary', false)
            .not('festival_group_id', 'is', null);
          if (error) {
            throw new Error(
              `Failed to resolve festival groups for search: ${error.message}`,
            );
          }
          for (const row of (data ?? []) as Array<{
            festival_group_id: string | null;
          }>) {
            if (row.festival_group_id) eventIdSet.add(row.festival_group_id);
          }
        },
      );
    }

    const refs: Array<{ col: 'venue_id' | 'id'; id: string }> = [
      ...venueIds.map((id) => ({ col: 'venue_id' as const, id })),
      ...Array.from(eventIdSet)
        .sort()
        .map((id) => ({ col: 'id' as const, id })),
    ];
    if (refs.length === 0) return [nameClause];

    const groups: string[] = [];
    for (let i = 0; i < refs.length; i += SEARCH_IDS_PER_GROUP) {
      const slice = refs.slice(i, i + SEARCH_IDS_PER_GROUP);
      const parts: string[] = i === 0 ? [nameClause] : [];
      for (const col of ['venue_id', 'id'] as const) {
        const ids = slice.filter((r) => r.col === col).map((r) => r.id);
        if (ids.length > 0) parts.push(`${col}.in.(${ids.join(',')})`);
      }
      groups.push(parts.join(','));
    }
    return groups;
  }

  /**
   * Multi-group search: run one bounded query per group (all other filters
   * applied), then merge, dedupe and re-apply the DB ordering in memory so
   * pagination stays deterministic. Each group is asked for its first
   * offset+limit rows, which is enough to build the global page.
   */
  private async listEventsAcrossSearchGroups(
    filters: EventListFilters,
    groups: string[],
  ): Promise<CanonicalEventSummary[]> {
    const offset = filters.offset ?? 0;
    const limit = filters.limit;
    const perGroupLimit = limit !== undefined ? offset + limit : undefined;
    const results = await mapWithConcurrency(
      groups,
      SEARCH_GROUP_CONCURRENCY,
      (g) =>
        this.listEvents(
          { ...filters, offset: undefined, limit: perGroupLimit },
          { searchOr: g },
        ),
    );
    const merged = new Map<string, CanonicalEventSummary>();
    for (const rows of results) {
      for (const ev of rows) if (!merged.has(ev.id)) merged.set(ev.id, ev);
    }
    const sorted = Array.from(merged.values()).sort(
      compareEventSummaries(filters.sortBy ?? 'date_asc'),
    );
    return sorted.slice(
      offset,
      limit !== undefined ? offset + limit : undefined,
    );
  }

  /**
   * LIGHT scan used by the exact radius search: ids + location of every event matching
   * `filters` (limit/offset ignored), in the order listEvents returns them. It selects only the
   * radius/sort columns (no artist, ticket or source hydration), pages in PostgREST's 1000-row
   * ranges and fetches the remaining ranges in parallel once the exact total is known.
   */
  async listEventLocations(
    filters?: EventListFilters,
    opts?: SearchOpts,
  ): Promise<EventLocationRow[]> {
    if (filters?.searchQuery?.trim() && opts?.searchOr === undefined) {
      const groups = await this.resolveSearchGroups(
        filters.searchQuery,
        SupabaseCatalogRepository.collapsesFestivalDays(filters),
      );
      if (groups.length === 1) {
        return this.listEventLocations(filters, { searchOr: groups[0] });
      }
      // Multi-group: each group is already in DB order; merge, dedupe and re-sort like
      // listEventsAcrossSearchGroups does.
      const results = await mapWithConcurrency(
        groups,
        SEARCH_GROUP_CONCURRENCY,
        (g) => this.fetchLightRows(filters, { searchOr: g }),
      );
      const merged = new Map<string, LightEventRow>();
      for (const rows of results) {
        for (const r of rows) if (!merged.has(r.id)) merged.set(r.id, r);
      }
      const asSummaries = Array.from(merged.values()).map(
        (r) =>
          ({
            id: r.id,
            title: r.name,
            localStartDate: r.local_start_date,
            startsAt: r.starts_at,
            minPrice: r.min_price == null ? null : Number(r.min_price),
          }) as unknown as CanonicalEventSummary,
      );
      const order = compareEventSummaries(filters.sortBy ?? 'date_asc');
      const byId = new Map(merged);
      return asSummaries
        .sort(order)
        .map((s) => lightRowToLocation(byId.get(s.id)!));
    }
    if (filters?.artistIds && filters.artistIds.length > 50) {
      // Rare chunked-artist path: reuse the full listing (no radius caller uses it).
      const full = await this.listEvents({
        ...filters,
        limit: undefined,
        offset: undefined,
      });
      return full.map((e) => ({
        id: e.id,
        city: e.city ?? null,
        region: e.region ?? null,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
      }));
    }
    return (await this.fetchLightRows(filters, opts)).map(lightRowToLocation);
  }

  private async fetchLightRows(
    filters: EventListFilters | undefined,
    opts: SearchOpts | undefined,
  ): Promise<LightEventRow[]> {
    const withArtists =
      (filters?.artistIds && filters.artistIds.length > 0) || filters?.artistId;
    const select =
      LIGHT_EVENT_SELECT +
      (withArtists ? ', event_artists!inner(artist_id)' : '');
    const sortBy = filters?.sortBy ?? 'date_asc';
    const fetchRange = async (
      page: number,
      withCount: boolean,
    ): Promise<{ rows: LightEventRow[]; count: number | null } | null> => {
      let query = this.client
        .from('events')
        .select(select, withCount ? { count: 'exact' } : undefined);
      const filtered = await this.applyEventFilters(query, filters, opts);
      if (filtered === null) return null;
      query = this.applyEventSort(filtered.query, sortBy).range(
        page * ID_PAGE_SIZE,
        page * ID_PAGE_SIZE + ID_PAGE_SIZE - 1,
      );
      const { data, error, count } = await query;
      if (error) {
        throw new Error(`Failed to scan event locations: ${error.message}`);
      }
      return {
        rows: (data ?? []) as unknown as LightEventRow[],
        count: count ?? null,
      };
    };

    const first = await fetchRange(0, true);
    if (first === null) return [];
    const pages: LightEventRow[][] = [first.rows];
    if (first.count !== null) {
      const totalPages = Math.ceil(first.count / ID_PAGE_SIZE);
      const rest = await mapWithConcurrency(
        Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 1),
        LIGHT_SCAN_CONCURRENCY,
        async (page) => (await fetchRange(page, false))?.rows ?? [],
      );
      pages.push(...rest);
    } else {
      for (
        let page = 1;
        pages[pages.length - 1].length === ID_PAGE_SIZE;
        page++
      ) {
        pages.push((await fetchRange(page, false))?.rows ?? []);
      }
    }
    // Same dedupe as listEvents (multi-artist joins can repeat an event row).
    const seen = new Set<string>();
    const out: LightEventRow[] = [];
    for (const rows of pages) {
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
    return out;
  }

  /** Hydrates the given events with the same mapping as listEvents; result follows `ids` order. */
  async getEventsByIds(ids: string[]): Promise<CanonicalEventSummary[]> {
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    const CHUNK = 50;
    const rows: unknown[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const { data, error } = await this.client
        .from('events')
        .select('*, venues(*)')
        .in('id', unique.slice(i, i + CHUNK));
      if (error) {
        throw new Error(`Failed to load events by id: ${error.message}`);
      }
      rows.push(...(data ?? []));
    }
    const byId = new Map(
      (rows as Array<{ id: string }>).map((r) => [r.id, r] as const),
    );
    const ordered = unique.flatMap((id) => {
      const r = byId.get(id);
      return r ? [r] : [];
    });
    return this.hydrateEventRows(ordered);
  }

  async countEvents(
    filters?: EventListFilters,
    opts?: SearchOpts & { idPage?: number; out?: string[] },
  ): Promise<number> {
    if (filters?.searchQuery?.trim() && opts?.searchOr === undefined) {
      const groups = await this.resolveSearchGroups(
        filters.searchQuery,
        SupabaseCatalogRepository.collapsesFestivalDays(filters),
      );
      if (groups.length === 1) {
        return this.countEvents(filters, { searchOr: groups[0] });
      }
      // Groups can overlap (an event may match by title AND artist), so the
      // exact count is the number of DISTINCT ids across all groups.
      const seen = new Set<string>();
      await mapWithConcurrency(groups, SEARCH_GROUP_CONCURRENCY, async (g) => {
        for (let page = 0; ; page++) {
          const out: string[] = [];
          await this.countEvents(filters, {
            searchOr: g,
            idPage: page,
            out,
          });
          for (const id of out) seen.add(id);
          if (out.length < ID_PAGE_SIZE) break;
        }
      });
      return seen.size;
    }
    const idMode = opts?.idPage !== undefined;
    const CHUNK_SIZE = 50;
    if (filters?.artistIds && filters.artistIds.length > CHUNK_SIZE) {
      const chunks: string[][] = [];
      for (let i = 0; i < filters.artistIds.length; i += CHUNK_SIZE) {
        chunks.push(filters.artistIds.slice(i, i + CHUNK_SIZE));
      }
      const chunkPromises = chunks.map((chunk) =>
        this.listEvents({
          ...filters,
          artistIds: chunk,
          offset: undefined,
          limit: undefined,
        }),
      );
      const chunkResults = await Promise.all(chunkPromises);
      const seen = new Set<string>();
      for (const res of chunkResults) {
        for (const ev of res) {
          seen.add(ev.id);
        }
      }
      return seen.size;
    }

    let selectString = 'id';
    if (
      (filters?.artistIds && filters.artistIds.length > 0) ||
      filters?.artistId
    ) {
      selectString = 'id, event_artists!inner(artist_id)';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = idMode
      ? this.client.from('events').select(selectString)
      : this.client
          .from('events')
          .select(selectString, { count: 'exact', head: true });

    const filtered = await this.applyEventFilters(query, filters, opts);
    if (filtered === null) return 0;
    query = filtered.query;

    if (idMode) {
      const page = opts?.idPage ?? 0;
      const { data: idRows, error: idErr } = await query
        .order('id', { ascending: true })
        .range(page * ID_PAGE_SIZE, page * ID_PAGE_SIZE + ID_PAGE_SIZE - 1);
      if (idErr) {
        throw new Error(`Failed to count events: ${idErr.message}`);
      }
      for (const r of (idRows ?? []) as Array<{ id: string }>) {
        opts?.out?.push(r.id);
      }
      return opts?.out?.length ?? 0;
    }

    const { count, error } = await query;
    if (error) {
      throw new Error(`Failed to count events: ${error.message}`);
    }

    return count ?? 0;
  }

  async listCities(): Promise<string[]> {
    const citySet = new Set<string>();
    const pageSize = 1000;
    let offset = 0;

    // Paginate through scheduled events in batches to avoid PostgREST 1000-row limit truncation (Issue 6)
    while (true) {
      const { data, error } = await this.client
        .from('events')
        .select('city, venues(city)')
        .eq('status', 'scheduled')
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Failed to list cities: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const r of (data as unknown as Array<{
        city?: string | null;
        venues?: { city?: string | null } | null;
      }>) || []) {
        const c = r.venues?.city ?? r.city;
        if (c && c.trim().length > 0) {
          citySet.add(c.trim());
        }
      }

      if (data.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return Array.from(citySet).sort();
  }

  async getFacets(): Promise<{
    venues: Array<{ id: string; name: string; city?: string }>;
    cities: string[];
    genres: string[];
  }> {
    const [venuesRes, citiesList, genresRes] = await Promise.all([
      this.client
        .from('venues')
        .select('id, name, city')
        .order('name', { ascending: true }),
      this.listCities().catch(() => []),
      this.client.from('events').select('genre').not('genre', 'is', null),
    ]);

    const venues = (venuesRes.data || []).map((v) => ({
      id: v.id,
      name: v.name,
      city: v.city ?? undefined,
    }));

    // One shared vocabulary: non-genres ("Live Music", rodeo, ...) are dropped, raw source strings
    // collapse to canonical labels so filters, badges and search agree.
    const genres = normalizeGenreFacets(
      ((genresRes.data ?? []) as Array<{ genre?: string | null }>).map(
        (row) => row.genre,
      ),
    );

    return {
      venues,
      cities: citiesList.sort((a, b) => a.localeCompare(b)),
      genres,
    };
  }

  async getArtistById(id: string): Promise<Artist | null> {
    const { data, error } = await this.client
      .from('artists')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get artist by ID: ${error.message}`);
    }

    return data ? mapArtistRow(data as ArtistRow) : null;
  }

  async searchArtists(query: string, limit = 10): Promise<Artist[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const safeLimit = Math.min(Math.max(1, limit), 1000);
    const escaped = escapeLikePattern(trimmed);

    const { data, error } = await this.client
      .from('artists')
      .select('*')
      .ilike('name', `%${escaped}%`)
      .order('name', { ascending: true })
      .limit(safeLimit);

    if (error) {
      throw new Error(`Failed to search artists: ${error.message}`);
    }

    return ((data as ArtistRow[]) || []).map(mapArtistRow);
  }

  async findArtistByName(normalizedName: string): Promise<Artist | null> {
    const { data, error } = await this.client
      .from('artists')
      .select('*')
      .eq('normalized_name', normalizedName)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find artist by normalized name: ${error.message}`,
      );
    }
    return data ? mapArtistRow(data as ArtistRow) : null;
  }

  async findArtistsByName(normalizedName: string): Promise<Artist[]> {
    const { data, error } = await this.client
      .from('artists')
      .select('*')
      .eq('normalized_name', normalizedName);

    if (error) {
      throw new Error(
        `Failed to find artists by normalized name: ${error.message}`,
      );
    }
    return ((data as ArtistRow[]) || []).map(mapArtistRow);
  }

  async findArtistByExternalId(
    provider: string,
    externalId: string,
  ): Promise<Artist | null> {
    const { data, error } = await this.client
      .from('artist_external_ids')
      .select('artist_id, artists(*)')
      .eq('provider', provider)
      .eq('external_id', externalId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find artist by external ID: ${error.message}`);
    }
    if (!data || !data.artists) return null;
    return mapArtistRow(data.artists as unknown as ArtistRow);
  }

  async getArtistsByIds(ids: string[]): Promise<Artist[]> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return [];
    const { data, error } = await this.client
      .from('artists')
      .select('*')
      .in('id', unique);
    if (error) {
      throw new Error(`Failed to load artists by id: ${error.message}`);
    }
    return (data ?? []).map((row) => mapArtistRow(row as ArtistRow));
  }

  async listFestivalDays(eventId: string): Promise<FestivalDay[]> {
    const { data: self, error: selfErr } = await this.client
      .from('events')
      .select('festival_group_id')
      .eq('id', eventId)
      .maybeSingle();
    if (selfErr) {
      throw new Error(`Failed to load festival group: ${selfErr.message}`);
    }
    const groupId = (self as { festival_group_id?: string | null } | null)
      ?.festival_group_id;
    if (!groupId) return [];
    const { data, error } = await this.client
      .from('events')
      .select('id, name, local_start_date')
      .eq('festival_group_id', groupId)
      .order('local_start_date', { ascending: true })
      .order('id', { ascending: true });
    if (error) {
      throw new Error(`Failed to list festival days: ${error.message}`);
    }
    return (
      (data ?? []) as Array<{
        id: string;
        name: string;
        local_start_date: string;
      }>
    ).map((r) => ({
      id: r.id,
      name: r.name,
      localStartDate: r.local_start_date,
    }));
  }

  /** Recomputes festival day groups (presentation only); returns the number of grouped events. */
  async refreshFestivalGroups(): Promise<number> {
    const { data, error } = await this.client.rpc('refresh_festival_groups');
    if (error) {
      throw new Error(`Failed to refresh festival groups: ${error.message}`);
    }
    return typeof data === 'number' ? data : 0;
  }

  async fillVenueCoordinatesForEvent(
    eventId: string,
    lat: number,
    lng: number,
  ): Promise<boolean> {
    if (!isValidCoordinatePair(lat, lng)) return false;
    const { data: ev, error: evErr } = await this.client
      .from('events')
      .select('venue_id')
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) {
      throw new Error(`Failed to load event venue: ${evErr.message}`);
    }
    const venueId = (ev as { venue_id?: string | null } | null)?.venue_id;
    if (!venueId) return false;
    // Fill-if-empty: venues that already have coordinates are never changed.
    const { data, error } = await this.client
      .from('venues')
      .update({ lat, lng, updated_at: new Date().toISOString() })
      .eq('id', venueId)
      .is('lat', null)
      .is('lng', null)
      .select('id');
    if (error) {
      throw new Error(`Failed to store venue coordinates: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }

  async fillEventGenres(
    eventId: string,
    genres: string[],
    source: string,
  ): Promise<boolean> {
    const clean = Array.from(
      new Set(genres.map((g) => g?.trim()).filter((g): g is string => !!g)),
    );
    if (clean.length === 0) return false;
    // Fill-if-empty: only events with NO genre of any kind are written, so source-supplied
    // genres are never overwritten. The origin is recorded in genres_source.
    const { data, error } = await this.client
      .from('events')
      .update({
        genre: clean[0],
        genres: clean,
        genres_source: source,
        updated_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .filter('genres', 'eq', '{}')
      .is('genre', null)
      .select('id');
    if (error) {
      throw new Error(`Failed to store event genres: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }

  async fillArtistGenres(
    artistId: string,
    genres: string[],
    source: string,
  ): Promise<boolean> {
    const clean = Array.from(
      new Set(genres.map((g) => g?.trim()).filter((g): g is string => !!g)),
    );
    if (clean.length === 0) return false;
    // Only rows with no genres yet are written (fill-if-empty); provenance is recorded.
    const { data, error } = await this.client
      .from('artists')
      .update({
        genres: clean,
        genres_source: source,
        genres_updated_at: new Date().toISOString(),
      })
      .eq('id', artistId)
      .filter('genres', 'eq', '{}')
      .select('id');
    if (error) {
      throw new Error(`Failed to store artist genres: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }

  async findArtistIdsByExternalIds(
    provider: string,
    externalIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!externalIds || externalIds.length === 0) return result;

    const { data, error } = await this.client
      .from('artist_external_ids')
      .select('artist_id, external_id')
      .eq('provider', provider)
      .in('external_id', externalIds);

    if (error) {
      throw new Error(
        `Failed to find artist IDs by external IDs: ${error.message}`,
      );
    }

    for (const row of (data as Array<{
      artist_id: string;
      external_id: string;
    }>) || []) {
      result.set(row.external_id, row.artist_id);
    }
    return result;
  }

  async findArtistExternalIds(artistId: string): Promise<ArtistExternalId[]> {
    const { data, error } = await this.client
      .from('artist_external_ids')
      .select('*')
      .eq('artist_id', artistId);

    if (error) {
      throw new Error(`Failed to find artist external IDs: ${error.message}`);
    }
    return (
      (data as Array<{
        id: string;
        artist_id: string;
        provider: string;
        external_id: string;
        provider_url: string | null;
        created_at: string;
      }>) || []
    ).map((row) => ({
      id: row.id,
      artistId: row.artist_id,
      provider: row.provider,
      externalId: row.external_id,
      providerUrl: row.provider_url,
      createdAt: row.created_at,
    }));
  }

  async findVenueByNameAndCity(
    normalizedName: string,
    city: string,
  ): Promise<Venue | null> {
    const { data, error } = await this.client
      .from('venues')
      .select('*')
      .eq('normalized_name', normalizedName)
      .ilike('city', city.trim())
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find venue by name and city: ${error.message}`,
      );
    }
    return data ? mapVenueRow(data as VenueRow) : null;
  }

  async findVenue(
    normalizedName: string,
    city: string,
    region?: string | null,
    countryCode?: string | null,
  ): Promise<Venue | null> {
    let query = this.client
      .from('venues')
      .select('*')
      .eq('normalized_name', normalizedName)
      .ilike('city', city.trim());

    if (region) {
      query = query.ilike('region', region.trim());
    }
    if (countryCode) {
      query = query.ilike('country_code', countryCode.trim());
    }

    const { data, error } = await query
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to find venue: ${error.message}`);
    }
    return data ? mapVenueRow(data as VenueRow) : null;
  }

  async findEventsOnDateAtVenue(
    localStartDate: string,
    venueId: string,
  ): Promise<Event[]> {
    const { data, error } = await this.client
      .from('events')
      .select('*')
      .eq('local_start_date', localStartDate)
      .eq('venue_id', venueId);

    if (error) {
      throw new Error(
        `Failed to find events on date at venue: ${error.message}`,
      );
    }
    return ((data as EventRow[]) || []).map(mapEventRow);
  }

  async findEventByTicketUrl(
    normalizedTicketUrl: string,
  ): Promise<Event | null> {
    // Finding 7: Matches by normalized_url
    const { data: ticketLink, error } = await this.client
      .from('event_ticket_links')
      .select('event_id')
      .eq('normalized_url', normalizedTicketUrl)
      .maybeSingle();

    if (error || !ticketLink) return null;

    const { data: eventData, error: eventError } = await this.client
      .from('events')
      .select('*')
      .eq('id', ticketLink.event_id)
      .maybeSingle();

    if (eventError || !eventData) return null;
    return mapEventRow(eventData as EventRow);
  }

  async findEventBySourceEventId(
    sourceId: string,
    sourceEventId: string,
  ): Promise<Event | null> {
    const { data, error } = await this.client
      .from('event_sources')
      .select('event_id')
      .eq('source_id', sourceId)
      .eq('source_event_id', sourceEventId)
      .maybeSingle();

    if (error || !data) return null;

    const { data: eventData, error: eventError } = await this.client
      .from('events')
      .select('*')
      .eq('id', data.event_id)
      .maybeSingle();

    if (eventError || !eventData) return null;
    return mapEventRow(eventData as EventRow);
  }

  async createArtist(artist: {
    name: string;
    normalizedName: string;
    imageUrl?: string | null;
  }): Promise<Artist> {
    const { data, error } = await this.client
      .from('artists')
      .insert({
        name: artist.name,
        normalized_name: artist.normalizedName,
        image_url: artist.imageUrl ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create artist: ${error.message}`);
    }
    return mapArtistRow(data as ArtistRow);
  }

  async addArtistExternalId(externalId: {
    artistId: string;
    provider: string;
    externalId: string;
    providerUrl?: string | null;
  }): Promise<ArtistExternalId> {
    const { data, error } = await this.client
      .from('artist_external_ids')
      .insert({
        artist_id: externalId.artistId,
        provider: externalId.provider,
        external_id: externalId.externalId,
        provider_url: externalId.providerUrl ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to add artist external ID: ${error.message}`);
    }
    return {
      id: data.id,
      artistId: data.artist_id,
      provider: data.provider,
      externalId: data.external_id,
      providerUrl: data.provider_url,
      createdAt: data.created_at,
    };
  }

  async createVenue(venue: {
    name: string;
    normalizedName: string;
    city: string;
    region?: string | null;
    countryCode?: string;
    lat?: number | null;
    lng?: number | null;
    timezone?: string | null;
    website?: string | null;
    capacity?: number | null;
  }): Promise<Venue> {
    const { data, error } = await this.client
      .from('venues')
      .insert({
        name: venue.name,
        normalized_name: venue.normalizedName,
        city: venue.city,
        region: venue.region ?? null,
        country_code: venue.countryCode ?? null,
        lat: venue.lat ?? null,
        lng: venue.lng ?? null,
        timezone: venue.timezone ?? null,
        website: venue.website ?? null,
        capacity: venue.capacity ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create venue: ${error.message}`);
    }
    return mapVenueRow(data as VenueRow);
  }

  async createPromoter(promoter: {
    name: string;
    normalizedName: string;
    website?: string | null;
    calendarUrl?: string | null;
  }): Promise<Promoter> {
    const { data, error } = await this.client
      .from('promoters')
      .insert({
        name: promoter.name,
        normalized_name: promoter.normalizedName,
        website: promoter.website ?? null,
        calendar_url: promoter.calendarUrl ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create promoter: ${error.message}`);
    }
    return mapPromoterRow(data as PromoterRow);
  }

  async createEvent(
    event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Event> {
    const { data, error } = await this.client
      .from('events')
      .insert({
        name: event.name,
        normalized_name: event.normalizedName,
        event_kind: event.eventKind,
        status: event.status,
        venue_id: event.venueId ?? null,
        city: event.city ?? null,
        region: event.region ?? null,
        country_code: event.countryCode ?? null,
        lat: event.lat ?? null,
        lng: event.lng ?? null,
        timezone: event.timezone,
        local_start_date: event.localStartDate,
        local_end_date: event.localEndDate ?? null,
        starts_at: event.startsAt ?? null,
        ends_at: event.endsAt ?? null,
        start_time_precision: event.startTimePrecision,
        doors_at: event.doorsAt ?? null,
        is_multi_day: event.isMultiDay,
        official_url: event.officialUrl ?? null,
        primary_ticket_url: event.primaryTicketUrl ?? null,
        announced_at: event.announcedAt ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create event: ${error.message}`);
    }
    return mapEventRow(data as EventRow);
  }

  async updateEvent(
    id: string,
    updates: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Event> {
    const updateRow: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (updates.name !== undefined) updateRow.name = updates.name;
    if (updates.normalizedName !== undefined)
      updateRow.normalized_name = updates.normalizedName;
    if (updates.eventKind !== undefined)
      updateRow.event_kind = updates.eventKind;
    if (updates.status !== undefined) updateRow.status = updates.status;
    if (updates.venueId !== undefined) updateRow.venue_id = updates.venueId;
    if (updates.city !== undefined) updateRow.city = updates.city;
    if (updates.region !== undefined) updateRow.region = updates.region;
    if (updates.countryCode !== undefined)
      updateRow.country_code = updates.countryCode;
    if (updates.lat !== undefined) updateRow.lat = updates.lat;
    if (updates.lng !== undefined) updateRow.lng = updates.lng;
    if (updates.timezone !== undefined) updateRow.timezone = updates.timezone;
    if (updates.localStartDate !== undefined)
      updateRow.local_start_date = updates.localStartDate;
    if (updates.localEndDate !== undefined)
      updateRow.local_end_date = updates.localEndDate;
    if (updates.startsAt !== undefined) updateRow.starts_at = updates.startsAt;
    if (updates.endsAt !== undefined) updateRow.ends_at = updates.endsAt;
    if (updates.startTimePrecision !== undefined)
      updateRow.start_time_precision = updates.startTimePrecision;
    if (updates.doorsAt !== undefined) updateRow.doors_at = updates.doorsAt;
    if (updates.isMultiDay !== undefined)
      updateRow.is_multi_day = updates.isMultiDay;
    if (updates.officialUrl !== undefined)
      updateRow.official_url = updates.officialUrl;
    if (updates.primaryTicketUrl !== undefined)
      updateRow.primary_ticket_url = updates.primaryTicketUrl;
    if (updates.announcedAt !== undefined)
      updateRow.announced_at = updates.announcedAt;

    const { data, error } = await this.client
      .from('events')
      .update(updateRow)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update event: ${error.message}`);
    }
    return mapEventRow(data as EventRow);
  }

  async linkEventArtist(
    eventId: string,
    artistId: string,
    billingPosition: BillingPosition = 'unknown',
    sortOrder = 0,
  ): Promise<EventArtist> {
    const { data, error } = await this.client
      .from('event_artists')
      .upsert({
        event_id: eventId,
        artist_id: artistId,
        billing_position: billingPosition,
        sort_order: sortOrder,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to link event artist: ${error.message}`);
    }
    return {
      id: data.id,
      eventId: data.event_id,
      artistId: data.artist_id,
      billingPosition: data.billing_position,
      sortOrder: data.sort_order,
      createdAt: data.created_at,
    };
  }

  async linkEventPromoter(
    eventId: string,
    promoterId: string,
    relationshipType: PromoterRelationshipType = 'promoter',
  ): Promise<EventPromoter> {
    const { data, error } = await this.client
      .from('event_promoters')
      .upsert({
        event_id: eventId,
        promoter_id: promoterId,
        relationship_type: relationshipType,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to link event promoter: ${error.message}`);
    }
    return {
      id: data.id,
      eventId: data.event_id,
      promoterId: data.promoter_id,
      relationshipType: data.relationship_type,
      createdAt: data.created_at,
    };
  }

  async linkTicketUrl(ticketLink: {
    eventId: string;
    ticketProviderSourceId?: string | null;
    url: string;
    normalizedUrl: string;
    minPrice?: number | null;
    maxPrice?: number | null;
    currency?: string | null;
    inventoryStatus?: EventTicketLink['inventoryStatus'];
    verifiedAt?: string | null;
  }): Promise<EventTicketLink> {
    const { data, error } = await this.client
      .from('event_ticket_links')
      .upsert({
        event_id: ticketLink.eventId,
        ticket_provider_source_id: ticketLink.ticketProviderSourceId ?? null,
        url: ticketLink.url,
        normalized_url:
          ticketLink.normalizedUrl || normalizeUrl(ticketLink.url),
        min_price: ticketLink.minPrice ?? null,
        max_price: ticketLink.maxPrice ?? null,
        currency: ticketLink.currency ?? null,
        inventory_status: ticketLink.inventoryStatus ?? 'unknown',
        verified_at: ticketLink.verifiedAt ?? null,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to link ticket URL: ${error.message}`);
    }
    return mapTicketLinkRow(data as EventTicketLinkRow);
  }

  async recordEventSource(sourceRecord: {
    eventId: string;
    sourceId: string;
    candidateId?: string | null;
    rawIngestId?: string | null;
    sourceEventId?: string | null;
    sourceUrl: string;
    confidence: number;
    sourceName?: string;
    sourceSlug?: string;
  }): Promise<EventSourceRecord> {
    const { data, error } = await this.client
      .from('event_sources')
      .upsert({
        event_id: sourceRecord.eventId,
        source_id: sourceRecord.sourceId,
        candidate_id: sourceRecord.candidateId ?? null,
        raw_ingest_id: sourceRecord.rawIngestId ?? null,
        source_event_id: sourceRecord.sourceEventId ?? null,
        source_url: sourceRecord.sourceUrl,
        confidence: sourceRecord.confidence,
        last_seen_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to record event source: ${error.message}`);
    }
    return mapSourceRecordRow(data as EventSourceRow);
  }

  async recordFieldEvidence(evidence: {
    eventId: string;
    fieldName: string;
    eventSourceId?: string;
    sourceId: string;
    rawIngestId?: string | null;
    candidateId?: string | null;
    observedValue: unknown;
    valueHash: string;
    confidence: number;
    observedAt: string;
    parserVersion: string;
  }): Promise<EventFieldEvidence> {
    const { data, error } = await this.client
      .from('event_field_evidence')
      .insert({
        event_id: evidence.eventId,
        field_name: evidence.fieldName,
        event_source_id: evidence.eventSourceId ?? null,
        source_id: evidence.sourceId,
        raw_ingest_id: evidence.rawIngestId ?? null,
        candidate_id: evidence.candidateId ?? null,
        observed_value: evidence.observedValue,
        value_hash: evidence.valueHash,
        confidence: evidence.confidence,
        observed_at: evidence.observedAt,
        parser_version: evidence.parserVersion,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(
        `Failed to record event field evidence: ${error.message}`,
      );
    }
    return mapFieldEvidenceRow(data as EventFieldEvidenceRow);
  }

  async recordResolution(resolution: {
    eventCandidateId: string;
    eventId?: string | null;
    status: CandidateResolution['status'];
    matcherVersion: string;
    confidence: number;
    reasons: Record<string, unknown> | string[];
  }): Promise<CandidateResolution> {
    const { data, error } = await this.client
      .from('candidate_resolutions')
      .insert({
        event_candidate_id: resolution.eventCandidateId,
        event_id: resolution.eventId ?? null,
        status: resolution.status,
        matcher_version: resolution.matcherVersion,
        confidence: resolution.confidence,
        reasons: resolution.reasons,
        resolved_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(
        `Failed to record candidate resolution: ${error.message}`,
      );
    }
    return mapResolutionRow(data as CandidateResolutionRow);
  }

  async findResolutionByCandidateId(
    candidateId: string,
  ): Promise<CandidateResolution | null> {
    const { data, error } = await this.client
      .from('candidate_resolutions')
      .select('*')
      .eq('event_candidate_id', candidateId)
      .order('resolved_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find candidate resolution: ${error.message}`);
    }
    return data ? mapResolutionRow(data as CandidateResolutionRow) : null;
  }

  async countResolutions(): Promise<number> {
    const { count, error } = await this.client
      .from('candidate_resolutions')
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new Error(
        `Failed to count candidate resolutions: ${error.message}`,
      );
    }
    return count ?? 0;
  }

  async countFieldEvidence(): Promise<number> {
    const { count, error } = await this.client
      .from('event_field_evidence')
      .select('*', { count: 'exact', head: true });

    if (error) {
      throw new Error(`Failed to count field evidence: ${error.message}`);
    }
    return count ?? 0;
  }

  /**
   * Atomic canonicalization transaction execution (Finding 2).
   * Executes inside PostgreSQL stored procedure with automatic rollback on error.
   */
  async applyCanonicalization(
    payload: CanonicalizationPayload,
  ): Promise<{ eventId: string | null; status: string }> {
    const { data, error } = await this.client.rpc('apply_canonicalization', {
      payload,
    });

    if (error) {
      throw new Error(`Failed to apply canonicalization: ${error.message}`);
    }

    return {
      eventId: (data as { eventId?: string | null })?.eventId ?? null,
      status: (data as { status?: string })?.status ?? 'created',
    };
  }
}
