'use client';

import React, { useState, useTransition } from 'react';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';
import { ArtistSearchInput, type SelectedArtist } from './ArtistSearchInput';
import { ArtistPreferenceCard } from './ArtistPreferenceCard';
import {
  deletePreferenceAction,
  savePreferenceAction,
  updatePreferenceLevelAction,
} from '@/app/profile/taste/actions';

interface TasteProfileManagerProps {
  initialPreferences: UserArtistPreference[];
  userEmail?: string;
}

type FilterTier = 'all' | PreferenceLevel;

export function TasteProfileManager({
  initialPreferences,
  userEmail,
}: TasteProfileManagerProps) {
  const [preferences, setPreferences] =
    useState<UserArtistPreference[]>(initialPreferences);
  const [filter, setFilter] = useState<FilterTier>('all');
  const [selectedArtist, setSelectedArtist] = useState<SelectedArtist | null>(
    null,
  );
  const [addLevel, setAddLevel] = useState<PreferenceLevel>('favorite');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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

  function handleUpdateLevel(
    preference: UserArtistPreference,
    newLevel: PreferenceLevel,
  ) {
    setError(null);
    const prevPreferences = [...preferences];

    // Optimistic update by preference ID
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
          setPreferences(prevPreferences); // Rollback
        } else if (result.preference) {
          const updated = result.preference;
          setPreferences((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p)),
          );
        }
      } catch {
        setError('Failed to update preference level.');
        setPreferences(prevPreferences); // Rollback
      }
    });
  }

  function handleDelete(preferenceId: string) {
    setError(null);
    const prevPreferences = [...preferences];

    // Optimistic delete
    setPreferences((prev) => prev.filter((p) => p.id !== preferenceId));

    startTransition(async () => {
      try {
        const result = await deletePreferenceAction(preferenceId);
        if (result.error) {
          setError(result.error);
          setPreferences(prevPreferences); // Rollback
        }
      } catch {
        setError('Failed to remove preference.');
        setPreferences(prevPreferences); // Rollback
      }
    });
  }

  return (
    <div className="space-y-8" data-testid="taste-profile-manager">
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
