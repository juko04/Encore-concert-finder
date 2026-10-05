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

        // Check if headliner matches
        const headlinerMatches =
          (candidatePrimaryId &&
            existingHeadliner?.id === candidatePrimaryId) ||
          (candidatePrimaryNorm &&
            candidatePrimaryNorm === existingHeadlinerNorm);

        // Check if all artists match
        const allArtistsMatch =
          candidateNormArtists.length > 0 &&
          candidateNormArtists.every((c) => existingNormArtists.includes(c)) &&
          existingNormArtists.every((e) => candidateNormArtists.includes(e));

        if (headlinerMatches) {
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

        if (allArtistsMatch) {
          return {
            decision: 'match',
            matchedEvent: existingEvent,
            confidence: 0.95,
            reasons: ['same_venue_and_date', 'all_artists_match'],
          };
        }

        // Check if a secondary / opening / supporting artist matches
        const hasOpeningOverlap =
          detail.artists.some((a) => resolvedArtistIds.includes(a.id)) ||
          candidateNormArtists.some((c) => existingNormArtists.includes(c));

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
