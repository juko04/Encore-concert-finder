import type { Event } from '@/lib/domain/catalog';
import type { EventCandidate } from '@/lib/domain/event-candidate';
import { normalizeName, normalizeUrl } from '@/lib/domain/value-objects';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export interface EventMatchResult {
  decision: 'match' | 'create' | 'needs_review';
  matchedEvent?: Event;
  confidence: number;
  reasons: string[];
}

export class EventMatcher {
  async match(
    catalogRepo: ICatalogRepository,
    candidate: EventCandidate,
    venueId: string,
    resolvedArtistIds: string[],
  ): Promise<EventMatchResult> {
    const localStartDate = candidate.localStartDate;
    if (!localStartDate) {
      return {
        decision: 'needs_review',
        confidence: 0.3,
        reasons: ['missing_local_start_date'],
      };
    }

    // 0. Direct source event ID match (stable upstream event identity across replays/updates)
    if (candidate.sourceId && candidate.sourceEventId) {
      const matchBySourceEvent = await catalogRepo.findEventBySourceEventId(
        candidate.sourceId,
        candidate.sourceEventId,
      );
      if (matchBySourceEvent) {
        return {
          decision: 'match',
          matchedEvent: matchBySourceEvent,
          confidence: 1.0,
          reasons: ['exact_source_event_id_match'],
        };
      }
    }

    // 1. Direct normalized ticket URL match (strongest identity)
    if (candidate.ticketUrl) {
      try {
        const normUrl = normalizeUrl(candidate.ticketUrl);
        const matchByTicket = await catalogRepo.findEventByTicketUrl(normUrl);
        if (matchByTicket) {
          if (matchByTicket.localStartDate === localStartDate) {
            return {
              decision: 'match',
              matchedEvent: matchByTicket,
              confidence: 0.98,
              reasons: ['exact_ticket_url_match'],
            };
          }
        }
      } catch {
        // Invalid URL handled by candidate verification
      }
    }

    // 2. Query existing events on same local start date at same venue
    const sameVenueEvents = await catalogRepo.findEventsOnDateAtVenue(
      localStartDate,
      venueId,
    );

    if (sameVenueEvents.length > 0) {
      const candidateNormArtists = candidate.artistNames.map(normalizeName);
      const candidatePrimaryNorm = candidateNormArtists[0];
      const candidatePrimaryId = resolvedArtistIds[0];
      let hasDistinctPerformance = false;

      for (const existingEvent of sameVenueEvents) {
        const detail = await catalogRepo.getEventById(existingEvent.id);
        if (!detail) continue;

        const existingNormArtists = detail.artists.map((a) =>
          normalizeName(a.name),
        );
        const existingHeadliner =
          detail.artists.find((a) => a.billingPosition === 'headliner') ??
          detail.artists[0];
        const existingHeadlinerNorm = existingHeadliner
          ? normalizeName(existingHeadliner.name)
          : '';

        // Check if headliner matches (canonical artist IDs take absolute precedence)
        let headlinerMatches = false;
        let headlinerIdDisagreement = false;

        if (candidatePrimaryId && existingHeadliner?.id) {
          if (existingHeadliner.id === candidatePrimaryId) {
            headlinerMatches = true;
          } else {
            headlinerIdDisagreement = true;
          }
        } else if (candidatePrimaryNorm && existingHeadlinerNorm) {
          headlinerMatches = candidatePrimaryNorm === existingHeadlinerNorm;
        }

        // Check if all artists match
        let allArtistsMatch = false;
        if (resolvedArtistIds.length > 0 && detail.artists.length > 0) {
          allArtistsMatch =
            !headlinerIdDisagreement &&
            resolvedArtistIds.length === detail.artists.length &&
            resolvedArtistIds.every((id) =>
              detail.artists.some((a) => a.id === id),
            ) &&
            detail.artists.every((a) => resolvedArtistIds.includes(a.id));
        } else if (
          !headlinerIdDisagreement &&
          candidateNormArtists.length > 0 &&
          existingNormArtists.length > 0
        ) {
          allArtistsMatch =
            !headlinerIdDisagreement &&
            candidateNormArtists.every((c) =>
              existingNormArtists.includes(c),
            ) &&
            existingNormArtists.every((e) => candidateNormArtists.includes(e));
        }

        if (headlinerMatches || allArtistsMatch) {
          // Check for start-time conflict on distinct performances (e.g. early show vs late show)
          let isStartTimeConflict = false;
          if (candidate.startsAt && existingEvent.startsAt) {
            const candTime = new Date(candidate.startsAt).getTime();
            const existTime = new Date(existingEvent.startsAt).getTime();
            if (!isNaN(candTime) && !isNaN(existTime)) {
              isStartTimeConflict =
                Math.abs(candTime - existTime) / (1000 * 60) >= 90;
            }
          }

          const hasEarlyMarker = (s: string) =>
            /\b(early(\s+show)?|matinee)\b/i.test(s);
          const hasLateMarker = (s: string) =>
            /\b(late(\s+show)?|night\s+show)\b/i.test(s);
          const isMarkerConflict =
            (hasEarlyMarker(candidate.title) &&
              hasLateMarker(existingEvent.name)) ||
            (hasLateMarker(candidate.title) &&
              hasEarlyMarker(existingEvent.name));

          if (isStartTimeConflict || isMarkerConflict) {
            hasDistinctPerformance = true;
            // Distinct performance for same artist on same date — do not merge into this event
            continue;
          }

          const reasons = ['same_venue_and_date', 'same_primary_artist'];
          if (allArtistsMatch) {
            reasons.push('all_artists_match');
          }
          return {
            decision: 'match',
            matchedEvent: existingEvent,
            confidence: allArtistsMatch ? 0.95 : 0.92,
            reasons,
          };
        }

        // Check if a secondary / opening / supporting artist matches
        let hasOpeningOverlap = false;
        if (resolvedArtistIds.length > 0 && detail.artists.length > 0) {
          hasOpeningOverlap = detail.artists.some((a) =>
            resolvedArtistIds.includes(a.id),
          );
        } else {
          hasOpeningOverlap = candidateNormArtists.some((c) =>
            existingNormArtists.includes(c),
          );
        }

        if (hasOpeningOverlap) {
          // Conservative matching (Finding 6): Supporting artist overlap must NOT auto-merge!
          return {
            decision: 'needs_review',
            confidence: 0.5,
            reasons: [
              'same_venue_and_date_opening_artist_overlap_requires_review',
            ],
          };
        }
      }

      if (hasDistinctPerformance) {
        // Legitimate separate performance (e.g., early vs late show) on the same date for the same artist
        return {
          decision: 'create',
          confidence: 0.9,
          reasons: ['distinct_performance_same_date_and_artist'],
        };
      }

      // Same venue and date, but completely different artists
      return {
        decision: 'needs_review',
        confidence: 0.5,
        reasons: ['same_venue_and_date_different_artists'],
      };
    }

    // 3. No existing events on this date at this venue -> Create new canonical event
    return {
      decision: 'create',
      confidence: 0.9,
      reasons: ['new_canonical_event'],
    };
  }
}
