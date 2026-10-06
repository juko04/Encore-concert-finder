import type {
  CanonicalEventDetail,
  CanonicalizationPayload,
  EventStatus,
} from '@/lib/domain/catalog';
import type {
  CandidateArtist,
  EventCandidate,
} from '@/lib/domain/event-candidate';
import {
  deriveLocalDateFromInstant,
  normalizeName,
  normalizeUrl,
  validateIanaTimezone,
} from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';
import { ArtistResolver } from './artist-resolver';
import { EventMatcher } from './event-matcher';
import { evaluateFieldMerge, type FieldMergeEvidence } from './field-merge';
import { VenueResolver } from './venue-resolver';

export interface CanonicalizationResult {
  eventId: string | null;
  status: 'created' | 'matched' | 'needs_review' | 'rejected';
  reasons: Record<string, unknown> | string[];
}

export class CanonicalizationCoordinator {
  private artistResolver: ArtistResolver;
  private venueResolver: VenueResolver;
  private eventMatcher: EventMatcher;

  constructor(
    private catalogRepo: ICatalogRepository,
    artistResolver?: ArtistResolver,
    venueResolver?: VenueResolver,
    eventMatcher?: EventMatcher,
  ) {
    this.artistResolver = artistResolver ?? new ArtistResolver();
    this.venueResolver = venueResolver ?? new VenueResolver();
    this.eventMatcher = eventMatcher ?? new EventMatcher();
  }

  async canonicalize(
    candidate: EventCandidate & { rawIngestId: string; sourceId: string },
  ): Promise<CanonicalizationResult> {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !candidate.id ||
      !candidate.rawIngestId ||
      !candidate.sourceId ||
      !uuidRegex.test(candidate.id) ||
      !uuidRegex.test(candidate.rawIngestId) ||
      !uuidRegex.test(candidate.sourceId)
    ) {
      throw new Error(
        'Candidate must be persisted with valid UUID id, rawIngestId, and sourceId prior to canonicalization.',
      );
    }
    const candidateId = candidate.id;

    // Validate locality before resolving venue (Point 9: Empty city is not valid unknown geography)
    const trimmedCity = candidate.city?.trim();
    if (!trimmedCity) {
      const payload: CanonicalizationPayload = {
        resolution: {
          event_candidate_id: candidateId,
          status: 'needs_review',
          matcher_version: '1.0.0',
          confidence: 0.4,
          reasons: ['missing_venue_locality'],
        },
      };
      await this.catalogRepo.applyCanonicalization(payload);
      return {
        eventId: null,
        status: 'needs_review',
        reasons: ['missing_venue_locality'],
      };
    }

    // 1. Resolve Venue (pure in-memory prep, zero upfront writes to DB)
    const venuePrep = await this.venueResolver.resolveOrPrepare(
      this.catalogRepo,
      {
        name: candidate.venueName,
        city: trimmedCity,
        region: candidate.state,
        countryCode: candidate.country ?? null,
        timezone: candidate.timezone,
      },
    );
    const resolvedVenue = venuePrep.venue!;

    // 2. Resolve Timezone (Finding 3: Never default to America/Denver)
    let resolvedTimezone: string | null = null;
    if (candidate.timezone && validateIanaTimezone(candidate.timezone)) {
      resolvedTimezone = candidate.timezone;
    } else if (
      resolvedVenue.timezone &&
      validateIanaTimezone(resolvedVenue.timezone)
    ) {
      resolvedTimezone = resolvedVenue.timezone;
    }

    if (!resolvedTimezone) {
      // Route to needs_review when timezone cannot be determined
      const payload: CanonicalizationPayload = {
        resolution: {
          event_candidate_id: candidateId,
          status: 'needs_review',
          matcher_version: '1.0.0',
          confidence: 0.4,
          reasons: ['missing_or_invalid_timezone'],
        },
      };
      await this.catalogRepo.applyCanonicalization(payload);
      return {
        eventId: null,
        status: 'needs_review',
        reasons: ['missing_or_invalid_timezone'],
      };
    }

    // 3. Derive Local Calendar Date (Finding 4: Using IANA timezone, not UTC substring)
    let localStartDate = candidate.localStartDate;
    if (!localStartDate) {
      if (candidate.startsAt) {
        try {
          localStartDate = deriveLocalDateFromInstant(
            candidate.startsAt,
            resolvedTimezone,
          );
        } catch {
          localStartDate = undefined;
        }
      }
    }

    if (!localStartDate) {
      const payload: CanonicalizationPayload = {
        resolution: {
          event_candidate_id: candidateId,
          status: 'needs_review',
          matcher_version: '1.0.0',
          confidence: 0.4,
          reasons: ['missing_local_start_date'],
        },
      };
      await this.catalogRepo.applyCanonicalization(payload);
      return {
        eventId: null,
        status: 'needs_review',
        reasons: ['missing_local_start_date'],
      };
    }

    // Contextual disambiguation: check if candidate already maps to an existing canonical event
    let existingMatchedDetail: CanonicalEventDetail | null = null;
    if (candidate.sourceId && candidate.sourceEventId) {
      const matchBySource = await this.catalogRepo.findEventBySourceEventId(
        candidate.sourceId,
        candidate.sourceEventId,
      );
      if (matchBySource) {
        existingMatchedDetail = await this.catalogRepo.getEventById(
          matchBySource.id,
        );
      }
    }
    if (!existingMatchedDetail && candidate.ticketUrl) {
      try {
        const normUrl = normalizeUrl(candidate.ticketUrl);
        const matchByTicket =
          await this.catalogRepo.findEventByTicketUrl(normUrl);
        if (matchByTicket) {
          existingMatchedDetail = await this.catalogRepo.getEventById(
            matchByTicket.id,
          );
        }
      } catch {
        // ignore
      }
    }

    // 4. Resolve Artists (Finding 5: In-memory prep with ambiguity detection)
    const artistPayloads: NonNullable<CanonicalizationPayload['artists']> = [];
    const resolvedArtistIds: string[] = [];

    const candidateArtists: CandidateArtist[] =
      candidate.artists && candidate.artists.length > 0
        ? candidate.artists
        : candidate.artistNames.map((name, idx) => ({
            name,
            billingPosition: idx === 0 ? 'headliner' : 'support',
            sortOrder: idx,
          }));

    for (let index = 0; index < candidateArtists.length; index++) {
      const candidateArtist = candidateArtists[index];

      let disambiguatedArtistId: string | undefined;
      if (existingMatchedDetail) {
        const matched = existingMatchedDetail.artists.find(
          (a) => normalizeName(a.name) === normalizeName(candidateArtist.name),
        );
        if (matched) {
          disambiguatedArtistId = matched.id;
        }
      }

      const resolved = await this.artistResolver.resolveOrPrepare(
        this.catalogRepo,
        {
          name: candidateArtist.name,
          disambiguatedArtistId,
          externalIds: candidateArtist.externalIds?.map((e) => ({
            provider: e.provider,
            externalId: e.externalId,
            providerUrl: e.providerUrl,
          })),
        },
      );

      if (resolved.status === 'ambiguous') {
        const reasons = ['ambiguous_artist_identity', ...resolved.reasons];
        const payload: CanonicalizationPayload = {
          resolution: {
            event_candidate_id: candidateId,
            status: 'needs_review',
            matcher_version: '1.0.0',
            confidence: 0.4,
            reasons,
          },
        };
        await this.catalogRepo.applyCanonicalization(payload);
        return {
          eventId: null,
          status: 'needs_review',
          reasons,
        };
      }

      const billingPos =
        candidateArtist.billingPosition ??
        (index === 0 ? 'headliner' : 'support');
      const sortOrd = candidateArtist.sortOrder ?? index;

      if (resolved.status === 'matched') {
        resolvedArtistIds.push(resolved.artistId!);
        artistPayloads.push({
          artist_id: resolved.artistId!,
          billing_position: billingPos,
          sort_order: sortOrd,
        });
      } else if (resolved.status === 'to_create') {
        const toCreate = resolved.artistToCreate!;
        resolvedArtistIds.push(toCreate.id);
        artistPayloads.push({
          artist_id: toCreate.id,
          name: toCreate.name,
          normalized_name: toCreate.normalizedName,
          external_ids: toCreate.externalIds?.map((e) => ({
            provider: e.provider,
            external_id: e.externalId,
            provider_url: e.providerUrl,
          })),
          billing_position: billingPos,
          sort_order: sortOrd,
        });
      }
    }

    // 5. Match Event (Finding 6: Conservative matching)
    const preparedCandidate: EventCandidate = {
      ...candidate,
      localStartDate,
      timezone: resolvedTimezone,
    };

    const matchResult = await this.eventMatcher.match(
      this.catalogRepo,
      preparedCandidate,
      resolvedVenue.id,
      resolvedArtistIds,
    );

    if (matchResult.decision === 'needs_review') {
      const payload: CanonicalizationPayload = {
        resolution: {
          event_candidate_id: candidateId,
          status: 'needs_review',
          matcher_version: '1.0.0',
          confidence: matchResult.confidence,
          reasons: matchResult.reasons,
        },
      };
      await this.catalogRepo.applyCanonicalization(payload);
      return {
        eventId: null,
        status: 'needs_review',
        reasons: matchResult.reasons,
      };
    }

    // 6. Ticket Provider Attribution (Finding 8)
    const isTicketingSource =
      candidate.provenance?.sourceType === 'ticketing' ||
      (candidate.provenance?.sourceType as string) === 'primary_ticketing';
    const ticketProviderSourceId = isTicketingSource
      ? candidate.sourceId
      : null;

    // 7. Assemble Atomic Transaction Payload (zero upfront writes)
    let payload: CanonicalizationPayload;

    if (matchResult.decision === 'create') {
      const isMultiDay = Boolean(
        candidate.localEndDate && candidate.localEndDate !== localStartDate,
      );

      const eventData = {
        name: candidate.title,
        normalized_name: normalizeName(candidate.title),
        event_kind:
          candidate.eventKind ??
          (candidate.isFestival ? 'festival' : 'concert'),
        status: (candidate.rawPayload?.status as EventStatus) ?? 'scheduled',
        venue_id: resolvedVenue.id,
        city: candidate.city ?? resolvedVenue.city ?? null,
        region: candidate.state ?? resolvedVenue.region ?? null,
        country_code: candidate.country ?? resolvedVenue.countryCode ?? null,
        timezone: resolvedTimezone,
        local_start_date: localStartDate,
        local_end_date: candidate.localEndDate ?? null,
        starts_at: candidate.startsAt ?? null,
        ends_at: candidate.endsAt ?? null,
        start_time_precision:
          candidate.startTimePrecision ??
          (candidate.startsAt ? 'instant' : 'date_only'),
        doors_at: candidate.doorsOpenAt ?? null,
        is_multi_day: isMultiDay,
        official_url: null,
        primary_ticket_url: candidate.ticketUrl ?? null,
      };

      const creationEvidences: NonNullable<
        CanonicalizationPayload['evidence']
      > = [
        {
          field_name: 'canonical_event_created',
          source_id: candidate.sourceId,
          raw_ingest_id: candidate.rawIngestId,
          candidate_id: candidateId,
          observed_value: { title: candidate.title },
          value_hash: `created_${candidateId}`,
          confidence: candidate.confidence,
          observed_at:
            candidate.provenance?.fetchedAt ?? new Date().toISOString(),
          parser_version: candidate.provenance?.parserVersion ?? '1.0.0',
        },
      ];

      const addFieldEvidence = (fieldName: string, value: unknown) => {
        if (value === null || value === undefined || value === '') return;
        creationEvidences.push({
          field_name: fieldName,
          source_id: candidate.sourceId,
          raw_ingest_id: candidate.rawIngestId,
          candidate_id: candidateId,
          observed_value: value,
          value_hash: `${fieldName}_${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
          confidence: candidate.confidence,
          observed_at:
            candidate.provenance?.fetchedAt ?? new Date().toISOString(),
          parser_version: candidate.provenance?.parserVersion ?? '1.0.0',
        });
      };

      addFieldEvidence('title', eventData.name);
      addFieldEvidence('event_kind', eventData.event_kind);
      addFieldEvidence('status', eventData.status);
      addFieldEvidence('venue', {
        id: resolvedVenue.id,
        name: resolvedVenue.name,
      });
      addFieldEvidence('city', eventData.city);
      addFieldEvidence('region', eventData.region);
      addFieldEvidence('country_code', eventData.country_code);
      addFieldEvidence('timezone', eventData.timezone);
      addFieldEvidence('local_start_date', eventData.local_start_date);
      addFieldEvidence('local_end_date', eventData.local_end_date);
      addFieldEvidence('starts_at', eventData.starts_at);
      addFieldEvidence('ends_at', eventData.ends_at);
      addFieldEvidence('start_time_precision', eventData.start_time_precision);
      addFieldEvidence('doors_at', eventData.doors_at);
      addFieldEvidence('primary_ticket_url', eventData.primary_ticket_url);

      payload = {
        venueToCreate:
          venuePrep.isNew && venuePrep.venueToCreate
            ? {
                id: venuePrep.venueToCreate.id,
                name: venuePrep.venueToCreate.name,
                normalized_name: venuePrep.venueToCreate.normalizedName,
                city: venuePrep.venueToCreate.city,
                region: venuePrep.venueToCreate.region,
                country_code: venuePrep.venueToCreate.countryCode,
                timezone: venuePrep.venueToCreate.timezone,
                website: venuePrep.venueToCreate.website,
              }
            : null,
        event: eventData,
        artists: artistPayloads,
        ticketLinks: candidate.ticketUrl
          ? [
              {
                ticket_provider_source_id: ticketProviderSourceId,
                url: candidate.ticketUrl,
                normalized_url: normalizeUrl(candidate.ticketUrl),
                min_price: candidate.price?.min ?? null,
                max_price: candidate.price?.max ?? null,
                currency: candidate.price?.currency ?? null,
                inventory_status: 'available',
                verified_at: new Date().toISOString(),
              },
            ]
          : [],
        source: {
          source_id: candidate.sourceId,
          candidate_id: candidateId,
          raw_ingest_id: candidate.rawIngestId,
          source_event_id: candidate.sourceEventId ?? null,
          source_url: candidate.provenance?.sourceUrl ?? '',
          confidence: candidate.confidence,
        },
        evidence: creationEvidences,
        resolution: {
          event_candidate_id: candidateId,
          status: 'created',
          matcher_version: '1.0.0',
          confidence: matchResult.confidence,
          reasons: matchResult.reasons,
        },
      };
    } else {
      // Matched existing canonical event
      const existingEvent = matchResult.matchedEvent!;
      const mergeOutcome = evaluateFieldMerge(
        existingEvent,
        candidate,
        candidate.provenance?.parserVersion,
      );

      payload = {
        event: {
          id: existingEvent.id,
          ...mergeOutcome.updates,
        },
        artists: artistPayloads,
        ticketLinks: candidate.ticketUrl
          ? [
              {
                ticket_provider_source_id: ticketProviderSourceId,
                url: candidate.ticketUrl,
                normalized_url: normalizeUrl(candidate.ticketUrl),
                min_price: candidate.price?.min ?? null,
                max_price: candidate.price?.max ?? null,
                currency: candidate.price?.currency ?? null,
                inventory_status: 'available',
                verified_at: new Date().toISOString(),
              },
            ]
          : [],
        source: {
          source_id: candidate.sourceId,
          candidate_id: candidateId,
          raw_ingest_id: candidate.rawIngestId,
          source_event_id: candidate.sourceEventId ?? null,
          source_url: candidate.provenance?.sourceUrl ?? '',
          confidence: candidate.confidence,
        },
        evidence: mergeOutcome.evidences.map((ev: FieldMergeEvidence) => ({
          field_name: ev.fieldName,
          source_id: candidate.sourceId,
          raw_ingest_id: candidate.rawIngestId,
          candidate_id: candidateId,
          observed_value: ev.observedValue,
          value_hash: ev.valueHash,
          confidence: ev.confidence,
          observed_at:
            candidate.provenance?.fetchedAt ?? new Date().toISOString(),
          parser_version: ev.parserVersion,
        })),
        resolution: {
          event_candidate_id: candidateId,
          status: 'matched',
          matcher_version: '1.0.0',
          confidence: matchResult.confidence,
          reasons: matchResult.reasons,
        },
      };
    }

    // 8. Execute atomic transaction
    const txResult = await this.catalogRepo.applyCanonicalization(payload);

    return {
      eventId: txResult.eventId,
      status: matchResult.decision === 'create' ? 'created' : 'matched',
      reasons: matchResult.reasons,
    };
  }
}
