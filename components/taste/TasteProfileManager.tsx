'use client';

import React, { useEffect, useState, useTransition } from 'react';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';
import type {
  SpotifyConnectionStatus,
  SpotifyTimeRange,
  SpotifyTopArtist,
} from '@/lib/domain/spotify';
import { ArtistSearchInput, type SelectedArtist } from './ArtistSearchInput';
import { ArtistPreferenceCard } from './ArtistPreferenceCard';
import { SpotifyConnectionCard } from './SpotifyConnectionCard';
import { SpotifyTastePreview } from './SpotifyTastePreview';
import {
  deletePreferenceAction,
  disconnectSpotifyAction,
  getSpotifyTopArtistsAction,
  savePreferenceAction,
  updatePreferenceLevelAction,
} from '@/app/profile/taste/actions';

export interface InitialSpotifyStatus {
  connected: boolean;
  spotifyAccountId?: string;
  status?: SpotifyConnectionStatus;
  lastSyncedAt?: string | null;
  isConfigured: boolean;
}

interface TasteProfileManagerProps {
  initialPreferences: UserArtistPreference[];
  userEmail?: string;
  initialSpotifyStatus?: InitialSpotifyStatus;
  spotifyBanner?: {
    type: 'success' | 'error';
    message: string;
  } | null;
}

type FilterTier = 'all' | PreferenceLevel;

export function TasteProfileManager({
  initialPreferences,
  userEmail,
  initialSpotifyStatus = { connected: false, isConfigured: false },
  spotifyBanner = null,
}: TasteProfileManagerProps) {
  const [preferences, setPreferences] =
    useState<UserArtistPreference[]>(initialPreferences);
  const [filter, setFilter] = useState<FilterTier>('all');
  const [selectedArtist, setSelectedArtist] = useState<SelectedArtist | null>(
    null,
  );
  const [addLevel, setAddLevel] = useState<PreferenceLevel>('favorite');
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(spotifyBanner);
  const [isPending, startTransition] = useTransition();

  // Spotify state
  const [spotifyStatus, setSpotifyStatus] =
    useState<InitialSpotifyStatus>(initialSpotifyStatus);
  const [isSyntheticDemo, setIsSyntheticDemo] = useState<boolean>(false);
  const [isSyntheticResult, setIsSyntheticResult] = useState<boolean>(false);
  const [simulatedDemoPreferences, setSimulatedDemoPreferences] = useState<
    UserArtistPreference[]
  >([]);
  const [spotifyTimeRange, setSpotifyTimeRange] =
    useState<SpotifyTimeRange>('short_term');
  const [spotifyArtists, setSpotifyArtists] = useState<SpotifyTopArtist[]>([]);
  const [isLoadingSpotify, setIsLoadingSpotify] = useState<boolean>(false);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
  const [spotifyPreviewError, setSpotifyPreviewError] = useState<string | null>(
    null,
  );

  // Load Spotify top artists whenever connected or demo mode changes
  useEffect(() => {
    const shouldFetch = spotifyStatus.connected || isSyntheticDemo;
    if (!shouldFetch) {
      setSpotifyArtists([]);
      setIsSyntheticResult(false);
      setSpotifyPreviewError(null);
      return;
    }

    let isSubscribed = true;
    setIsLoadingSpotify(true);

    getSpotifyTopArtistsAction(spotifyTimeRange, isSyntheticDemo)
      .then((res) => {
        if (!isSubscribed) return;
        setSpotifyArtists(res.artists);
        setIsSyntheticResult(Boolean(res.isSyntheticPreview));
        if (res.error) {
          setError(res.error);
          setSpotifyPreviewError(res.error);
        } else {
          setSpotifyPreviewError(null);
        }
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.error('Failed to load Spotify artists:', err);
        const fallbackMsg = 'Failed to load Spotify artists. Please try again.';
        setError(fallbackMsg);
        setSpotifyPreviewError(fallbackMsg);
      })
      .finally(() => {
        if (isSubscribed) {
          setIsLoadingSpotify(false);
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, [spotifyStatus.connected, isSyntheticDemo, spotifyTimeRange]);

  const filteredPreferences = preferences.filter((pref) => {
    if (filter === 'all') return true;
    return pref.preferenceLevel === filter;
  });

  const countByTier = {
    all: preferences.length,
    favorite: preferences.filter((p) => p.preferenceLevel === 'favorite')
      .length,
    like: preferences.filter((p) => p.preferenceLevel === 'like').length,
    interested: preferences.filter((p) => p.preferenceLevel === 'interested')
      .length,
    dislike: preferences.filter((p) => p.preferenceLevel === 'dislike').length,
  };

  function handleSelectArtist(artist: SelectedArtist) {
    setSelectedArtist(artist);
    setError(null);
  }

  function handleConfirmAdd() {
    if (!selectedArtist) return;

    setError(null);
    const artistToAdd = { ...selectedArtist };
    const levelToAdd = addLevel;

    startTransition(async () => {
      try {
        const result = await savePreferenceAction({
          artistId: artistToAdd.id,
          artistName: artistToAdd.name,
          preferenceLevel: levelToAdd,
        });

        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.preference) {
          const saved = result.preference;
          setPreferences((prev) => {
            const index = prev.findIndex((p) => p.id === saved.id);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = saved;
              return updated;
            }
            return [saved, ...prev];
          });
          setSelectedArtist(null);
        }
      } catch {
        setError('Failed to save artist preference. Please try again.');
      }
    });
  }

  async function handleAddSpotifyArtistToInterests(
    artist: SpotifyTopArtist,
    level: PreferenceLevel,
  ): Promise<void> {
    setError(null);
    try {
      if (isSyntheticDemo || isSyntheticResult) {
        // Isolated demo simulation: keep synthetic observations in dedicated demo state
        const simulatedPref: UserArtistPreference = {
          id: `demo-${artist.id}-${Date.now()}`,
          userId: userEmail || 'demo-user',
          artistId: null,
          artistName: artist.name,
          normalizedArtistName: artist.name.toLowerCase().trim(),
          preferenceLevel: level,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          spotifyArtistId: artist.id,
        };
        setSimulatedDemoPreferences((prev) => {
          const filtered = prev.filter((p) => p.spotifyArtistId !== artist.id);
          return [simulatedPref, ...filtered];
        });
        return;
      }

      const result = await savePreferenceAction({
        artistName: artist.name,
        preferenceLevel: level,
        spotifyArtistId: artist.id,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.preference) {
        const saved = result.preference;
        setPreferences((prev) => {
          const index = prev.findIndex((p) => p.id === saved.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = saved;
            return updated;
          }
          return [saved, ...prev];
        });
      }
    } catch {
      setError('Failed to import artist to live preferences.');
    }
  }

  function handleUpdateLevel(
    preference: UserArtistPreference,
    newLevel: PreferenceLevel,
  ) {
    setError(null);
    const prevPreferences = [...preferences];

    setPreferences((prev) =>
      prev.map((p) =>
        p.id === preference.id ? { ...p, preferenceLevel: newLevel } : p,
      ),
    );

    startTransition(async () => {
      try {
        const result = await updatePreferenceLevelAction({
          preferenceId: preference.id,
          preferenceLevel: newLevel,
        });

        if (result.error) {
          setError(result.error);
          setPreferences(prevPreferences);
        } else if (result.preference) {
          const updated = result.preference;
          setPreferences((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p)),
          );
        }
      } catch {
        setError('Failed to update preference level.');
        setPreferences(prevPreferences);
      }
    });
  }

  function handleDelete(preferenceId: string) {
    setError(null);
    const prevPreferences = [...preferences];

    setPreferences((prev) => prev.filter((p) => p.id !== preferenceId));

    startTransition(async () => {
      try {
        const result = await deletePreferenceAction(preferenceId);
        if (result.error) {
          setError(result.error);
          setPreferences(prevPreferences);
        }
      } catch {
        setError('Failed to remove preference.');
        setPreferences(prevPreferences);
      }
    });
  }

  function handleToggleDemoMode() {
    setError(null);
    setSpotifyPreviewError(null);
    setIsSyntheticDemo((prev) => {
      const next = !prev;
      if (!next) {
        // Exiting demo mode: discard simulated selections while retaining all actual saved preferences
        setSimulatedDemoPreferences([]);
      }
      return next;
    });
  }

  async function handleDisconnectSpotify(): Promise<void> {
    setIsDisconnecting(true);
    setError(null);
    try {
      const result = await disconnectSpotifyAction();
      if (result.success) {
        setSpotifyStatus({
          connected: false,
          status: 'disconnected',
          spotifyAccountId: undefined,
          lastSyncedAt: null,
          isConfigured: spotifyStatus.isConfigured,
        });
        setSpotifyArtists([]);
        setIsSyntheticDemo(false);
        setSimulatedDemoPreferences([]);
      } else if (result.error) {
        setError(result.error);
      }
    } catch {
      setError('Failed to disconnect Spotify.');
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <div className="space-y-8" data-testid="taste-profile-manager">
      {/* Dynamic Status / Error Banner */}
      {banner && (
        <div
          data-testid="spotify-status-banner"
          className={`flex items-start justify-between rounded-xl p-4 text-xs ${
            banner.type === 'success'
              ? 'border border-emerald-800/60 bg-emerald-950/40 text-emerald-200'
              : 'border border-red-800/60 bg-red-950/40 text-red-200'
          }`}
        >
          <div>{banner.message}</div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-zinc-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Spotify Connection & Preview Section */}
      <section className="space-y-4">
        <SpotifyConnectionCard
          connected={spotifyStatus.connected}
          spotifyAccountId={spotifyStatus.spotifyAccountId}
          status={spotifyStatus.status}
          lastSyncedAt={spotifyStatus.lastSyncedAt}
          isConfigured={spotifyStatus.isConfigured}
          isSyntheticDemo={isSyntheticDemo}
          onToggleDemoMode={handleToggleDemoMode}
          onDisconnect={handleDisconnectSpotify}
          isDisconnecting={isDisconnecting}
        />

        {(spotifyStatus.connected || isSyntheticDemo) && (
          <SpotifyTastePreview
            artists={spotifyArtists}
            timeRange={spotifyTimeRange}
            onChangeTimeRange={setSpotifyTimeRange}
            existingPreferences={[...preferences, ...simulatedDemoPreferences]}
            onAddPreference={handleAddSpotifyArtistToInterests}
            isLoading={isLoadingSpotify}
            isSyntheticPreview={isSyntheticResult || isSyntheticDemo}
            error={spotifyPreviewError}
          />
        )}
      </section>

      {/* Isolated Interactive Preview Simulation Box */}
      {isSyntheticDemo && simulatedDemoPreferences.length > 0 && (
        <div
          data-testid="simulated-demo-preferences-container"
          className="rounded-2xl border border-amber-900/60 bg-amber-950/20 p-5 backdrop-blur"
        >
          <div className="flex flex-col gap-2 border-b border-amber-900/40 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Interactive Preview Simulation
                </span>
                <span className="text-xs font-medium text-amber-200/80">
                  ({simulatedDemoPreferences.length} simulated selection
                  {simulatedDemoPreferences.length > 1 ? 's' : ''})
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                Simulated selections are kept separate from your actual saved
                profile and will be discarded when exiting demo mode.
              </p>
            </div>
            <button
              type="button"
              data-testid="clear-demo-selections-btn"
              onClick={() => setSimulatedDemoPreferences([])}
              className="text-xs text-zinc-400 underline hover:text-amber-300"
            >
              Clear Simulated
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            {simulatedDemoPreferences.map((simPref) => (
              <ArtistPreferenceCard
                key={simPref.id}
                preference={simPref}
                onUpdateLevel={(pref, newLevel) => {
                  setSimulatedDemoPreferences((prev) =>
                    prev.map((p) =>
                      p.id === pref.id
                        ? { ...p, preferenceLevel: newLevel }
                        : p,
                    ),
                  );
                }}
                onDelete={(id) => {
                  setSimulatedDemoPreferences((prev) =>
                    prev.filter((p) => p.id !== id),
                  );
                }}
                isUpdating={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Search and Add Area */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 backdrop-blur">
        <h2 className="text-base font-semibold text-white">
          Add Artist to Live Music Taste Profile
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Search upcoming concert artists or enter any artist you listen to.
        </p>

        <div className="mt-4">
          <ArtistSearchInput
            onSelectArtist={handleSelectArtist}
            disabled={isPending}
          />
        </div>

        {/* Selected artist confirmation modal/panel */}
        {selectedArtist && (
          <div
            data-testid="add-artist-dialog"
            className="mt-4 rounded-xl border border-indigo-900/60 bg-indigo-950/30 p-4"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider text-indigo-400">
                  Selected Artist
                </span>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">
                    {selectedArtist.name}
                  </h3>
                  {selectedArtist.id ? (
                    <span className="rounded border border-indigo-800/40 bg-indigo-950 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                      In Catalog
                    </span>
                  ) : (
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                      Not in Catalog
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label htmlFor="modal-pref-level" className="sr-only">
                    Preference Level
                  </label>
                  <select
                    id="modal-pref-level"
                    data-testid="modal-pref-level-select"
                    value={addLevel}
                    onChange={(e) =>
                      setAddLevel(e.target.value as PreferenceLevel)
                    }
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="favorite">★ Favorite (Must-see)</option>
                    <option value="like">♥ Like (Want to see)</option>
                    <option value="interested">✦ Interested (Discover)</option>
                    <option value="dislike">⊘ Dislike (Not interested)</option>
                  </select>
                </div>

                <button
                  type="button"
                  data-testid="confirm-add-btn"
                  onClick={handleConfirmAdd}
                  disabled={isPending}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : 'Save Preference'}
                </button>

                <button
                  type="button"
                  data-testid="cancel-add-btn"
                  onClick={() => setSelectedArtist(null)}
                  disabled={isPending}
                  className="rounded-lg border border-zinc-700 bg-transparent px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div
          data-testid="profile-error-alert"
          role="alert"
          className="rounded-xl border border-red-800/60 bg-red-950/40 p-4 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {/* Tabs and Preference List */}
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
            {(
              [
                ['all', 'All', countByTier.all],
                ['favorite', 'Favorites', countByTier.favorite],
                ['like', 'Liked', countByTier.like],
                ['interested', 'Interested', countByTier.interested],
                ['dislike', 'Disliked', countByTier.dislike],
              ] as const
            ).map(([tierKey, label, count]) => (
              <button
                key={tierKey}
                type="button"
                data-testid={`filter-tab-${tierKey}`}
                onClick={() => setFilter(tierKey)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === tierKey
                    ? 'bg-zinc-800 font-semibold text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {label} ({count})
              </button>
            ))}
          </div>

          {userEmail && (
            <div className="text-xs text-zinc-500">
              Preferences synced for{' '}
              <span className="font-mono text-zinc-400">{userEmail}</span>
            </div>
          )}
        </div>

        <div className="mt-6">
          {filteredPreferences.length === 0 ? (
            <div
              data-testid="empty-preferences-view"
              className="rounded-xl border border-dashed border-zinc-800 p-12 text-center"
            >
              <h3 className="text-sm font-semibold text-zinc-300">
                {filter === 'all'
                  ? 'No artist preferences added yet'
                  : `No artists marked as "${filter}"`}
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                {filter === 'all'
                  ? 'Use the search bar above to add your favorite live music artists.'
                  : `Select another tab or add an artist above to see them here.`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredPreferences.map((pref) => (
                <ArtistPreferenceCard
                  key={pref.id}
                  preference={pref}
                  onUpdateLevel={handleUpdateLevel}
                  onDelete={handleDelete}
                  isUpdating={isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
