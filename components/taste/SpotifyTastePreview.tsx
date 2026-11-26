'use client';

import { Select } from '@/components/ui/Select';
import React, { useState } from 'react';
import type { SpotifyTimeRange, SpotifyTopArtist } from '@/lib/domain/spotify';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';

/** Spotify returns at most 50 artists per listening window. */
const MAX_RANK = 50;
const RANK_WINDOWS: Array<{ key: SpotifyTimeRange; label: string }> = [
  { key: 'short_term', label: '4 wk' },
  { key: 'medium_term', label: '6 mo' },
  { key: 'long_term', label: '1 yr' },
];

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
  /** True when showing the durable saved snapshot (Spotify disconnected/expired). */
  isStoredSnapshot?: boolean;
  storedSyncedAt?: string | null;
  /** Shown instead of the generic empty text (e.g. stored data has no rank for this window). */
  emptyMessage?: string | null;
  error?: string | null;
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
  isStoredSnapshot = false,
  storedSyncedAt = null,
  emptyMessage = null,
  error = null,
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
      className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-6 backdrop-blur"
    >
      {/* Header and Time Range Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-zinc-900">
              Spotify Listening History
            </h3>
            {isStoredSnapshot && !isSyntheticPreview && (
              <span
                data-testid="stored-snapshot-pill"
                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
              >
                Imported from Spotify
                {storedSyncedAt
                  ? ` · saved ${new Date(storedSyncedAt).toISOString().slice(0, 10)}`
                  : ''}
              </span>
            )}
            {isSyntheticPreview && (
              <span
                data-testid="synthetic-preview-pill"
                className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700"
              >
                Synthetic Demo
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Spotify affinity scoring is ready to rank concerts (scores 60–70) as
            verified Spotify artist IDs match in our catalog. Set an explicit
            preference below to guarantee priority right away:
            <strong> ★ Favorite (100)</strong> or <strong>♥ Like (75)</strong>{' '}
            immediately elevates the artist; <strong>✦ Interested (55)</strong>{' '}
            sets a lower exploratory priority.
          </p>
        </div>

        {/* Time Horizon Tabs */}
        <div
          data-testid="time-range-tabs"
          className="flex rounded-lg border border-zinc-200 bg-white p-1"
        >
          <button
            type="button"
            data-testid="tab-short-term"
            onClick={() => onChangeTimeRange('short_term')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              timeRange === 'short_term'
                ? 'bg-zinc-100 text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
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
                ? 'bg-zinc-100 text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
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
                ? 'bg-zinc-100 text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            All-Time / 1 Year
          </button>
        </div>
      </div>

      {/* Recency Hypothesis Explanation Banner */}
      <div
        data-testid="recency-hypothesis-banner"
        className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-700"
      >
        <div className="flex items-start gap-2.5">
          <span className="text-base">✦</span>
          <div>
            <strong className="font-semibold text-indigo-900">
              Recency-Weighted Taste Hypothesis:
            </strong>{' '}
            Spotify listening affinity scoring is built in and will
            automatically score concerts as verified Spotify artist IDs match in
            our catalog. You can add any artist below to an explicit preference
            tier (★ Favorite / ♥ Like) to give them immediate guaranteed
            priority.
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
      ) : error ? (
        <div
          data-testid="spotify-preview-error-state"
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-xs text-red-800"
        >
          {error}
        </div>
      ) : artists.length === 0 ? (
        <div
          data-testid="spotify-taste-empty"
          className="rounded-xl border border-dashed border-zinc-200 p-8 text-center text-xs text-zinc-500"
        >
          {emptyMessage ?? 'No top artists returned for this time window.'}
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-zinc-50">
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
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3.5">
                  <span
                    data-testid={`spotify-rank-${artist.id}`}
                    title={`Spotify ranks this as your #${artist.rank} most-listened artist in the selected window (out of ${MAX_RANK})`}
                    className="w-14 shrink-0 text-right font-mono text-xs font-bold leading-tight text-zinc-700"
                  >
                    #{artist.rank}
                    <span className="block text-[10px] font-medium text-zinc-400">
                      of {MAX_RANK}
                    </span>
                  </span>

                  {artist.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={artist.imageUrl}
                      alt={artist.name}
                      className="h-10 w-10 rounded-full object-cover ring-1 ring-zinc-200"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-700">
                      {artist.name.charAt(0)}
                    </div>
                  )}

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={artist.spotifyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-bold text-zinc-900 transition hover:text-[#1DB954]"
                      >
                        {artist.name}
                      </a>

                      {/* Disambiguation badge when another artist has the same name */}
                      {hasNameCollision && (
                        <span
                          data-testid={`name-collision-badge-${artist.id}`}
                          className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                          title="An artist preference with this name already exists in your profile. Adding this will register it as a distinct Spotify artist."
                        >
                          Distinct Act
                        </span>
                      )}

                      {/* Trend Badge */}
                      {artist.trend === 'rising' && (
                        <span
                          data-testid="trend-badge-rising"
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                        >
                          ▲ Rising
                        </span>
                      )}
                      {artist.trend === 'consistent' && (
                        <span
                          data-testid="trend-badge-consistent"
                          className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600"
                        >
                          ● Consistent Staple
                        </span>
                      )}
                      {artist.trend === 'fading' && (
                        <span
                          data-testid="trend-badge-fading"
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                        >
                          ▼ Historical Favorite
                        </span>
                      )}
                    </div>

                    {artist.genres.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {artist.genres.slice(0, 3).join(' · ')}
                      </p>
                    )}

                    {/* Rank in every Spotify window + the Encore affinity derived from them,
                        so the listening data can be checked against Spotify directly. */}
                    {artist.ranksByRange && (
                      <p
                        data-testid={`spotify-window-ranks-${artist.id}`}
                        className="mt-1 font-mono text-[10px] text-zinc-500"
                      >
                        {RANK_WINDOWS.map(({ key, label }) => {
                          const r = artist.ranksByRange?.[key];
                          return (
                            <span key={key} className="mr-2.5 inline-block">
                              {label}{' '}
                              <strong
                                className={
                                  r ? 'text-zinc-800' : 'text-zinc-400'
                                }
                              >
                                {r ? `#${r}` : '—'}
                              </strong>
                              <span className="text-zinc-400">/{MAX_RANK}</span>
                            </span>
                          );
                        })}
                        {typeof artist.affinity === 'number' && (
                          <span
                            data-testid={`spotify-affinity-${artist.id}`}
                            title={artist.affinityReason}
                            className="inline-block text-indigo-700"
                          >
                            Encore affinity{' '}
                            <strong>{Math.round(artist.affinity * 100)}</strong>
                            /100
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                {/* Status or Import Action */}
                <div className="flex flex-wrap items-center gap-2">
                  {existingPref ? (
                    <span
                      data-testid={`already-saved-badge-${artist.id}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700"
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
                    <div className="flex flex-col gap-1.5 sm:items-end">
                      <div className="flex items-center gap-2">
                        <Select
                          aria-label="Preference level for artist"
                          fullWidth={false}
                          value={selectedLevel}
                          onValueChange={(v) =>
                            setSelectedLevel(v as PreferenceLevel)
                          }
                          options={[
                            {
                              value: 'favorite',
                              label: '★ Favorite (100 — Max Priority)',
                            },
                            { value: 'like', label: '♥ Like (75 — Boost)' },
                            {
                              value: 'interested',
                              label: '✦ Interested (55 — Lower Priority)',
                            },
                          ]}
                        />
                        <button
                          type="button"
                          data-testid={`confirm-import-btn-${artist.id}`}
                          onClick={() => handleConfirmAdd(artist)}
                          disabled={isSubmittingThis}
                          className="rounded-lg bg-zinc-900 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-zinc-800 disabled:opacity-50"
                        >
                          {isSubmittingThis ? 'Adding...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddingArtistId(null)}
                          className="rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
                        >
                          Cancel
                        </button>
                      </div>
                      {selectedLevel === 'interested' && (
                        <p className="text-[10px] text-amber-700">
                          Notice: Setting &quot;Interested&quot; (score 55) sets
                          priority lower than your automated Spotify listening
                          affinity (60–70).
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid={`import-artist-btn-${artist.id}`}
                      onClick={() => {
                        setAddingArtistId(artist.id);
                        setSelectedLevel('favorite');
                      }}
                      className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100 hover:text-zinc-900"
                    >
                      + Set Priority
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
