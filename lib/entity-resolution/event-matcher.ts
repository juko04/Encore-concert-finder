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

    // 1. Direct ticket URL match
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
        // Ignore invalid URL parsing here; candidate URL validation handled separately
      }
    }

    // 2. Query existing events on same local start date at same venue
    const sameVenueEvents = await catalogRepo.findEventsOnDateAtVenue(
      localStartDate,
      venueId,
    );

    if (sameVenueEvents.length > 0) {
      const candidateNormArtists = candidate.artistNames.map(normalizeName);

      for (const existingEvent of sameVenueEvents) {
        const detail = await catalogRepo.getEventById(existingEvent.id);
        if (!detail) continue;

        const existingNormArtists = detail.artists.map((a) =>
          normalizeName(a.name),
        );

        // Check if any artist overlaps by ID or normalized name
        const hasArtistOverlap =
          detail.artists.some((a) => resolvedArtistIds.includes(a.id)) ||
          candidateNormArtists.some((cName) =>
            existingNormArtists.includes(cName),
          );

        if (hasArtistOverlap) {
          return {
            decision: 'match',
            matchedEvent: existingEvent,
            confidence: 0.92,
            reasons: ['same_venue_and_date', 'overlapping_artists'],
          };
        }
      }

      // Events exist on same date at same venue, but artists do not match at all!
      // This is ambiguous (consecutive shows, multi-room venue, festival vs regular, or error).
      // Per Decision 5: Ambiguous candidates remain needs_review.
      return {
        decision: 'needs_review',
        confidence: 0.5,
        reasons: ['same_venue_and_date_different_artists'],
      };
    }

    // 3. No events at this venue on this date -> Create new canonical event
    return {
      decision: 'create',
      confidence: 0.9,
      reasons: ['new_canonical_event'],
    };
  }
}
