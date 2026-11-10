/**
 * Server-side Spotify Listening Affinity Service
 *
 * Retrieves and caches the authenticated user's Spotify top artists
 * for transparent listening-affinity scoring in the recommendation engine.
 *
 * Invariants:
 * 1. Read-only listening signals: never mutates user_artist_preferences.
 * 2. Fail-closed: network or token failures gracefully return [] without crashing Discover.
 * 3. Short TTL in-memory caching: prevents repeated external API calls per user session.
 */

import { getServerEnv } from '@/lib/env/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseSpotifyConnectionRepository } from '@/lib/repositories/spotify-connection-repository';
import { SpotifyApiClient } from './client';
import type { SpotifyTimeRange, SpotifyTopArtist } from '@/lib/domain/spotify';

interface CachedAffinities {
  timestamp: number;
  artists: SpotifyTopArtist[];
}

const affinityCache = new Map<string, CachedAffinities>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function clearSpotifyAffinityCache(userId?: string): void {
  if (userId) {
    affinityCache.delete(userId);
  } else {
    affinityCache.clear();
  }
}

export async function getActiveSpotifyTopArtistsForUser(
  userId: string,
  timeRange: SpotifyTimeRange = 'short_term',
): Promise<SpotifyTopArtist[]> {
  if (!userId || typeof userId !== 'string') return [];

  // Check in-memory cache
  const cacheKey = `${userId}:${timeRange}`;
  const cached = affinityCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.artists;
  }

  let serverEnv;
  try {
    serverEnv = getServerEnv();
  } catch {
    return [];
  }

  if (
    !serverEnv ||
    !serverEnv.ENABLE_SPOTIFY_INTEGRATION ||
    !serverEnv.SPOTIFY_CLIENT_ID ||
    !serverEnv.SPOTIFY_CLIENT_SECRET ||
    !serverEnv.SPOTIFY_REDIRECT_URI ||
    !serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY
  ) {
    return [];
  }

  try {
    const adminClient = createAdminClient();
    const repo = new SupabaseSpotifyConnectionRepository(
      adminClient,
      serverEnv.SPOTIFY_TOKEN_ENCRYPTION_KEY,
    );

    const tokens = await repo.getConnectionTokens(userId);
    if (!tokens) return [];

    // Check reauthorization deadline
    if (tokens.reauthorizationDeadline.getTime() <= Date.now()) {
      return [];
    }

    const spotifyClient = new SpotifyApiClient({
      clientId: serverEnv.SPOTIFY_CLIENT_ID,
      clientSecret: serverEnv.SPOTIFY_CLIENT_SECRET,
      redirectUri: serverEnv.SPOTIFY_REDIRECT_URI,
    });

    let currentAccessToken = tokens.accessToken;

    // Refresh if expiring within 60s
    if (tokens.tokenExpiresAt.getTime() <= Date.now() + 60 * 1000) {
      try {
        const refreshed = await spotifyClient.refreshAccessToken(
          tokens.refreshToken,
        );
        currentAccessToken = refreshed.accessToken;
        await repo.updateTokens(userId, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          tokenExpiresAt: refreshed.tokenExpiresAt,
        });
      } catch {
        return [];
      }
    }

    const artists = await spotifyClient.getTopArtists(
      currentAccessToken,
      timeRange,
    );

    affinityCache.set(cacheKey, {
      timestamp: Date.now(),
      artists,
    });

    return artists;
  } catch (err) {
    console.warn(
      `[SpotifyAffinityService] Failed to retrieve top artists for user ${userId}:`,
      err,
    );
    return [];
  }
}
