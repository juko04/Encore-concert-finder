/**
 * Fills in genres for events that have none, from two honest sources, in order:
 *  1. an exact-name Ticketmaster attraction lookup for the headliner (real classification data for
 *     touring acts; source 'ticketmaster_attraction'), then
 *  2. explicit genre words in the show title (lib/genres/infer.ts; source 'inferred_title').
 * Both writes are fill-if-empty (an event that already has a genre is never touched) and carry
 * their origin in events.genres_source so the UI can mark inferred genres.
 */

import {
  INFERRED_TITLE_SOURCE,
  TM_ATTRACTION_SOURCE,
  inferGenresFromText,
} from '@/lib/genres/infer';
import {
  getCandidateGenres,
  type EventCandidate,
} from '@/lib/domain/event-candidate';
import type { ICatalogRepository } from '@/lib/repositories/interfaces';

export type EventGenreLookup = (artistName: string) => Promise<string[] | null>;

type GenreWriter = Pick<
  ICatalogRepository,
  'fillEventGenres' | 'fillArtistGenres'
>;

export interface EnrichEventInput {
  eventId: string;
  title: string;
  /** Billed performers, headliner first. */
  artists: ReadonlyArray<{ id?: string | null; name: string }>;
}

export interface EnrichResult {
  genres: string[];
  source: typeof INFERRED_TITLE_SOURCE | typeof TM_ATTRACTION_SOURCE | null;
  /** True when an event row was actually written (it had no genre before). */
  written: boolean;
}

export async function enrichEventGenres(
  input: EnrichEventInput,
  deps: { repo: GenreWriter; lookup?: EventGenreLookup },
): Promise<EnrichResult> {
  const headliner = input.artists.find((a) => a.name?.trim());

  if (deps.lookup && headliner) {
    try {
      const found = await deps.lookup(headliner.name);
      if (found && found.length > 0) {
        const written = await deps.repo.fillEventGenres(
          input.eventId,
          found,
          TM_ATTRACTION_SOURCE,
        );
        if (headliner.id) {
          await deps.repo
            .fillArtistGenres(headliner.id, found, 'ticketmaster')
            .catch(() => false);
        }
        return { genres: found, source: TM_ATTRACTION_SOURCE, written };
      }
    } catch {
      // Lookup failures are "unknown"; fall through to title inference.
    }
  }

  const inferred = inferGenresFromText(
    input.title,
    input.artists.map((a) => a.name),
  );
  if (inferred.genres.length === 0) {
    return { genres: [], source: null, written: false };
  }
  const written = await deps.repo.fillEventGenres(
    input.eventId,
    inferred.genres,
    INFERRED_TITLE_SOURCE,
  );
  return { genres: inferred.genres, source: INFERRED_TITLE_SOURCE, written };
}

/**
 * Ingestion hook (no network): when the ingested candidate carries no genre of its own, infer one
 * from its title and fill the canonical event if it still has none. Best-effort; never throws.
 */
export async function fillInferredEventGenres(
  repo: Pick<ICatalogRepository, 'fillEventGenres'>,
  eventId: string | null | undefined,
  candidate: Pick<EventCandidate, 'title' | 'artistNames' | 'rawPayload'>,
): Promise<boolean> {
  if (!eventId) return false;
  try {
    if (getCandidateGenres(candidate).length > 0) return false;
    const inferred = inferGenresFromText(
      candidate.title,
      candidate.artistNames,
    );
    if (inferred.genres.length === 0) return false;
    return await repo.fillEventGenres(
      eventId,
      inferred.genres,
      INFERRED_TITLE_SOURCE,
    );
  } catch {
    return false;
  }
}
