/**
 * Factor 1: Explicit Artist Interest Scoring
 * Pure, deterministic mapping from explicit user preferences to an artist score [0, 100].
 *
 * Invariants:
 * 1. Matches strictly via verified canonical artist ID and external ID; never matches by name alone.
 * 2. Multi-artist lineups: Highest affinity drives the score to avoid double-counting.
 * 3. A manual "Not interested" (dislike) preference suppresses the event from normal recommendations.
 * 4. Unmarked artists receive neutral exploratory value (40).
 */

import type { BillingPosition } from '@/lib/domain/catalog';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';
import type { FactorScore, MatchedArtistInfo } from '../types';

export const ARTIST_PREFERENCE_SCORES: Record<PreferenceLevel, number> = {
  favorite: 100,
  like: 75,
  interested: 55,
  dislike: 0,
};

export const UNMARKED_ARTIST_SCORE = 40;

export interface EventArtistInput {
  id?: string | null;
  name: string;
  billingPosition?: BillingPosition | null;
  spotifyArtistId?: string | null;
}

export interface ArtistFactorResult {
  factorScore: Omit<FactorScore, 'weight' | 'weightedContribution'>;
  matchedArtist?: MatchedArtistInfo;
  isSuppressed: boolean;
  suppressionReason?: string;
  isExploratory: boolean;
}

/**
 * Evaluates the artist interest factor for an event against the user's explicit preferences.
 */
export function calculateArtistInterestFactor(
  eventArtists: EventArtistInput[],
  userPreferences: UserArtistPreference[],
): ArtistFactorResult {
  if (!eventArtists || eventArtists.length === 0) {
    return {
      factorScore: {
        factor: 'artist',
        score: UNMARKED_ARTIST_SCORE,
        isAvailable: false,
        fieldStatus: 'neutral_missing',
        explanation: 'Lineup TBA (neutral exploratory interest)',
        diagnostics: { matchedCount: 0, reason: 'no_artists_listed' },
      },
      isSuppressed: false,
      isExploratory: true,
    };
  }

  // Build lookup index of user preferences by canonical artistId and spotifyArtistId
  // Sort userPreferences by updatedAt desc so recent preference changes take precedence
  const sortedPreferences = [...userPreferences].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  const prefByCanonicalId = new Map<string, UserArtistPreference>();
  const prefBySpotifyId = new Map<string, UserArtistPreference>();

  for (const pref of sortedPreferences) {
    if (pref.artistId && !prefByCanonicalId.has(pref.artistId)) {
      prefByCanonicalId.set(pref.artistId, pref);
    }
    if (pref.spotifyArtistId && !prefBySpotifyId.has(pref.spotifyArtistId)) {
      prefBySpotifyId.set(pref.spotifyArtistId, pref);
    }
  }

  // Find matches across all artists on the bill
  const matches: Array<{
    artist: EventArtistInput;
    preference: UserArtistPreference;
    score: number;
  }> = [];

  for (const artist of eventArtists) {
    let matchedPref: UserArtistPreference | undefined;

    if (artist.id && prefByCanonicalId.has(artist.id)) {
      matchedPref = prefByCanonicalId.get(artist.id);
    } else if (
      artist.spotifyArtistId &&
      prefBySpotifyId.has(artist.spotifyArtistId)
    ) {
      matchedPref = prefBySpotifyId.get(artist.spotifyArtistId);
    }

    if (matchedPref) {
      matches.push({
        artist,
        preference: matchedPref,
        score: ARTIST_PREFERENCE_SCORES[matchedPref.preferenceLevel],
      });
    }
  }

  // Invariant 3: Check for "Not interested" (dislike) suppression
  const dislikedMatch = matches.find(
    (m) => m.preference.preferenceLevel === 'dislike',
  );

  if (dislikedMatch) {
    const matchedArtistInfo: MatchedArtistInfo = {
      id: dislikedMatch.artist.id ?? undefined,
      name: dislikedMatch.artist.name,
      preferenceLevel: 'dislike',
      score: 0,
      isFavorite: false,
      isDisliked: true,
    };

    return {
      factorScore: {
        factor: 'artist',
        score: 0,
        isAvailable: true,
        fieldStatus: 'suppressed',
        explanation: `Suppressed: ${dislikedMatch.artist.name} is marked Not Interested`,
        diagnostics: {
          matchedArtist: dislikedMatch.artist.name,
          preferenceLevel: 'dislike',
          suppressed: true,
        },
      },
      matchedArtist: matchedArtistInfo,
      isSuppressed: true,
      suppressionReason: `Artist '${dislikedMatch.artist.name}' is marked Not Interested`,
      isExploratory: false,
    };
  }

  // If there are explicit positive matches, pick the highest affinity (prevent double-counting)
  if (matches.length > 0) {
    // Sort matches by score descending, then headliner priority
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const isHeadlinerA = a.artist.billingPosition === 'headliner' ? 1 : 0;
      const isHeadlinerB = b.artist.billingPosition === 'headliner' ? 1 : 0;
      return isHeadlinerB - isHeadlinerA;
    });

    const bestMatch = matches[0];
    const isFavorite = bestMatch.preference.preferenceLevel === 'favorite';

    let explanation: string;
    switch (bestMatch.preference.preferenceLevel) {
      case 'favorite':
        explanation = `★ Favorite artist: ${bestMatch.artist.name}`;
        break;
      case 'like':
        explanation = `♥ Liked artist: ${bestMatch.artist.name}`;
        break;
      case 'interested':
        explanation = `Interested in ${bestMatch.artist.name}`;
        break;
      default:
        explanation = `Matched artist: ${bestMatch.artist.name}`;
        break;
    }

    if (matches.length > 1) {
      explanation += ` (+${matches.length - 1} more on lineup)`;
    }

    const matchedArtistInfo: MatchedArtistInfo = {
      id: bestMatch.artist.id ?? undefined,
      name: bestMatch.artist.name,
      preferenceLevel: bestMatch.preference.preferenceLevel,
      score: bestMatch.score,
      isFavorite,
      isDisliked: false,
    };

    return {
      factorScore: {
        factor: 'artist',
        score: bestMatch.score,
        isAvailable: true,
        fieldStatus: 'verified',
        explanation,
        diagnostics: {
          matchedCount: matches.length,
          bestArtist: bestMatch.artist.name,
          preferenceLevel: bestMatch.preference.preferenceLevel,
        },
      },
      matchedArtist: matchedArtistInfo,
      isSuppressed: false,
      isExploratory: false,
    };
  }

  // Invariant 4: Unmarked artist receives neutral exploratory discovery score (40)
  const primaryArtist = eventArtists[0];
  return {
    factorScore: {
      factor: 'artist',
      score: UNMARKED_ARTIST_SCORE,
      isAvailable: false,
      fieldStatus: 'neutral_missing',
      explanation: `Unfamiliar artist: ${primaryArtist.name} (exploratory discovery)`,
      diagnostics: {
        unmarked: true,
        primaryArtist: primaryArtist.name,
      },
    },
    isSuppressed: false,
    isExploratory: true,
  };
}
