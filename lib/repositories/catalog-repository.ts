import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
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
import type { EventListFilters, ICatalogRepository } from './interfaces';

// Database row interfaces
interface ArtistRow {
  id: string;
  name: string;
  normalized_name: string;
  image_url: string | null;
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

function mapArtistRow(row: ArtistRow): Artist {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    imageUrl: row.image_url,
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
      .select('*, artists(*)')
      .eq('event_id', id)
      .order('sort_order', { ascending: true });

    const artists = ((artistLinks as unknown as EventArtistRow[]) || []).map(
      (row) => ({
        id: row.artist_id,
        name: row.artists?.name ?? 'Unknown Artist',
        billingPosition: row.billing_position,
      }),
    );

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
      artists,
      venue: venue
        ? {
            id: venue.id,
            name: venue.name,
            city: venue.city,
            region: venue.region,
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
  ): Promise<CanonicalEventSummary[]> {
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
        this.listEvents({
          ...filters,
          artistIds: chunk,
          offset: undefined,
          limit: chunkFetchLimit,
        }),
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

    // Server-side text search across event title, venue name, and artist names
    if (filters?.searchQuery?.trim()) {
      const trimmedSearch = filters.searchQuery.trim();
      const escaped = escapeLikePattern(trimmedSearch);
      // PostgREST .or() requires quoting for values containing special characters (commas, parentheses, colons, quotes)
      const quotedEscaped = escaped.replace(/"/g, '""');
      const orClauses: string[] = [`name.ilike."%${quotedEscaped}%"`];

      // Query matching venues with pagination to avoid silent truncation (Issue 4)
      const matchedVenueIds: string[] = [];
      const VENUE_BATCH = 1000;
      let venueOffset = 0;
      while (true) {
        const { data: venuesData, error: venueError } = await this.client
          .from('venues')
          .select('id')
          .ilike('name', `%${escaped}%`)
          .order('id', { ascending: true })
          .range(venueOffset, venueOffset + VENUE_BATCH - 1);
        if (venueError) {
          throw new Error(
            `Failed to query venues for search: ${venueError.message}`,
          );
        }
        if (!venuesData || venuesData.length === 0) break;
        for (const v of venuesData) {
          matchedVenueIds.push(v.id);
        }
        if (venuesData.length < VENUE_BATCH) break;
        venueOffset += VENUE_BATCH;
      }
      for (let i = 0; i < matchedVenueIds.length; i += 200) {
        const chunk = matchedVenueIds.slice(i, i + 200);
        orClauses.push(`venue_id.in.(${chunk.join(',')})`);
      }

      // Query matching artists with pagination (Issue 4)
      const matchedArtistIds: string[] = [];
      const ARTIST_BATCH = 1000;
      let artistOffset = 0;
      while (true) {
        const { data: artistsData, error: artistError } = await this.client
          .from('artists')
          .select('id')
          .ilike('name', `%${escaped}%`)
          .order('id', { ascending: true })
          .range(artistOffset, artistOffset + ARTIST_BATCH - 1);
        if (artistError) {
          throw new Error(
            `Failed to query artists for search: ${artistError.message}`,
          );
        }
        if (!artistsData || artistsData.length === 0) break;
        for (const a of artistsData) {
          matchedArtistIds.push(a.id);
        }
        if (artistsData.length < ARTIST_BATCH) break;
        artistOffset += ARTIST_BATCH;
      }

      if (matchedArtistIds.length > 0) {
        // Query event_artists with pagination to prevent silent 1,000-row truncation (Issue 4)
        const matchedEventIds: string[] = [];
        const seenEventIds = new Set<string>();
        const EA_BATCH = 1000;
        let eaOffset = 0;
        while (true) {
          const { data: eaData, error: eaError } = await this.client
            .from('event_artists')
            .select('event_id')
            .in('artist_id', matchedArtistIds)
            .order('event_id', { ascending: true })
            .range(eaOffset, eaOffset + EA_BATCH - 1);
          if (eaError) {
            throw new Error(
              `Failed to query event_artists for search: ${eaError.message}`,
            );
          }
          if (!eaData || eaData.length === 0) break;
          for (const ea of eaData) {
            if (!seenEventIds.has(ea.event_id)) {
              seenEventIds.add(ea.event_id);
              matchedEventIds.push(ea.event_id);
            }
          }
          if (eaData.length < EA_BATCH) break;
          eaOffset += EA_BATCH;
        }

        for (let i = 0; i < matchedEventIds.length; i += 200) {
          const chunk = matchedEventIds.slice(i, i + 200);
          orClauses.push(`id.in.(${chunk.join(',')})`);
        }
      }

      query = query.or(orClauses.join(','));
    }

    if (filters?.excludePastShowtimes && filters?.fromDate) {
      const today = filters.fromDate;
      const nowIso = filters.referenceNowIso || new Date().toISOString();
      query = query.or(
        `local_start_date.gt.${today},and(local_start_date.eq.${today},starts_at.gte.${nowIso}),and(local_start_date.eq.${today},starts_at.is.null)`,
      );
    } else if (filters?.fromDate) {
      query = query.gte('local_start_date', filters.fromDate);
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
          return [];
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
        return [];
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
        const escapedG = escapeLikePattern(filters.genre.trim());
        query = query.or(`genre.ilike."%${escapedG}%",genres.cs.{"${g}"}`);
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

    // Database-level sorting BEFORE pagination
    const sortBy = filters?.sortBy ?? 'date_asc';
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
      }>
    >();
    for (const aRow of (allArtistLinks as unknown as EventArtistWithExtIds[]) ||
      []) {
      const list = artistsByEventId.get(aRow.event_id) || [];
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
        artists,
        ticketUrl: event.primaryTicketUrl,
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
      });
    }

    return summaries;
  }

  async countEvents(filters?: EventListFilters): Promise<number> {
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

    let query = this.client
      .from('events')
      .select(selectString, { count: 'exact', head: true });

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status);
      } else {
        query = query.eq('status', filters.status);
      }
    }

    if (filters?.artistIds && filters.artistIds.length > 0) {
      query = query.in('event_artists.artist_id', filters.artistIds);
    } else if (filters?.artistId) {
      query = query.eq('event_artists.artist_id', filters.artistId);
    }

    if (filters?.searchQuery?.trim()) {
      const trimmedSearch = filters.searchQuery.trim();
      const escaped = escapeLikePattern(trimmedSearch);
      const quotedEscaped = escaped.replace(/"/g, '""');
      const orClauses: string[] = [`name.ilike."%${quotedEscaped}%"`];

      // Query matching venues
      const matchedVenueIds: string[] = [];
      const VENUE_BATCH = 1000;
      let venueOffset = 0;
      while (true) {
        const { data: venuesData, error: venueError } = await this.client
          .from('venues')
          .select('id')
          .ilike('name', `%${escaped}%`)
          .order('id', { ascending: true })
          .range(venueOffset, venueOffset + VENUE_BATCH - 1);
        if (venueError) {
          throw new Error(
            `Failed to query venues for search: ${venueError.message}`,
          );
        }
        if (!venuesData || venuesData.length === 0) break;
        for (const v of venuesData) {
          matchedVenueIds.push(v.id);
        }
        if (venuesData.length < VENUE_BATCH) break;
        venueOffset += VENUE_BATCH;
      }
      for (let i = 0; i < matchedVenueIds.length; i += 200) {
        const chunk = matchedVenueIds.slice(i, i + 200);
        orClauses.push(`venue_id.in.(${chunk.join(',')})`);
      }

      // Query matching artists
      const matchedArtistIds: string[] = [];
      const ARTIST_BATCH = 1000;
      let artistOffset = 0;
      while (true) {
        const { data: artistsData, error: artistError } = await this.client
          .from('artists')
          .select('id')
          .ilike('name', `%${escaped}%`)
          .order('id', { ascending: true })
          .range(artistOffset, artistOffset + ARTIST_BATCH - 1);
        if (artistError) {
          throw new Error(
            `Failed to query artists for search: ${artistError.message}`,
          );
        }
        if (!artistsData || artistsData.length === 0) break;
        for (const a of artistsData) {
          matchedArtistIds.push(a.id);
        }
        if (artistsData.length < ARTIST_BATCH) break;
        artistOffset += ARTIST_BATCH;
      }

      if (matchedArtistIds.length > 0) {
        const matchedEventIds: string[] = [];
        const seenEventIds = new Set<string>();
        const EA_BATCH = 1000;
        let eaOffset = 0;
        while (true) {
          const { data: eaData, error: eaError } = await this.client
            .from('event_artists')
            .select('event_id')
            .in('artist_id', matchedArtistIds)
            .order('event_id', { ascending: true })
            .range(eaOffset, eaOffset + EA_BATCH - 1);
          if (eaError) {
            throw new Error(
              `Failed to query event_artists for search: ${eaError.message}`,
            );
          }
          if (!eaData || eaData.length === 0) break;
          for (const ea of eaData) {
            if (!seenEventIds.has(ea.event_id)) {
              seenEventIds.add(ea.event_id);
              matchedEventIds.push(ea.event_id);
            }
          }
          if (eaData.length < EA_BATCH) break;
          eaOffset += EA_BATCH;
        }

        for (let i = 0; i < matchedEventIds.length; i += 200) {
          const chunk = matchedEventIds.slice(i, i + 200);
          orClauses.push(`id.in.(${chunk.join(',')})`);
        }
      }

      query = query.or(orClauses.join(','));
    }

    if (filters?.excludePastShowtimes && filters?.fromDate) {
      const today = filters.fromDate;
      const nowIso = filters.referenceNowIso || new Date().toISOString();
      query = query.or(
        `local_start_date.gt.${today},and(local_start_date.eq.${today},starts_at.gte.${nowIso}),and(local_start_date.eq.${today},starts_at.is.null)`,
      );
    } else if (filters?.fromDate) {
      query = query.gte('local_start_date', filters.fromDate);
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
          return 0;
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
        return 0;
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
        const escapedG = escapeLikePattern(filters.genre.trim());
        query = query.or(`genre.ilike."%${escapedG}%",genres.cs.{"${g}"}`);
      }
    }

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

    const genreSet = new Set<string>();

    if (genresRes.data) {
      for (const row of genresRes.data as Array<{ genre?: string | null }>) {
        if (row.genre && row.genre.trim().length > 0) {
          genreSet.add(row.genre.trim());
        }
      }
    }

    return {
      venues,
      cities: citiesList.sort((a, b) => a.localeCompare(b)),
      genres: Array.from(genreSet).sort((a, b) => a.localeCompare(b)),
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
