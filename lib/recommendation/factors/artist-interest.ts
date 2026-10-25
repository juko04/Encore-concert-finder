/**
 * Factor 1: Explicit Artist Interest Scoring
 * Pure, deterministic mapping from explicit user preferences to an artist score [0, 100].
 *
 * Invariants:
 * 1. Matches strictly via verified canonical artist ID and external ID (e.g. Spotify artist ID);
 *    NEVER matches by display name or normalized name alone.
 * 2. Multi-artist lineups: Highest positive affinity drives the score to avoid double-counting.
 * 3. Lineup suppression policy:
 *    - If the headliner is marked "Not interested" (dislike): ALWAYS suppress.
 *    - If an opening/support artist is marked "dislike", but the headliner is explicitly marked
 *      "favorite": The favorite headliner's strong attendance motivation takes precedence;
 *      the event is NOT suppressed, but the explanation notes the opening act preference.
 *    - In all other cases where an artist on the bill is disliked: The event is suppressed.
 * 4. Unmarked artists receive neutral exploratory discovery value (40) and are partitioned
 *    into the exploratory pool.
 * 5. Archived artist preferences (where artistId is null and archivedArtistId is set)
 *    never match new canonical artists sharing the same name.
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
    // Only index canonical IDs if explicitly set (skip archived records with artistId === null)
    if (pref.artistId && !prefByCanonicalId.has(pref.artistId)) {
      prefByCanonicalId.set(pref.artistId, pref);
    }
    if (
      pref.canonicalArtist?.id &&
      !prefByCanonicalId.has(pref.canonicalArtist.id)
    ) {
      prefByCanonicalId.set(pref.canonicalArtist.id, pref);
    }
    if (pref.spotifyArtistId && !prefBySpotifyId.has(pref.spotifyArtistId)) {
      prefBySpotifyId.set(pref.spotifyArtistId, pref);
    }
    if (
      pref.canonicalArtist?.spotifyArtistId &&
      !prefBySpotifyId.has(pref.canonicalArtist.spotifyArtistId)
    ) {
      prefBySpotifyId.set(pref.canonicalArtist.spotifyArtistId, pref);
    }
  }

  // Find matches across all artists on the bill strictly by ID (never by name alone)
  const matches: Array<{
    artist: EventArtistInput;
    preference: UserArtistPreference;
    score: number;
    matchType: 'canonical_id' | 'spotify_id';
  }> = [];

  for (const artist of eventArtists) {
    let matchedPref: UserArtistPreference | undefined;
    let matchType: 'canonical_id' | 'spotify_id' = 'canonical_id';

    if (artist.id && prefByCanonicalId.has(artist.id)) {
      matchedPref = prefByCanonicalId.get(artist.id);
      matchType = 'canonical_id';
    } else if (
      artist.spotifyArtistId &&
      prefBySpotifyId.has(artist.spotifyArtistId)
    ) {
      matchedPref = prefBySpotifyId.get(artist.spotifyArtistId);
      matchType = 'spotify_id';
    }

    if (matchedPref) {
      matches.push({
        artist,
        preference: matchedPref,
        score: ARTIST_PREFERENCE_SCORES[matchedPref.preferenceLevel],
        matchType,
      });
    }
  }

  // Separate positive matches and disliked matches
  const positiveMatches = matches.filter(
    (m) => m.preference.preferenceLevel !== 'dislike',
  );
  const dislikedMatches = matches.filter(
    (m) => m.preference.preferenceLevel === 'dislike',
  );

  // Sort positive matches by score descending, then headliner priority
  positiveMatches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const isHeadlinerA = a.artist.billingPosition === 'headliner' ? 1 : 0;
    const isHeadlinerB = b.artist.billingPosition === 'headliner' ? 1 : 0;
    return isHeadlinerB - isHeadlinerA;
  });

  const bestPositive = positiveMatches[0] as
    (typeof positiveMatches)[0] | undefined;
  const headlinerMatch = matches.find(
    (m) => m.artist.billingPosition === 'headliner',
  );
  const isHeadlinerFavorite =
    headlinerMatch?.preference.preferenceLevel === 'favorite' ||
    (bestPositive?.artist.billingPosition === 'headliner' &&
      bestPositive.preference.preferenceLevel === 'favorite');

  // Multi-artist lineup dislike suppression policy
  if (dislikedMatches.length > 0) {
    const dislikedHeadliner = dislikedMatches.find(
      (m) => m.artist.billingPosition === 'headliner',
    );

    // If the headliner itself is disliked -> ALWAYS suppress
    if (dislikedHeadliner) {
      const matchedArtistInfo: MatchedArtistInfo = {
        id: dislikedHeadliner.artist.id ?? undefined,
        name: dislikedHeadliner.artist.name,
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
          explanation: `Suppressed: Headliner ${dislikedHeadliner.artist.name} is marked Not Interested`,
          diagnostics: {
            matchedArtist: dislikedHeadliner.artist.name,
            preferenceLevel: 'dislike',
            suppressed: true,
            billingPosition: 'headliner',
          },
        },
        matchedArtist: matchedArtistInfo,
        isSuppressed: true,
        suppressionReason: `Headliner '${dislikedHeadliner.artist.name}' is marked Not Interested`,
        isExploratory: false,
      };
    }

    // If an opening/support artist is disliked, but headliner is a favorite:
    // Do NOT suppress; the favorite headliner takes precedence!
    const firstDisliked = dislikedMatches[0];
    if (isHeadlinerFavorite && bestPositive) {
      let explanation = `★ Favorite headliner: ${bestPositive.artist.name}`;
      explanation += ` (support act ${firstDisliked.artist.name} is marked Not Interested)`;

      const matchedArtistInfo: MatchedArtistInfo = {
        id: bestPositive.artist.id ?? undefined,
        name: bestPositive.artist.name,
        preferenceLevel: 'favorite',
        score: 100,
        isFavorite: true,
        isDisliked: false,
      };

      return {
        factorScore: {
          factor: 'artist',
          score: 100,
          isAvailable: true,
          fieldStatus: 'verified',
          explanation,
          diagnostics: {
            matchedCount: matches.length,
            bestArtist: bestPositive.artist.name,
            preferenceLevel: 'favorite',
            dislikedSupportAct: firstDisliked.artist.name,
            headlinerOverride: true,
          },
        },
        matchedArtist: matchedArtistInfo,
        isSuppressed: false,
        isExploratory: false,
      };
    }

    // In all other cases, dislike suppresses the show
    const matchedArtistInfo: MatchedArtistInfo = {
      id: firstDisliked.artist.id ?? undefined,
      name: firstDisliked.artist.name,
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
        explanation: `Suppressed: ${firstDisliked.artist.name} on the bill is marked Not Interested`,
        diagnostics: {
          matchedArtist: firstDisliked.artist.name,
          preferenceLevel: 'dislike',
          suppressed: true,
        },
      },
      matchedArtist: matchedArtistInfo,
      isSuppressed: true,
      suppressionReason: `Artist '${firstDisliked.artist.name}' on the bill is marked Not Interested`,
      isExploratory: false,
    };
  }

  // If there are explicit positive matches, pick the highest affinity (prevent double-counting)
  if (positiveMatches.length > 0) {
    const bestMatch = positiveMatches[0];
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

    if (positiveMatches.length > 1) {
      explanation += ` (+${positiveMatches.length - 1} more on lineup)`;
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
          matchedCount: positiveMatches.length,
          bestArtist: bestMatch.artist.name,
          preferenceLevel: bestMatch.preference.preferenceLevel,
          matchType: bestMatch.matchType,
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
