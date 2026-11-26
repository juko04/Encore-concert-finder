/**
 * Spotify listening affinity: trend-aware weighting.
 *
 * Pure functions (no server deps). Inputs are an artist's rank (1 = most listened) in each of
 * Spotify's three windows: short_term (~4 weeks), medium_term (~6 months), long_term (~1 year+).
 *
 * Design goals:
 *  - Reward artists trending UP (better in recent windows than older ones).
 *  - Reward artists that are near the top of ALL three lists (consistent favorites).
 *  - Never treat the long-term list as the source of truth: an artist that appears ONLY in
 *    long_term is capped at a very small affinity (old listening that has since stopped).
 *  - Genre weight is the SUM of its artists' affinities, so many artists in one genre means a
 *    stronger interest in that genre.
 */

export interface SpotifyRanks {
  short_term?: number;
  medium_term?: number;
  long_term?: number;
}

export type AffinityTrend = 'rising' | 'consistent' | 'fading';

/** Window weights. Recent listening counts most; long-term is deliberately lowest. */
export const WINDOW_WEIGHTS = {
  short_term: 0.45,
  medium_term: 0.35,
  long_term: 0.2,
} as const;

/** Spotify returns up to 50 artists per window. */
export const MAX_RANK = 50;

/** Multipliers applied to the base (rank-weighted) score. */
export const TREND_RISING_MULTIPLIER = 1.3;
export const CONSISTENT_TOP_MULTIPLIER = 1.2;
export const FADING_MULTIPLIER = 0.6;
export const RISING_RECENT_FLOOR = 0.85;
/** An artist in a window's top N counts as "near the top". */
export const TOP_CUTOFF = 15;
/** Artists present only in the long-term list are capped here (old listening, not current). */
export const LONG_ONLY_CAP = 0.08;
/** Artists present only in the medium-term list are capped here (cooled off recently). */
export const MEDIUM_ONLY_CAP = 0.35;

function validRank(r?: number): r is number {
  return typeof r === 'number' && Number.isFinite(r) && r >= 1;
}

/** 1.0 at rank 1, down to ~0.02 at rank 50, 0 when absent. */
export function rankPoints(rank?: number): number {
  if (!validRank(rank)) return 0;
  return Math.max(0, (MAX_RANK + 1 - rank) / MAX_RANK);
}

export interface SpotifyAffinityResult {
  /** 0..1 overall affinity (drives artist score and genre weight). */
  affinity: number;
  trend: AffinityTrend;
  /** True when ranked near the top of all three lists. */
  consistentTop: boolean;
  /** Short human reason for explanations. */
  reason: string;
}

export function computeSpotifyAffinity(
  ranks: SpotifyRanks,
): SpotifyAffinityResult {
  const s = validRank(ranks.short_term) ? ranks.short_term : undefined;
  const m = validRank(ranks.medium_term) ? ranks.medium_term : undefined;
  const l = validRank(ranks.long_term) ? ranks.long_term : undefined;

  const base =
    rankPoints(s) * WINDOW_WEIGHTS.short_term +
    rankPoints(m) * WINDOW_WEIGHTS.medium_term +
    rankPoints(l) * WINDOW_WEIGHTS.long_term;

  const consistentTop =
    s !== undefined &&
    m !== undefined &&
    l !== undefined &&
    s <= TOP_CUTOFF &&
    m <= TOP_CUTOFF &&
    l <= TOP_CUTOFF;

  // Trend: compare recent against older windows.
  let trend: AffinityTrend = 'consistent';
  if (s === undefined && (m !== undefined || l !== undefined)) {
    trend = 'fading';
  } else if (s !== undefined) {
    const olderBest = Math.min(m ?? Infinity, l ?? Infinity);
    const newlyCharted = m === undefined && l === undefined;
    const climbing =
      (m !== undefined && s <= m - 3) ||
      (l !== undefined && s <= l - 5) ||
      (m === undefined && l !== undefined && s <= l) ||
      (l === undefined && m !== undefined && s <= m - 1);
    const slipping =
      (m !== undefined && s >= m + 5) || (l !== undefined && s >= l + 8);
    if (newlyCharted || climbing) trend = 'rising';
    else if (slipping && olderBest !== Infinity) trend = 'fading';
  }

  let score = base;
  let reason = 'steady listening';
  if (consistentTop) {
    score *= CONSISTENT_TOP_MULTIPLIER;
    reason = 'near the top of your 4-week, 6-month and 1-year listening';
  }
  if (trend === 'rising') {
    // A riser must not be punished for older windows where it hadn't climbed yet:
    // floor its base at 85% of its current (4-week) rank points before the boost.
    score = Math.max(score, rankPoints(s) * RISING_RECENT_FLOOR);
    score *= TREND_RISING_MULTIPLIER;
    reason = 'trending up in your listening';
  } else if (trend === 'fading') {
    score *= FADING_MULTIPLIER;
    reason = 'you have listened to them less lately';
  }

  // Normalize so strong artists do not all saturate at 1.0 (max raw boost is 1.3x).
  score = score / TREND_RISING_MULTIPLIER;

  // Never let old-only listening count as a current interest.
  if (s === undefined && m === undefined && l !== undefined) {
    score = Math.min(score, LONG_ONLY_CAP);
    reason = 'only in your long-term history';
  } else if (s === undefined && m !== undefined) {
    score = Math.min(score, MEDIUM_ONLY_CAP);
  }

  return {
    affinity: Math.max(0, Math.min(1, score)),
    trend,
    consistentTop,
    reason,
  };
}

/** Direct Spotify artist score (kept below explicit "like" = 75 so explicit prefs win). */
export const SPOTIFY_SCORE_FLOOR = 55;
export const SPOTIFY_SCORE_CEILING = 74;

export function spotifyAffinityToArtistScore(affinity: number): number {
  const a = Math.max(0, Math.min(1, affinity));
  return Math.round(
    SPOTIFY_SCORE_FLOOR + (SPOTIFY_SCORE_CEILING - SPOTIFY_SCORE_FLOOR) * a,
  );
}
