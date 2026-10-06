import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Artist,
  ArtistExternalId,
  BillingPosition,
  CandidateResolution,
  CanonicalEventDetail,
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
import { normalizeUrl } from '@/lib/domain/value-objects';
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
  announced_at: string | null;
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
  artists?: ArtistRow;
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
    announcedAt: row.announced_at,
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
    let query = this.client
      .from('events')
      .select('*, venues(*)')
      .order('local_start_date', { ascending: true });

    if (filters?.fromDate) {
      query = query.gte('local_start_date', filters.fromDate);
    }
    if (filters?.toDate) {
      query = query.lte('local_start_date', filters.toDate);
    }
    if (filters?.venueId) {
      query = query.eq('venue_id', filters.venueId);
    }
    if (filters?.city) {
      query = query.ilike('city', `%${filters.city}%`);
    }
    if (filters?.region) {
      query = query.eq('region', filters.region);
    }

    // Finding 11: Artist filtering support
    if (filters?.artistId) {
      const { data: ea, error: eaError } = await this.client
        .from('event_artists')
        .select('event_id')
        .eq('artist_id', filters.artistId);

      if (eaError) {
        throw new Error(`Failed to filter by artist: ${eaError.message}`);
      }
      const eventIds = ea?.map((r) => r.event_id) ?? [];
      if (eventIds.length === 0) {
        return [];
      }
      query = query.in('id', eventIds);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    if (filters?.offset) {
      query = query.range(
        filters.offset,
        filters.offset + (filters.limit ?? 20) - 1,
      );
    }

    const { data: eventsData, error } = await query;
    if (error) {
      throw new Error(`Failed to list events: ${error.message}`);
    }

    const summaries: CanonicalEventSummary[] = [];

    for (const row of eventsData || []) {
      const event = mapEventRow(row as EventRow);
      const venueRow = (row as { venues?: VenueRow | null }).venues;
      const venue = venueRow ? mapVenueRow(venueRow) : null;

      // Fetch artists
      const { data: artistLinks } = await this.client
        .from('event_artists')
        .select('*, artists(*)')
        .eq('event_id', event.id)
        .order('sort_order', { ascending: true });

      const artists = ((artistLinks as unknown as EventArtistRow[]) || []).map(
        (aRow) => ({
          name: aRow.artists?.name ?? 'Unknown Artist',
          billingPosition: aRow.billing_position,
        }),
      );

      // Fetch ticket links for pricing
      const { data: ticketLinksData } = await this.client
        .from('event_ticket_links')
        .select('*')
        .eq('event_id', event.id);

      const ticketLinks = ((ticketLinksData as EventTicketLinkRow[]) || []).map(
        mapTicketLinkRow,
      );

      const minPrice = ticketLinks.reduce<number | null>((min, tl) => {
        if (tl.minPrice === null || tl.minPrice === undefined) return min;
        return min === null ? tl.minPrice : Math.min(min, tl.minPrice);
      }, null);

      const maxPrice = ticketLinks.reduce<number | null>((max, tl) => {
        if (tl.maxPrice === null || tl.maxPrice === undefined) return max;
        return max === null ? tl.maxPrice : Math.max(max, tl.maxPrice);
      }, null);

      const currency = ticketLinks.find((tl) => tl.currency)?.currency ?? null;

      summaries.push({
        id: event.id,
        title: event.name,
        venueName: venue?.name ?? event.name,
        city: venue?.city ?? event.city ?? undefined,
        region: venue?.region ?? event.region ?? undefined,
        localStartDate: event.localStartDate,
        startsAt: event.startsAt,
        timezone: event.timezone,
        startTimePrecision: event.startTimePrecision,
        status: event.status,
        artists,
        ticketUrl: event.primaryTicketUrl,
        minPrice,
        maxPrice,
        currency,
      });
    }

    return summaries;
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

    const { data, error } = await query.maybeSingle();
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
        inventory_status: ticketLink.inventoryStatus ?? 'available',
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
