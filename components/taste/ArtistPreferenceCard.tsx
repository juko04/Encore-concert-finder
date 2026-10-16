/* eslint-disable @next/next/no-img-element */
'use client';

import React from 'react';
import type {
  PreferenceLevel,
  UserArtistPreference,
} from '@/lib/domain/user-preference';
import { PreferenceLevelBadge } from './PreferenceLevelBadge';

interface ArtistPreferenceCardProps {
  preference: UserArtistPreference;
  onUpdateLevel: (
    preference: UserArtistPreference,
    newLevel: PreferenceLevel,
  ) => void;
  onDelete: (preferenceId: string) => void;
  isUpdating?: boolean;
}

export function ArtistPreferenceCard({
  preference,
  onUpdateLevel,
  onDelete,
  isUpdating = false,
}: ArtistPreferenceCardProps) {
  const isCatalogMatched = Boolean(preference.artistId);

  return (
    <div
      data-testid={`preference-card-${preference.id}`}
      className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4 transition-all hover:border-zinc-700 sm:flex-row sm:items-center"
    >
      <div className="flex items-center gap-3.5">
        {preference.canonicalArtist?.imageUrl ? (
          <img
            src={preference.canonicalArtist.imageUrl}
            alt=""
            className="h-10 w-10 flex-shrink-0 rounded-full object-cover ring-1 ring-zinc-700"
          />
        ) : (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-950 font-bold text-indigo-300 ring-1 ring-indigo-800/60">
            {preference.artistName.slice(0, 1).toUpperCase()}
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3
              data-testid={`artist-name-${preference.id}`}
              className="text-base font-semibold text-white"
            >
              {preference.artistName}
            </h3>

            {preference.id.startsWith('demo-') ? (
              <span
                data-testid={`demo-badge-${preference.id}`}
                className="inline-flex items-center rounded-md border border-amber-800/60 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
              >
                Simulated Preview
              </span>
            ) : isCatalogMatched ? (
              <span
                data-testid={`catalog-badge-${preference.id}`}
                className="inline-flex items-center rounded-md border border-emerald-800/50 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
              >
                In Catalog
              </span>
            ) : (
              <span
                data-testid={`catalog-badge-${preference.id}`}
                className="inline-flex items-center rounded-md border border-zinc-700/60 bg-zinc-800/50 px-2 py-0.5 text-[10px] font-medium text-zinc-400"
              >
                Not in Catalog
              </span>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
            <span>Preference:</span>
            <PreferenceLevelBadge level={preference.preferenceLevel} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/60 pt-3 sm:border-t-0 sm:pt-0">
        <label htmlFor={`select-level-${preference.id}`} className="sr-only">
          Change preference level for {preference.artistName}
        </label>
        <select
          id={`select-level-${preference.id}`}
          data-testid={`select-level-${preference.id}`}
          value={preference.preferenceLevel}
          disabled={isUpdating}
          onChange={(e) =>
            onUpdateLevel(preference, e.target.value as PreferenceLevel)
          }
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-zinc-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
        >
          <option value="favorite">★ Favorite (Must-see)</option>
          <option value="like">♥ Like (Want to see)</option>
          <option value="interested">✦ Interested (Discover)</option>
          <option value="dislike">⊘ Dislike (Not interested)</option>
        </select>

        <button
          type="button"
          data-testid={`delete-pref-btn-${preference.id}`}
          disabled={isUpdating}
          onClick={() => onDelete(preference.id)}
          aria-label={`Remove ${preference.artistName} from preferences`}
          className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-1.5 text-zinc-400 transition-colors hover:border-red-900/60 hover:bg-red-950/30 hover:text-red-400 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
