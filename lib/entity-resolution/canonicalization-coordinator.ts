import type {
  CanonicalEventDetail,
  CanonicalizationPayload,
  Event,
  EventStatus,
} from '@/lib/domain/catalog';
import {
  asHttpsImageUrl,
  getCandidateGenres,
  getCandidateImages,
  type CandidateArtist,
  type EventCandidate,
} from '@/lib/domain/event-candidate';
import {
  deriveLocalDateFromInstant,
  normalizeName,
  normalizeUrl,
  validateIanaTimezone,
} from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';
import {
  NON_EVENT_REASON,
  isNonPublicEventTitle,
} from '@/lib/sources/non-events';
import { ArtistResolver, UNIQUE_NAME_MATCH_REASON } from './artist-resolver';
import { EventMatcher } from './event-matcher';
import { evaluateFieldMerge, type FieldMergeEvidence } from './field-merge';
import { VenueResolver } from './venue-resolver';

export interface CanonicalizationResult {
  eventId: string | null;
  status: 'created' | 'matched' | 'needs_review' | 'rejected';
  reasons: Record<string, unknown> | string[];
}

/**
 * Maps camelCase domain Event updates to the snake_case RPC schema
 * expected by CanonicalizationPayload['event'] and PostgreSQL.
 * Only keys explicitly present in updates (and not undefined) are included.
 */
export function mapEventUpdatesToCanonicalizationPayload(
  updates: Partial<Event> & { id?: string },
): NonNullable<CanonicalizationPayload['event']> {
  const result: NonNullable<CanonicalizationPayload['event']> = {};

  if (updates.id !== undefined) result.id = updates.id;
  if ('name' in updates && updates.name !== undefined)
    result.name = updates.name;
  if ('normalizedName' in updates && updates.normalizedName !== undefined) {
    result.normalized_name = updates.normalizedName;
  }
  if ('eventKind' in updates && updates.eventKind !== undefined) {
    result.event_kind = updates.eventKind;
  }
  if ('status' in updates && updates.status !== undefined) {
    result.status = updates.status;
  }
  if ('venueId' in updates && updates.venueId !== undefined) {
    result.venue_id = updates.venueId;
  }
  if ('city' in updates && updates.city !== undefined) {
    result.city = updates.city;
  }
  if ('region' in updates && updates.region !== undefined) {
    result.region = updates.region;
  }
  if ('countryCode' in updates && updates.countryCode !== undefined) {
    result.country_code = updates.countryCode;
  }
  if ('timezone' in updates && updates.timezone !== undefined) {
    result.timezone = updates.timezone;
  }
  if ('localStartDate' in updates && updates.localStartDate !== undefined) {
    result.local_start_date = updates.localStartDate;
  }
  if ('localEndDate' in updates && updates.localEndDate !== undefined) {
    result.local_end_date = updates.localEndDate;
  }
  if ('startsAt' in updates && updates.startsAt !== undefined) {
    result.starts_at = updates.startsAt;
  }
  if ('endsAt' in updates && updates.endsAt !== undefined) {
    result.ends_at = updates.endsAt;
  }
  if (
    'startTimePrecision' in updates &&
    updates.startTimePrecision !== undefined
  ) {
    result.start_time_precision = updates.startTimePrecision;
  }
  if ('doorsAt' in updates && updates.doorsAt !== undefined) {
    result.doors_at = updates.doorsAt;
  }
  if ('isMultiDay' in updates && updates.isMultiDay !== undefined) {
    result.is_multi_day = updates.isMultiDay;
  }
  if ('officialUrl' in updates && updates.officialUrl !== undefined) {
    result.official_url = updates.officialUrl;
  }
  if ('primaryTicketUrl' in updates && updates.primaryTicketUrl !== undefined) {
    result.primary_ticket_url = updates.primaryTicketUrl;
  }
  if ('genre' in updates && updates.genre !== undefined) {
    result.genre = updates.genre;
  }
  if ('genres' in updates && updates.genres !== undefined) {
    result.genres = updates.genres;
  }

  return result;
}

type ArtistPayload = NonNullable<CanonicalizationPayload['artists']>[number];

/**
 * Collapses payload entries that point at the same canonical artist id: the first entry keeps
 * its billing/sort order (and name for a to-be-created artist), external ids are unioned
 * (an artist may hold several ids per provider), a missing image is filled from a later entry.
 */
export function dedupeArtistPayloads(
  payloads: ArtistPayload[],
): ArtistPayload[] {
  const out: ArtistPayload[] = [];
  const byId = new Map<string, ArtistPayload>();
  for (const p of payloads) {
    const existing = p.artist_id ? byId.get(p.artist_id) : undefined;
    if (!existing) {
      const copy: ArtistPayload = {
        ...p,
        ...(p.external_ids ? { external_ids: [...p.external_ids] } : {}),
      };
      out.push(copy);
      if (p.artist_id) byId.set(p.artist_id, copy);
      continue;
    }
    for (const ext of p.external_ids ?? []) {
      const merged = (existing.external_ids ??= []);
      if (
        !merged.some(
          (e) =>
            e.provider === ext.provider && e.external_id === ext.external_id,
        )
      ) {
        merged.push(ext);
      }
    }
    if (!existing.image_url && p.image_url) existing.image_url = p.image_url;
  }
  return out;
}

export interface CollapsedSharedExternalId {
  provider: string;
  external_id: string;
  display_name: string;
  collapsed_names: string[];
}

/**
 * Attractions of ONE listing that carry the same strong external id (same provider + id) are
 * the same performer (e.g. two Ticketmaster attractions sharing one Spotify artist). Later
 * entries are folded into the first one (its name is the display name) and every id is kept
 * on that single artist. Only entries that resolved to a NEW artist are collapsed into an
 * earlier entry; ids owned by a different existing artist never reach here as shared claims
 * (the resolver / conflict check routes those to needs_review). The decisions are returned so
 * the caller can record them as field evidence.
 */
export function collapseSharedExternalIds(payloads: ArtistPayload[]): {
  payloads: ArtistPayload[];
  collapsed: CollapsedSharedExternalId[];
} {
  const out: ArtistPayload[] = [];
  const collapsed: CollapsedSharedExternalId[] = [];
  const claimOwner = new Map<string, ArtistPayload>();
  const label = (a: ArtistPayload) => a.name ?? a.artist_id ?? 'unknown';
  for (const p of payloads) {
    const target = p.name
      ? (p.external_ids ?? [])
          .map((e) => claimOwner.get(`${e.provider}\u0000${e.external_id}`))
          .find((t): t is ArtistPayload => Boolean(t) && t !== p)
      : undefined;
    if (!target) {
      out.push(p);
      for (const e of p.external_ids ?? []) {
        const key = `${e.provider}\u0000${e.external_id}`;
        if (!claimOwner.has(key)) claimOwner.set(key, p);
      }
      continue;
    }
    for (const e of p.external_ids ?? []) {
      const key = `${e.provider}\u0000${e.external_id}`;
      const merged = (target.external_ids ??= []);
      const shared = claimOwner.get(key) === target;
      if (
        !merged.some(
          (m) => m.provider === e.provider && m.external_id === e.external_id,
        )
      ) {
        merged.push(e);
      }
      if (!claimOwner.has(key)) claimOwner.set(key, target);
      if (shared) {
        collapsed.push({
          provider: e.provider,
          external_id: e.external_id,
          display_name: label(target),
          collapsed_names: [label(p)],
        });
      }
    }
    if (!target.image_url && p.image_url) target.image_url = p.image_url;
  }
  return { payloads: out, collapsed };
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

    // Closure / private-booking / hours notices are not public shows: persist a rejection so they
    // are never retried and never become canonical events.
    if (isNonPublicEventTitle(candidate.title)) {
      const payload: CanonicalizationPayload = {
        resolution: {
          event_candidate_id: candidateId,
          status: 'rejected',
          matcher_version: '1.0.0',
          confidence: 0.95,
          reasons: [NON_EVENT_REASON],
        },
      };
      await this.catalogRepo.applyCanonicalization(payload);
      return {
        eventId: null,
        status: 'rejected',
        reasons: [NON_EVENT_REASON],
      };
    }

    // Validate venue identity before resolving (avoid creating canonical "Unknown Venue")
    const trimmedVenueName = candidate.venueName?.trim();
    if (
      !trimmedVenueName ||
      trimmedVenueName.length === 0 ||
      trimmedVenueName.toLowerCase() === 'unknown venue'
    ) {
      const payload: CanonicalizationPayload = {
        resolution: {
          event_candidate_id: candidateId,
          status: 'needs_review',
          matcher_version: '1.0.0',
          confidence: 0.4,
          reasons: ['missing_venue_identity'],
        },
      };
      await this.catalogRepo.applyCanonicalization(payload);
      return {
        eventId: null,
        status: 'needs_review',
        reasons: ['missing_venue_identity'],
      };
    }

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
        name: trimmedVenueName,
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
    const uniqueNameMatches: Array<{ name: string; artist_id: string }> = [];
    const rawArtistPayloads: NonNullable<CanonicalizationPayload['artists']> =
      [];

    const candidateArtists: CandidateArtist[] =
      candidate.artists && candidate.artists.length > 0
        ? candidate.artists
        : candidate.artistNames.map((name, idx) => ({
            name,
            billingPosition: 'unknown',
            sortOrder: idx,
          }));

    const validCandidateArtists = candidateArtists.filter(
      (a) =>
        a.name &&
        a.name.trim().length > 0 &&
        a.name.trim().toLowerCase() !== 'unknown artist',
    );

    // Cross-source contextual event match on date + venue + artist
    if (!existingMatchedDetail && localStartDate && resolvedVenue?.id) {
      const sameVenueEvents = await this.catalogRepo.findEventsOnDateAtVenue(
        localStartDate,
        resolvedVenue.id,
      );
      for (const ev of sameVenueEvents) {
        const detail = await this.catalogRepo.getEventById(ev.id);
        if (!detail) continue;

        // Start-time conflict check: If both candidate and existing event have precise start times,
        // start times differing by 90+ minutes indicate distinct performances (e.g. early show vs late show).
        if (candidate.startsAt && detail.startsAt) {
          const candTime = new Date(candidate.startsAt).getTime();
          const existTime = new Date(detail.startsAt).getTime();
          if (!isNaN(candTime) && !isNaN(existTime)) {
            const diffMinutes = Math.abs(candTime - existTime) / (1000 * 60);
            if (diffMinutes >= 90) {
              continue; // Separate early / late performance
            }
          }
        }

        // Performance session conflict check (early vs late markers)
        const hasEarlyMarker = (s: string) =>
          /\b(early(\s+show)?|matinee)\b/i.test(s);
        const hasLateMarker = (s: string) =>
          /\b(late(\s+show)?|night\s+show)\b/i.test(s);
        if (
          (hasEarlyMarker(candidate.title) && hasLateMarker(detail.name)) ||
          (hasLateMarker(candidate.title) && hasEarlyMarker(detail.name))
        ) {
          continue; // Early vs late performance marker conflict
        }

        const candidateNormTitle = normalizeName(candidate.title);
        const eventNormTitle = normalizeName(detail.name);
        const titleMatches =
          candidateNormTitle === eventNormTitle ||
          candidateNormTitle.includes(eventNormTitle) ||
          eventNormTitle.includes(candidateNormTitle);

        // Require headliner / primary artist match
        const detailHeadliner =
          detail.artists.find((a) => a.billingPosition === 'headliner') ??
          detail.artists[0];
        const candidateHeadliner = validCandidateArtists[0];

        const headlinerMatches = Boolean(
          detailHeadliner &&
          candidateHeadliner &&
          normalizeName(detailHeadliner.name) ===
            normalizeName(candidateHeadliner.name),
        );

        // Conservative matching: require headliner match AND (title match or all artists match).
        // Never merge merely because detail has a single artist without adequate title/lineup corroboration.
        const allArtistsMatch =
          detail.artists.length > 0 &&
          validCandidateArtists.length > 0 &&
          validCandidateArtists.every((ca) =>
            detail.artists.some(
              (da) => normalizeName(da.name) === normalizeName(ca.name),
            ),
          );

        if (headlinerMatches && (titleMatches || allArtistsMatch)) {
          existingMatchedDetail = detail;
          break;
        }
      }
    }

    // Artist-less listings (e.g. club nights such as "Ladies Night") are canonicalized with
    // zero artists when the source assigned at least one genre: the title is the display name
    // and nothing is fabricated as an artist. Without any genre (or for a seat/VIP/parking
    // package listing) the candidate stays in review.
    const isTicketPackageListing =
      candidate.rawPayload?.isTicketPackage === true;
    const canCreateArtistlessEvent =
      validCandidateArtists.length === 0 &&
      !isTicketPackageListing &&
      candidate.title?.trim().length > 0 &&
      getCandidateGenres(candidate).length > 0;

    if (validCandidateArtists.length === 0 && !canCreateArtistlessEvent) {
      const payload: CanonicalizationPayload = {
        resolution: {
          event_candidate_id: candidateId,
          status: 'needs_review',
          matcher_version: '1.0.0',
          confidence: 0.4,
          reasons: ['missing_artist_identity'],
        },
      };
      await this.catalogRepo.applyCanonicalization(payload);
      return {
        eventId: null,
        status: 'needs_review',
        reasons: ['missing_artist_identity'],
      };
    }

    for (let index = 0; index < validCandidateArtists.length; index++) {
      const candidateArtist = validCandidateArtists[index];

      let disambiguatedArtistId: string | undefined;
      if (existingMatchedDetail) {
        const matched = existingMatchedDetail.artists.find(
          (a) => normalizeName(a.name) === normalizeName(candidateArtist.name),
        );
        if (matched) {
          disambiguatedArtistId = matched.id;
        }
      }

      // Contextual artist resolution for same-venue performances (e.g. distinct early/late shows or multi-night runs)
      if (!disambiguatedArtistId && localStartDate && resolvedVenue?.id) {
        // 1. Same date check
        const sameVenueEvents = await this.catalogRepo.findEventsOnDateAtVenue(
          localStartDate,
          resolvedVenue.id,
        );
        for (const ev of sameVenueEvents) {
          const detail = await this.catalogRepo.getEventById(ev.id);
          const matched = detail?.artists.find(
            (a) =>
              normalizeName(a.name) === normalizeName(candidateArtist.name),
          );
          if (matched) {
            disambiguatedArtistId = matched.id;
            break;
          }
        }

        // 2. Multi-night run check at same venue (adjacent dates: yesterday or tomorrow)
        if (!disambiguatedArtistId) {
          const candDate = new Date(`${localStartDate}T12:00:00Z`);
          const prevDate = new Date(candDate.getTime() - 24 * 60 * 60 * 1000)
            .toISOString()
            .substring(0, 10);
          const nextDate = new Date(candDate.getTime() + 24 * 60 * 60 * 1000)
            .toISOString()
            .substring(0, 10);

          for (const adjacentDate of [prevDate, nextDate]) {
            const adjacentEvents =
              await this.catalogRepo.findEventsOnDateAtVenue(
                adjacentDate,
                resolvedVenue.id,
              );
            for (const ev of adjacentEvents) {
              const detail = await this.catalogRepo.getEventById(ev.id);
              const matched = detail?.artists.find(
                (a) =>
                  normalizeName(a.name) === normalizeName(candidateArtist.name),
              );
              if (matched) {
                disambiguatedArtistId = matched.id;
                break;
              }
            }
            if (disambiguatedArtistId) break;
          }
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

      const billingPos = candidateArtist.billingPosition ?? 'unknown';
      const sortOrd = candidateArtist.sortOrder ?? index;

      if (
        resolved.status === 'matched' &&
        resolved.reasons.includes(UNIQUE_NAME_MATCH_REASON)
      ) {
        uniqueNameMatches.push({
          name: candidateArtist.name,
          artist_id: resolved.artistId!,
        });
      }

      if (resolved.status === 'matched') {
        rawArtistPayloads.push({
          artist_id: resolved.artistId!,
          image_url: asHttpsImageUrl(candidateArtist.imageUrl),
          billing_position: billingPos,
          sort_order: sortOrd,
          external_ids: resolved.externalIdsToEnrich?.map((e) => ({
            provider: e.provider,
            external_id: e.externalId,
            provider_url: e.providerUrl,
          })),
        });
      } else if (resolved.status === 'to_create') {
        const toCreate = resolved.artistToCreate!;
        rawArtistPayloads.push({
          artist_id: toCreate.id,
          name: toCreate.name,
          normalized_name: toCreate.normalizedName,
          image_url: asHttpsImageUrl(candidateArtist.imageUrl),
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

    // Two listed performers can resolve to ONE canonical artist (e.g. two Ticketmaster
    // attractions sharing a Spotify artist): link it once and let it carry both provider ids.
    const collapse = collapseSharedExternalIds(rawArtistPayloads);
    const artistPayloads = dedupeArtistPayloads(collapse.payloads);
    const collapseEvidences = collapse.collapsed.map((c) => ({
      field_name: 'shared_external_id_in_candidate_collapsed',
      source_id: candidate.sourceId,
      raw_ingest_id: candidate.rawIngestId,
      candidate_id: candidateId,
      observed_value: c,
      value_hash: `shared_external_id_collapsed_${c.provider}_${c.external_id}_${c.collapsed_names.join('|')}`,
      confidence: candidate.confidence,
      observed_at: candidate.provenance?.fetchedAt ?? new Date().toISOString(),
      parser_version: candidate.provenance?.parserVersion ?? '1.0.0',
    }));
    const uniqueNameEvidences = uniqueNameMatches.map((m) => ({
      field_name: 'artist_matched_by_unique_name',
      source_id: candidate.sourceId,
      raw_ingest_id: candidate.rawIngestId,
      candidate_id: candidateId,
      observed_value: m,
      value_hash: `artist_unique_name_${m.artist_id}_${normalizeName(m.name)}`,
      confidence: 0.6,
      observed_at: candidate.provenance?.fetchedAt ?? new Date().toISOString(),
      parser_version: candidate.provenance?.parserVersion ?? '1.0.0',
    }));
    const resolvedArtistIds = artistPayloads
      .map((a) => a.artist_id)
      .filter((id): id is string => Boolean(id));

    // 4b. Detect provider external-ID conflicts BEFORE any write. Two different
    // artists in one listing claiming the same provider id (or an id already owned
    // by another canonical artist) must never be silently merged and must not abort
    // the batch: route this candidate to needs_review instead.
    const externalIdConflict =
      await this.detectExternalIdConflict(artistPayloads);
    if (externalIdConflict) {
      const reasons = ['duplicate_external_id_conflict', externalIdConflict];
      await this.catalogRepo.applyCanonicalization({
        resolution: {
          event_candidate_id: candidateId,
          status: 'needs_review',
          matcher_version: '1.0.0',
          confidence: 0.4,
          reasons,
        },
      });
      return { eventId: null, status: 'needs_review', reasons };
    }

    // 5. Match Event (Finding 6: Conservative matching)
    const preparedCandidate: EventCandidate = {
      ...candidate,
      // Placeholder names ("Unknown Artist") are not artist identities for matching.
      ...(validCandidateArtists.length === 0 ? { artistNames: [] } : {}),
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

    const inventoryStatus:
      'available' | 'low_inventory' | 'sold_out' | 'cancelled' | 'unknown' =
      candidate.inventoryStatus ||
      (candidate.rawPayload?.isSoldOut === true ? 'sold_out' : 'unknown');

    // 7. Assemble Atomic Transaction Payload (zero upfront writes)
    let payload: CanonicalizationPayload;

    const { eventImageUrl, venueImageUrl } = getCandidateImages(candidate);
    const candidateGenres = getCandidateGenres(candidate);

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
        status:
          candidate.rawPayload?.isCanceled === true ||
          candidate.rawPayload?.status === 'cancelled' ||
          candidate.resolutionProvenance?.status === 'cancelled'
            ? 'cancelled'
            : ((candidate.rawPayload?.status as EventStatus) ??
              (candidate.resolutionProvenance?.status as EventStatus) ??
              'scheduled'),
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
        min_price: candidate.price?.min ?? null,
        max_price: candidate.price?.max ?? null,
        currency: candidate.price?.currency ?? null,
        image_url: eventImageUrl,
        venue_image_url: venueImageUrl,
        // Source-assigned genres (e.g. Ticketmaster classification); omitted when unknown.
        ...(candidateGenres.length > 0
          ? { genre: candidateGenres[0], genres: candidateGenres }
          : {}),
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
      addFieldEvidence('image_url', eventData.image_url);

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
                inventory_status: inventoryStatus,
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
        evidence: [
          ...creationEvidences,
          ...collapseEvidences,
          ...uniqueNameEvidences,
        ],
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
        preparedCandidate,
        preparedCandidate.provenance?.parserVersion,
      );

      const matchedEventPayload = mapEventUpdatesToCanonicalizationPayload({
        id: existingEvent.id,
        ...mergeOutcome.updates,
      });
      // Images are fill-if-empty: never replace an image the event already has.
      const fillsEventImage = Boolean(eventImageUrl && !existingEvent.imageUrl);
      if (fillsEventImage) matchedEventPayload.image_url = eventImageUrl;
      if (venueImageUrl) matchedEventPayload.venue_image_url = venueImageUrl;

      payload = {
        event: matchedEventPayload,
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
                inventory_status: inventoryStatus,
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
        evidence: mergeOutcome.evidences
          .map((ev: FieldMergeEvidence) => ({
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
          }))
          .concat(
            fillsEventImage && eventImageUrl
              ? [
                  {
                    field_name: 'image_url',
                    source_id: candidate.sourceId,
                    raw_ingest_id: candidate.rawIngestId,
                    candidate_id: candidateId,
                    observed_value: eventImageUrl as unknown,
                    value_hash: `image_url_${eventImageUrl}`,
                    confidence: candidate.confidence,
                    observed_at:
                      candidate.provenance?.fetchedAt ??
                      new Date().toISOString(),
                    parser_version:
                      candidate.provenance?.parserVersion ?? '1.0.0',
                  },
                ]
              : [],
          )
          .concat(collapseEvidences, uniqueNameEvidences),
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
  /**
   * Returns a reason code when the prepared artist payloads contain a provider
   * external ID claimed by more than one distinct artist (within this candidate)
   * or already owned by a different canonical artist. Returns null when clean.
   */
  private async detectExternalIdConflict(
    artistPayloads: NonNullable<CanonicalizationPayload['artists']>,
  ): Promise<string | null> {
    const claimedBy = new Map<string, string>();
    for (const a of artistPayloads) {
      const identity = a.artist_id ?? `name:${a.normalized_name ?? a.name}`;
      for (const ext of a.external_ids ?? []) {
        const key = `${ext.provider}\u0000${ext.external_id}`;
        const prior = claimedBy.get(key);
        if (prior !== undefined && prior !== identity) {
          return 'external_id_shared_by_multiple_artists_in_candidate';
        }
        claimedBy.set(key, identity);

        const owner = await this.catalogRepo.findArtistByExternalId(
          ext.provider,
          ext.external_id,
        );
        if (owner && owner.id !== a.artist_id) {
          return 'external_id_owned_by_different_artist';
        }
      }
    }
    return null;
  }
}
