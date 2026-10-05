import type {
  BillingPosition,
  CandidateResolution,
  EventKind,
  EventStatus,
} from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import {
  normalizeName,
  validateIanaTimezone,
} from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';
import { ArtistResolver } from './artist-resolver';
import { EventMatcher } from './event-matcher';
import { evaluateFieldMerge } from './field-merge';
import { VenueResolver } from './venue-resolver';

export interface CanonicalizeOptions {
  candidate: EventCandidate & { rawIngestId: string; sourceId: string };
  catalogRepo: ICatalogRepository;
  matcherVersion?: string;
}

export class CanonicalizationCoordinator {
  private artistResolver = new ArtistResolver();
  private venueResolver = new VenueResolver();
  private eventMatcher = new EventMatcher();

  async canonicalize({
    candidate,
    catalogRepo,
    matcherVersion = '1.0.0',
  }: CanonicalizeOptions): Promise<CandidateResolution> {
    const candidateId =
      candidate.id ?? `cand_${Math.random().toString(36).substring(2, 9)}`;

    // 1. Idempotency Check: was this candidate already resolved?
    const existingResolution =
      await catalogRepo.getCandidateResolution(candidateId);
    if (existingResolution) {
      if (existingResolution.eventId) {
        // Update last seen on the existing source link
        const existingSource = await catalogRepo.findEventSource(
          existingResolution.eventId,
          candidate.sourceId,
          candidate.sourceEventId ??
            candidate.provenance?.sourceEventId ??
            null,
        );
        if (existingSource) {
          await catalogRepo.updateEventSourceLastSeen(
            existingSource.id,
            new Date().toISOString(),
          );
        }
      }
      return existingResolution;
    }

    // 2. Resolve Artists
    const resolvedArtists = [];
    for (let i = 0; i < candidate.artistNames.length; i++) {
      const artistName = candidate.artistNames[i];
      const artist = await this.artistResolver.resolve(catalogRepo, {
        name: artistName,
      });
      resolvedArtists.push(artist);
    }

    // 3. Resolve Venue
    const resolvedVenue = await this.venueResolver.resolve(catalogRepo, {
      name: candidate.venueName,
      city: candidate.city ?? 'Denver',
      region: candidate.state ?? 'CO',
      countryCode: candidate.country ?? 'US',
      timezone: candidate.timezone,
    });

    // 4. Derive valid local dates and time zone
    const localStartDate =
      candidate.localStartDate ??
      (candidate.startsAt ? candidate.startsAt.substring(0, 10) : undefined);

    if (!localStartDate) {
      return catalogRepo.recordCandidateResolution({
        eventCandidateId: candidateId,
        eventId: null,
        status: 'needs_review',
        matcherVersion,
        confidence: 0.3,
        reasons: ['missing_local_start_date'],
        resolvedAt: new Date().toISOString(),
      });
    }

    const timezone =
      candidate.timezone && validateIanaTimezone(candidate.timezone)
        ? candidate.timezone
        : resolvedVenue.timezone && validateIanaTimezone(resolvedVenue.timezone)
          ? resolvedVenue.timezone
          : 'America/Denver';

    const normalizedCandidate = {
      ...candidate,
      sourceId: candidate.sourceId ?? candidate.provenance.sourceId,
      rawIngestId:
        candidate.rawIngestId ?? candidate.provenance.rawIngestId ?? '',
      localStartDate,
      timezone,
    };

    // 5. Match candidate against canonical catalog
    const matchResult = await this.eventMatcher.match(
      catalogRepo,
      normalizedCandidate,
      resolvedVenue.id,
      resolvedArtists.map((a) => a.id),
    );

    // 6. Handle Match Decision: MERGE
    if (matchResult.decision === 'match' && matchResult.matchedEvent) {
      const event = matchResult.matchedEvent;

      // Apply field merge rules
      const { updates, evidences } = evaluateFieldMerge(
        event,
        normalizedCandidate,
        candidate.provenance?.parserVersion ?? matcherVersion,
      );

      if (Object.keys(updates).length > 0) {
        await catalogRepo.updateEvent(event.id, updates);
      }

      // Link any artists not yet on the event
      for (let i = 0; i < resolvedArtists.length; i++) {
        const artist = resolvedArtists[i];
        const billingPosition: BillingPosition =
          candidate.performances?.[i]?.billingPosition ??
          (i === 0 ? 'headliner' : 'support');
        await catalogRepo.linkEventArtist(
          event.id,
          artist.id,
          billingPosition,
          i,
        );
      }

      // Add ticket link if present
      if (normalizedCandidate.ticketUrl) {
        await catalogRepo.addEventTicketLink({
          eventId: event.id,
          ticketProviderSourceId: normalizedCandidate.sourceId,
          url: normalizedCandidate.ticketUrl,
          minPrice: normalizedCandidate.price?.min ?? null,
          maxPrice: normalizedCandidate.price?.max ?? null,
          currency: normalizedCandidate.price?.currency ?? null,
          inventoryStatus: 'unknown',
          verifiedAt: new Date().toISOString(),
        });
      }

      // Record / update EventSource
      const sourceEventId =
        normalizedCandidate.sourceEventId ??
        normalizedCandidate.provenance?.sourceEventId ??
        null;

      let eventSource = await catalogRepo.findEventSource(
        event.id,
        normalizedCandidate.sourceId,
        sourceEventId,
      );

      const now = new Date().toISOString();
      if (eventSource) {
        await catalogRepo.updateEventSourceLastSeen(eventSource.id, now);
      } else {
        eventSource = await catalogRepo.addEventSource({
          eventId: event.id,
          sourceId: normalizedCandidate.sourceId,
          candidateId: candidateId,
          rawIngestId: normalizedCandidate.rawIngestId,
          sourceEventId,
          sourceUrl: normalizedCandidate.provenance?.sourceUrl ?? '',
          confidence: normalizedCandidate.confidence,
          firstSeenAt: now,
          lastSeenAt: now,
          isCurrent: true,
        });
      }

      // Persist field evidence
      for (const ev of evidences) {
        await catalogRepo.addEventFieldEvidence({
          eventId: event.id,
          fieldName: ev.fieldName,
          eventSourceId: eventSource.id,
          observedValue: ev.observedValue,
          valueHash: ev.valueHash,
          confidence: ev.confidence,
          observedAt: now,
          parserVersion: ev.parserVersion,
        });
      }

      return catalogRepo.recordCandidateResolution({
        eventCandidateId: candidateId,
        eventId: event.id,
        status: 'matched',
        matcherVersion,
        confidence: matchResult.confidence,
        reasons: matchResult.reasons,
        resolvedAt: now,
      });
    }

    // 7. Handle Create Decision: NEW CANONICAL EVENT
    if (matchResult.decision === 'create') {
      const isMultiDay = Boolean(
        normalizedCandidate.localEndDate &&
        normalizedCandidate.localEndDate > localStartDate,
      );

      const startTimePrecision =
        normalizedCandidate.startTimePrecision ??
        (normalizedCandidate.startsAt ? 'instant' : 'date_only');

      const now = new Date().toISOString();

      const createdEvent = await catalogRepo.createEvent({
        name: normalizedCandidate.title,
        normalizedName: normalizeName(normalizedCandidate.title),
        eventKind: (normalizedCandidate.isFestival
          ? 'festival'
          : 'concert') as EventKind,
        status:
          (normalizedCandidate.rawPayload?.status as EventStatus) ??
          'scheduled',
        venueId: resolvedVenue.id,
        city: normalizedCandidate.city ?? resolvedVenue.city,
        region: normalizedCandidate.state ?? resolvedVenue.region ?? 'CO',
        countryCode:
          normalizedCandidate.country ?? resolvedVenue.countryCode ?? 'US',
        lat: resolvedVenue.lat ?? null,
        lng: resolvedVenue.lng ?? null,
        timezone,
        localStartDate,
        localEndDate: normalizedCandidate.localEndDate ?? null,
        startsAt: normalizedCandidate.startsAt ?? null,
        endsAt: normalizedCandidate.endsAt ?? null,
        startTimePrecision,
        doorsAt: normalizedCandidate.doorsOpenAt ?? null,
        isMultiDay,
        officialUrl: null,
        primaryTicketUrl: normalizedCandidate.ticketUrl ?? null,
        announcedAt: now,
      });

      // Link resolved artists
      for (let i = 0; i < resolvedArtists.length; i++) {
        const artist = resolvedArtists[i];
        const billingPosition: BillingPosition =
          candidate.performances?.[i]?.billingPosition ??
          (i === 0 ? 'headliner' : 'support');
        await catalogRepo.linkEventArtist(
          createdEvent.id,
          artist.id,
          billingPosition,
          i,
        );
      }

      // Add ticket link
      if (normalizedCandidate.ticketUrl) {
        await catalogRepo.addEventTicketLink({
          eventId: createdEvent.id,
          ticketProviderSourceId: normalizedCandidate.sourceId,
          url: normalizedCandidate.ticketUrl,
          minPrice: normalizedCandidate.price?.min ?? null,
          maxPrice: normalizedCandidate.price?.max ?? null,
          currency: normalizedCandidate.price?.currency ?? null,
          inventoryStatus: 'unknown',
          verifiedAt: now,
        });
      }

      // Link EventSource
      const sourceEventId =
        normalizedCandidate.sourceEventId ??
        normalizedCandidate.provenance?.sourceEventId ??
        null;

      const eventSource = await catalogRepo.addEventSource({
        eventId: createdEvent.id,
        sourceId: normalizedCandidate.sourceId,
        candidateId: candidateId,
        rawIngestId: normalizedCandidate.rawIngestId,
        sourceEventId,
        sourceUrl: normalizedCandidate.provenance?.sourceUrl ?? '',
        confidence: normalizedCandidate.confidence,
        firstSeenAt: now,
        lastSeenAt: now,
        isCurrent: true,
      });

      // Persist initial field evidence
      await catalogRepo.addEventFieldEvidence({
        eventId: createdEvent.id,
        fieldName: 'title',
        eventSourceId: eventSource.id,
        observedValue: normalizedCandidate.title,
        valueHash: `title_${normalizedCandidate.title}`,
        confidence: normalizedCandidate.confidence,
        observedAt: now,
        parserVersion:
          normalizedCandidate.provenance?.parserVersion ?? matcherVersion,
      });

      await catalogRepo.addEventFieldEvidence({
        eventId: createdEvent.id,
        fieldName: 'local_start_date',
        eventSourceId: eventSource.id,
        observedValue: localStartDate,
        valueHash: `date_${localStartDate}`,
        confidence: normalizedCandidate.confidence,
        observedAt: now,
        parserVersion:
          normalizedCandidate.provenance?.parserVersion ?? matcherVersion,
      });

      return catalogRepo.recordCandidateResolution({
        eventCandidateId: candidateId,
        eventId: createdEvent.id,
        status: 'created',
        matcherVersion,
        confidence: matchResult.confidence,
        reasons: matchResult.reasons,
        resolvedAt: now,
      });
    }

    // 8. Handle Needs Review Decision
    return catalogRepo.recordCandidateResolution({
      eventCandidateId: candidateId,
      eventId: null,
      status: 'needs_review',
      matcherVersion,
      confidence: matchResult.confidence,
      reasons: matchResult.reasons,
      resolvedAt: new Date().toISOString(),
    });
  }
}
