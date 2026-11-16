'use client';

import React, { useState } from 'react';
import { usePrototypeStore } from '@/lib/prototypes/store';
import {
  SparklesIcon,
  StarIcon,
  HeartIcon,
  BanIcon,
  XIcon,
  InfoIcon,
} from '@/components/prototypes/index/icons';

export default function PreferencesPage() {
  const {
    preferences,
    setArtistPreference,
    removeArtistPreference,
    resetToDemoDefaults,
  } = usePrototypeStore();

  const [newArtistName, setNewArtistName] = useState('');
  const [newArtistLevel, setNewArtistLevel] = useState<
    'favorite' | 'like' | 'ignore'
  >('favorite');

  const favorites = preferences.filter((p) => p.level === 'favorite');
  const likes = preferences.filter((p) => p.level === 'like');
  const ignores = preferences.filter((p) => p.level === 'ignore');

  const handleAddArtist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArtistName.trim()) return;

    const id = `art-custom-${newArtistName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    setArtistPreference(id, newArtistName.trim(), newArtistLevel);
    setNewArtistName('');
  };

  const quickSuggestions = [
    { name: 'Silver Lake Dreamers', defaultLevel: 'like' as const },
    { name: 'Hania Rani', defaultLevel: 'favorite' as const },
    { name: 'Fontaines D.C.', defaultLevel: 'favorite' as const },
    { name: 'Bonobo', defaultLevel: 'like' as const },
  ];

  return (
    <div className="space-y-10 pb-16">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200/80 pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
            <SparklesIcon className="h-3.5 w-3.5 text-indigo-600" />
            <span>Taste Profile & Lineup Rules</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">
            Artist Preferences
          </h1>
          <p className="mt-1 max-w-xl text-xs text-zinc-500 sm:text-sm">
            Explicit taste overrides algorithms. Favorite artists boost event
            scores; ignored artists are suppressed from recommendations per
            Invariant 11.
          </p>
        </div>

        <button
          type="button"
          onClick={resetToDemoDefaults}
          className="self-start font-mono text-xs text-zinc-500 hover:text-zinc-900 hover:underline sm:self-auto"
        >
          Reset Profile to Demo Defaults
        </button>
      </div>

      {/* Invariant 11 Educational Box */}
      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-5 text-xs text-zinc-700">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <InfoIcon className="h-4 w-4 text-zinc-600" />
          <span>
            Engineering Invariant 11: Preference Precedence & Suppression
          </span>
        </div>
        <p className="leading-relaxed text-zinc-600">
          Explicit manual user preferences strictly take precedence over
          inferred external signals. Lineup suppression follows deterministic
          rules:
        </p>
        <ul className="grid grid-cols-1 gap-2.5 pt-1 text-[11px] md:grid-cols-3">
          <li className="rounded-xl border border-zinc-200/80 bg-white p-3">
            <span className="mb-1 block font-semibold text-rose-700">
              Disliked Headliner
            </span>
            Always completely suppresses the concert from recommendations and
            discovery feeds.
          </li>
          <li className="rounded-xl border border-zinc-200/80 bg-white p-3">
            <span className="mb-1 block font-semibold text-amber-700">
              Disliked Support Act
            </span>
            Generally suppresses the event unless an explicitly Favorite
            headliner overrides it.
          </li>
          <li className="rounded-xl border border-zinc-200/80 bg-white p-3">
            <span className="mb-1 block font-semibold text-indigo-700">
              Favorite Override
            </span>
            An explicitly Favorite headliner overrides disliked openers —
            scoring 100 with zero suppression.
          </li>
        </ul>
      </div>

      {/* Add New Artist Form */}
      <section className="shadow-xs space-y-4 rounded-3xl border border-zinc-200/90 bg-white p-6">
        <h2 className="text-base font-bold text-zinc-900">
          Add Artist to Taste Profile
        </h2>

        <form
          onSubmit={handleAddArtist}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="text"
            value={newArtistName}
            onChange={(e) => setNewArtistName(e.target.value)}
            placeholder="Type artist or band name (e.g. Alvvays, Beach Fossils)..."
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />

          <select
            value={newArtistLevel}
            onChange={(e) =>
              setNewArtistLevel(
                e.target.value as 'favorite' | 'like' | 'ignore',
              )
            }
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-800 focus:border-zinc-900 focus:outline-none"
          >
            <option value="favorite">Favorite (Top Priority)</option>
            <option value="like">Like (Boost Rank)</option>
            <option value="ignore">Ignore / Dislike (Suppress)</option>
          </select>

          <button
            type="submit"
            className="shadow-xs inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 active:scale-[0.97]"
          >
            <span>Add Artist</span>
          </button>
        </form>

        {/* Quick Suggestion Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
            Quick additions:
          </span>
          {quickSuggestions.map((sug) => {
            const isAlreadyAdded = preferences.some(
              (p) => p.artistName.toLowerCase() === sug.name.toLowerCase(),
            );
            if (isAlreadyAdded) return null;
            return (
              <button
                key={sug.name}
                type="button"
                onClick={() =>
                  setArtistPreference(
                    `art-${sug.name.toLowerCase().replace(/\s+/g, '-')}`,
                    sug.name,
                    sug.defaultLevel,
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              >
                <span>+ {sug.name}</span>
                <span className="text-[10px] text-zinc-400">
                  ({sug.defaultLevel})
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3 Preference Categories: Favorites, Likes, Ignores */}
      <div className="space-y-8">
        {/* 1. Favorite Artists */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-200/80 pb-2">
            <div className="flex items-center gap-2">
              <StarIcon className="h-4 w-4 text-amber-500" filled />
              <h2 className="text-lg font-bold text-zinc-900">
                Favorite Artists ({favorites.length})
              </h2>
            </div>
            <span className="font-mono text-xs text-zinc-400">
              Top billing priority · Presale alerts
            </span>
          </div>

          {favorites.length === 0 ? (
            <p className="py-4 text-xs italic text-zinc-400">
              No favorite artists added yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {favorites.map((artist) => (
                <div
                  key={artist.artistId}
                  className="group flex items-center justify-between gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/40 p-4 transition-all hover:bg-amber-50/70"
                >
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">
                      {artist.artistName}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      Source: {artist.source}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Move to Like */}
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          artist.artistId,
                          artist.artistName,
                          'like',
                        )
                      }
                      title="Change to Like"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white hover:text-indigo-600"
                      aria-label={`Change ${artist.artistName} to liked`}
                    >
                      <HeartIcon className="h-4 w-4" />
                    </button>

                    {/* Move to Ignore */}
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          artist.artistId,
                          artist.artistName,
                          'ignore',
                        )
                      }
                      title="Ignore and suppress"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white hover:text-rose-600"
                      aria-label={`Ignore ${artist.artistName}`}
                    >
                      <BanIcon className="h-4 w-4" />
                    </button>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeArtistPreference(artist.artistId)}
                      title="Remove from favorites"
                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700"
                      aria-label={`Remove ${artist.artistName}`}
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2. Liked Artists */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-200/80 pb-2">
            <div className="flex items-center gap-2">
              <HeartIcon className="h-4 w-4 text-indigo-500" filled />
              <h2 className="text-lg font-bold text-zinc-900">
                Liked Artists ({likes.length})
              </h2>
            </div>
            <span className="font-mono text-xs text-zinc-400">
              Rank boost in search & recommendations
            </span>
          </div>

          {likes.length === 0 ? (
            <p className="py-4 text-xs italic text-zinc-400">
              No liked artists added yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {likes.map((artist) => (
                <div
                  key={artist.artistId}
                  className="group flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition-all hover:bg-zinc-50"
                >
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">
                      {artist.artistName}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      Source: {artist.source}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Move to Favorite */}
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          artist.artistId,
                          artist.artistName,
                          'favorite',
                        )
                      }
                      title="Promote to Favorite"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-amber-600"
                      aria-label={`Promote ${artist.artistName} to favorite`}
                    >
                      <StarIcon className="h-4 w-4" />
                    </button>

                    {/* Move to Ignore */}
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          artist.artistId,
                          artist.artistName,
                          'ignore',
                        )
                      }
                      title="Ignore and suppress"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-rose-600"
                      aria-label={`Ignore ${artist.artistName}`}
                    >
                      <BanIcon className="h-4 w-4" />
                    </button>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeArtistPreference(artist.artistId)}
                      title="Remove preference"
                      className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                      aria-label={`Remove ${artist.artistName}`}
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 3. Ignored / Disliked Artists */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-200/80 pb-2">
            <div className="flex items-center gap-2">
              <BanIcon className="h-4 w-4 text-rose-500" />
              <h2 className="text-lg font-bold text-zinc-900">
                Ignored & Disliked Artists ({ignores.length})
              </h2>
            </div>
            <span className="font-mono text-xs text-zinc-400">
              Headliners completely suppressed (Invariant 11)
            </span>
          </div>

          {ignores.length === 0 ? (
            <p className="py-4 text-xs italic text-zinc-400">
              No artists currently ignored.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ignores.map((artist) => (
                <div
                  key={artist.artistId}
                  className="group flex items-center justify-between gap-3 rounded-2xl border border-rose-200/70 bg-rose-50/30 p-4 transition-all hover:bg-rose-50/60"
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
                      <span>{artist.artistName}</span>
                      <span className="py-0.2 rounded bg-rose-100 px-1 font-mono text-[9px] uppercase text-rose-700">
                        Suppressed
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      Disliked headliners hidden from feeds
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Move to Favorite */}
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          artist.artistId,
                          artist.artistName,
                          'favorite',
                        )
                      }
                      title="Move to Favorite"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white hover:text-amber-600"
                      aria-label={`Move ${artist.artistName} to favorite`}
                    >
                      <StarIcon className="h-4 w-4" />
                    </button>

                    {/* Move to Like */}
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          artist.artistId,
                          artist.artistName,
                          'like',
                        )
                      }
                      title="Move to Like"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white hover:text-indigo-600"
                      aria-label={`Move ${artist.artistName} to like`}
                    >
                      <HeartIcon className="h-4 w-4" />
                    </button>

                    {/* Un-ignore / Remove */}
                    <button
                      type="button"
                      onClick={() => removeArtistPreference(artist.artistId)}
                      title="Un-ignore / Remove restriction"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900"
                      aria-label={`Un-ignore ${artist.artistName}`}
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
