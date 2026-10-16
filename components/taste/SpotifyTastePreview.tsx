'use client';

import React, { useState } from 'react';
import type { SpotifyTimeRange, SpotifyTopArtist } from '@/lib/domain/spotify';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';

interface SpotifyTastePreviewProps {
  artists: SpotifyTopArtist[];
  timeRange: SpotifyTimeRange;
  onChangeTimeRange: (range: SpotifyTimeRange) => void;
  existingPreferences: UserArtistPreference[];
  onAddPreference: (
    artist: SpotifyTopArtist,
    level: PreferenceLevel,
  ) => Promise<void>;
  isLoading?: boolean;
  isSyntheticPreview?: boolean;
}

function findMatchingPreference(
  artist: SpotifyTopArtist,
  preferences: UserArtistPreference[],
): UserArtistPreference | null {
  for (const p of preferences) {
    const prefSpotifyId =
      p.spotifyArtistId || p.canonicalArtist?.spotifyArtistId;
    if (prefSpotifyId && prefSpotifyId === artist.id) {
      return p;
    }
  }
  return null;
}

export function SpotifyTastePreview({
  artists,
  timeRange,
  onChangeTimeRange,
  existingPreferences,
  onAddPreference,
  isLoading = false,
  isSyntheticPreview = false,
}: SpotifyTastePreviewProps) {
  const [addingArtistId, setAddingArtistId] = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel] =
    useState<PreferenceLevel>('favorite');
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  async function handleConfirmAdd(artist: SpotifyTopArtist) {
    setSubmittingId(artist.id);
    try {
      await onAddPreference(artist, selectedLevel);
      setAddingArtistId(null);
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div
      data-testid="spotify-taste-preview"
      className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur"
    >
      {/* Header and Time Range Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-white">
              Spotify Listening History
            </h3>
            {isSyntheticPreview && (
              <span
                data-testid="synthetic-preview-pill"
                className="rounded border border-indigo-700/50 bg-indigo-950/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-300"
              >
                Synthetic Demo
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            Compare your active rotation across time horizons and incorporate
            artists into your live concert profile.
          </p>
        </div>

        {/* Time Horizon Tabs */}
        <div
          data-testid="time-range-tabs"
          className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-1"
        >
          <button
            type="button"
            data-testid="tab-short-term"
            onClick={() => onChangeTimeRange('short_term')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              timeRange === 'short_term'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Past 4 Weeks
          </button>
          <button
            type="button"
            data-testid="tab-medium-term"
            onClick={() => onChangeTimeRange('medium_term')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              timeRange === 'medium_term'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Past 6 Months
          </button>
          <button
            type="button"
            data-testid="tab-long-term"
            onClick={() => onChangeTimeRange('long_term')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              timeRange === 'long_term'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All-Time / 1 Year
          </button>
        </div>
      </div>

      {/* Recency Hypothesis Explanation Banner */}
      <div
        data-testid="recency-hypothesis-banner"
        className="rounded-xl border border-indigo-950/80 bg-indigo-950/20 p-4 text-xs text-indigo-200/90"
      >
        <div className="flex items-start gap-2.5">
          <span className="text-base">✦</span>
          <div>
            <strong className="font-semibold text-indigo-100">
              Recency-Weighted Taste Hypothesis (PR #10 Preview):
            </strong>{' '}
            Listening recency signals distinct concert intent. Rising artists
            (heavy 4-week listening) reflect immediate discovery momentum,
            whereas consistent staples indicate enduring multi-year affinity. In
            PR #10, this is surfaced for intentional manual review; automated
            recommendation scoring will build on this in PR #11.
          </div>
        </div>
      </div>

      {/* Artists List */}
      {isLoading ? (
        <div
          data-testid="spotify-taste-loading"
          className="flex h-48 items-center justify-center text-xs text-zinc-500"
        >
          Loading Spotify listening taste...
        </div>
      ) : artists.length === 0 ? (
        <div
          data-testid="spotify-taste-empty"
          className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-500"
        >
          No top artists returned for this time window.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60 rounded-xl border border-zinc-800 bg-zinc-950/40">
          {artists.map((artist) => {
            const existingPref = findMatchingPreference(
              artist,
              existingPreferences,
            );
            const hasNameCollision =
              !existingPref &&
              existingPreferences.some(
                (p) =>
                  p.normalizedArtistName.toLowerCase() ===
                    artist.name.toLowerCase().trim() ||
                  p.artistName.toLowerCase().trim() ===
                    artist.name.toLowerCase().trim(),
              );
            const isAddingThis = addingArtistId === artist.id;
            const isSubmittingThis = submittingId === artist.id;

            return (
              <div
                key={artist.id}
                data-testid={`spotify-artist-row-${artist.id}`}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-zinc-900/30 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3.5">
                  <span className="w-5 text-right font-mono text-xs font-bold text-zinc-500">
                    #{artist.rank}
                  </span>

                  {artist.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-zinc-700"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                      {artist.name.charAt(0)}
                    </div>
                  )}

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={artist.spotifyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold text-white transition hover:text-[#1DB954]"
                      >
                        {artist.name}
                      </a>

                      {/* Disambiguation badge when another artist has the same name */}
                      {hasNameCollision && (
                        <span
                          data-testid={`name-collision-badge-${artist.id}`}
                          className="rounded border border-amber-800/40 bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
                          title="An artist preference with this name already exists in your profile. Adding this will register it as a distinct Spotify artist."
                        >
                          Distinct Act
                        </span>
                      )}

                      {/* Trend Badge */}
                      {artist.trend === 'rising' && (
                        <span
                          data-testid="trend-badge-rising"
                          className="rounded-full border border-emerald-800/40 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
                        >
                          ▲ Rising
                        </span>
                      )}
                      {artist.trend === 'consistent' && (
                        <span
                          data-testid="trend-badge-consistent"
                          className="rounded-full border border-indigo-800/40 bg-indigo-950/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-400"
                        >
                          ● Consistent Staple
                        </span>
                      )}
                      {artist.trend === 'fading' && (
                        <span
                          data-testid="trend-badge-fading"
                          className="rounded-full border border-amber-800/40 bg-amber-950/60 px-2 py-0.5 text-[10px] font-semibold text-amber-400"
                        >
                          ▼ Historical Favorite
                        </span>
                      )}
                    </div>

                    {artist.genres.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-zinc-400">
                        {artist.genres.slice(0, 3).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Status or Import Action */}
                <div className="flex flex-wrap items-center gap-2">
                  {existingPref ? (
                    <span
                      data-testid={`already-saved-badge-${artist.id}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300"
                    >
                      {existingPref.preferenceLevel === 'favorite' &&
                        '★ Favorite'}
                      {existingPref.preferenceLevel === 'like' && '♥ Liked'}
                      {existingPref.preferenceLevel === 'interested' &&
                        '✦ Interested'}
                      {existingPref.preferenceLevel === 'dislike' &&
                        '⊘ Disliked'}
                    </span>
                  ) : isAddingThis ? (
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Preference level for artist"
                        value={selectedLevel}
                        onChange={(e) =>
                          setSelectedLevel(e.target.value as PreferenceLevel)
                        }
                        className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs font-medium text-white focus:outline-none"
                      >
                        <option value="favorite">★ Favorite</option>
                        <option value="like">♥ Like</option>
                        <option value="interested">✦ Interested</option>
                      </select>
                      <button
                        type="button"
                        data-testid={`confirm-import-btn-${artist.id}`}
                        onClick={() => handleConfirmAdd(artist)}
                        disabled={isSubmittingThis}
                        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {isSubmittingThis ? 'Adding...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddingArtistId(null)}
                        className="rounded-lg border border-zinc-700 bg-transparent px-2 py-1 text-xs font-medium text-zinc-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`import-artist-btn-${artist.id}`}
                      onClick={() => {
                        setAddingArtistId(artist.id);
                        setSelectedLevel('favorite');
                      }}
                      className="rounded-lg border border-indigo-900/60 bg-indigo-950/40 px-3 py-1.5 text-xs font-semibold text-indigo-300 transition-colors hover:border-indigo-700 hover:bg-indigo-900/60 hover:text-white"
                    >
                      + Add to Interests
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Spotify Compliance Attribution */}
      <div className="flex flex-col gap-2 pt-2 text-[11px] text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
        <div>
          Artist data and listening metrics provided via Spotify Web API.
        </div>
        <div>Encore Music Taste · Optional Enrichment</div>
      </div>
    </div>
  );
}
