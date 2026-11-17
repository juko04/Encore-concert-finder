'use client';

import React, { useState } from 'react';
import { usePrototypeStore } from '@/lib/prototypes/store';

const SUGGESTED_ARTISTS = [
  {
    id: 'art-hania-rani',
    name: 'Hania Rani',
    genre: 'Neo-Classical / Ambient',
  },
  {
    id: 'art-fontaines',
    name: 'Fontaines D.C.',
    genre: 'Post-Punk / Alternative',
  },
  { id: 'art-alcapones', name: 'The Alcapones', genre: 'Ska / Balkan Brass' },
  { id: 'art-bonobo', name: 'Bonobo', genre: 'Electronic / Downtempo' },
  {
    id: 'art-yussef-dayes',
    name: 'Yussef Dayes',
    genre: 'Jazz Fusion / Groove',
  },
  {
    id: 'art-silver-lake',
    name: 'Silver Lake Dreamers',
    genre: 'Indie Rock / Shoegaze',
  },
];

export default function TasteSignalPage() {
  const {
    preferences,
    setArtistPreference,
    removeArtistPreference,
    executeUndo,
    undoStack,
    resetToDemoDefaults,
  } = usePrototypeStore();

  const [searchArtistInput, setSearchArtistInput] = useState('');
  const [priceCeiling, setPriceCeiling] = useState(30);
  const [travelRadius, setTravelRadius] = useState<
    'local' | 'front_range' | 'anywhere'
  >('front_range');
  const [curiosityLevel, setCuriosityLevel] = useState<
    'conservative' | 'balanced' | 'adventurous'
  >('balanced');

  const favorites = preferences.filter((p) => p.level === 'favorite');
  const likes = preferences.filter((p) => p.level === 'like');
  const ignored = preferences.filter((p) => p.level === 'ignore');

  const handleAddArtist = (
    artistId: string,
    artistName: string,
    level: 'favorite' | 'like' | 'ignore',
  ) => {
    setArtistPreference(artistId, artistName, level);
    setSearchArtistInput('');
  };

  const filteredSuggestions = SUGGESTED_ARTISTS.filter(
    (sa) =>
      !preferences.some((p) => p.artistId === sa.id) &&
      sa.name.toLowerCase().includes(searchArtistInput.toLowerCase()),
  );

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Title & Intro */}
      <div className="flex flex-col gap-4 border-b border-zinc-800/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-wider text-violet-400">
              Personal Taste Calibration
            </span>
            <span className="text-zinc-600">•</span>
            <span className="font-mono text-xs text-zinc-400">
              Deterministic Invariant 11 Rules
            </span>
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Taste Signal Radar
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Directly shape which concerts the Signal recommends. Explicit manual
            preferences strictly take precedence over inferred streaming data.
            Disliked headliners trigger complete suppression.
          </p>
        </div>

        <button
          type="button"
          onClick={resetToDemoDefaults}
          className="self-start rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white active:scale-95 sm:self-auto"
        >
          Reset to Demo Defaults
        </button>
      </div>

      {/* Undo Alert Banner if stack active */}
      {undoStack.length > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-violet-800/60 bg-violet-950/40 p-4">
          <div className="flex items-center gap-2.5 text-xs text-violet-200">
            <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
            <span>
              Last action: <strong>{undoStack[0].description}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={executeUndo}
            className="rounded-lg bg-violet-600 px-3 py-1 font-mono text-xs font-bold text-white transition-all hover:bg-violet-500 active:scale-95"
          >
            Undo Change
          </button>
        </div>
      )}

      {/* Signal Tuning Controls */}
      <section className="space-y-6 rounded-3xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-xl backdrop-blur sm:p-7">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-violet-400">
          Signal Sensitivity & Parameters
        </h3>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* 1. Spontaneous Price Ceiling */}
          <div className="space-y-2">
            <div className="flex justify-between font-mono text-xs">
              <span className="text-zinc-300">Spontaneous Price Ceiling:</span>
              <span className="font-bold text-white">${priceCeiling}</span>
            </div>
            <input
              type="range"
              min="15"
              max="60"
              step="5"
              value={priceCeiling}
              onChange={(e) => setPriceCeiling(Number(e.target.value))}
              className="w-full cursor-pointer accent-violet-500"
            />
            <p className="text-[11px] text-zinc-500">
              Shows under ${priceCeiling} are prioritized in the &quot;Worth
              Seeing This Weekend&quot; stream.
            </p>
          </div>

          {/* 2. Travel Willingness */}
          <div className="space-y-2">
            <label
              htmlFor="travel-radius-select"
              className="block font-mono text-xs text-zinc-300"
            >
              Travel Willingness:
            </label>
            <select
              id="travel-radius-select"
              value={travelRadius}
              onChange={(e) =>
                setTravelRadius(
                  e.target.value as 'local' | 'front_range' | 'anywhere',
                )
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="local">Denver Urban Core Only (&lt;10 mi)</option>
              <option value="front_range">
                Front Range / Boulder / Red Rocks (35 mi)
              </option>
              <option value="anywhere">Destination Festivals Anywhere</option>
            </select>
            <p className="text-[11px] text-zinc-500">
              Calibrates how far away a show can be before trip friction
              penalties apply.
            </p>
          </div>

          {/* 3. Curiosity Level */}
          <div className="space-y-2">
            <label
              htmlFor="curiosity-select"
              className="block font-mono text-xs text-zinc-300"
            >
              Discovery Curiosity:
            </label>
            <select
              id="curiosity-select"
              value={curiosityLevel}
              onChange={(e) =>
                setCuriosityLevel(
                  e.target.value as 'conservative' | 'balanced' | 'adventurous',
                )
              }
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="conservative">
                Conservative (Stick to Known Genres)
              </option>
              <option value="balanced">Balanced (Intelligent Adjacency)</option>
              <option value="adventurous">Adventurous (High Curiosity)</option>
            </select>
            <p className="text-[11px] text-zinc-500">
              Balances familiar favorite tours against unfamiliar sound
              explorations.
            </p>
          </div>
        </div>
      </section>

      {/* Add New Artist Search Input */}
      <section className="space-y-3">
        <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-400">
          Add Artist to Taste Radar
        </h3>
        <div className="relative">
          <input
            type="text"
            value={searchArtistInput}
            onChange={(e) => setSearchArtistInput(e.target.value)}
            placeholder="Search candidate artists (e.g., Hania Rani, Bonobo, Fontaines D.C.)..."
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 px-4 py-3 text-sm text-white placeholder-zinc-500 shadow focus:border-violet-500 focus:outline-none"
          />
        </div>

        {/* Suggestion Chips */}
        {filteredSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {filteredSuggestions.map((sa) => (
              <div
                key={sa.id}
                className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-200"
              >
                <div>
                  <span className="font-semibold text-white">{sa.name}</span>
                  <span className="ml-1.5 text-[10px] text-zinc-500">
                    ({sa.genre})
                  </span>
                </div>
                <div className="flex items-center gap-1 border-l border-zinc-800 pl-2">
                  <button
                    type="button"
                    onClick={() => handleAddArtist(sa.id, sa.name, 'favorite')}
                    className="rounded bg-rose-950/80 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-900 active:scale-95"
                    title="Mark as Favorite"
                  >
                    ❤️ Favorite
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddArtist(sa.id, sa.name, 'like')}
                    className="rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-900 active:scale-95"
                    title="Mark as Liked"
                  >
                    👍 Like
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddArtist(sa.id, sa.name, 'ignore')}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700 active:scale-95"
                    title="Ignore Artist"
                  >
                    🚫 Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Preference Groups: Favorites, Liked, Ignored */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Group 1: Favorites */}
        <section className="flex flex-col justify-between rounded-3xl border border-rose-900/40 bg-zinc-900/60 p-5 shadow-xl backdrop-blur">
          <div>
            <div className="flex items-center justify-between border-b border-rose-900/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">❤️</span>
                <h3 className="text-sm font-bold text-white">
                  Favorite Artists
                </h3>
              </div>
              <span className="rounded-full border border-rose-800 bg-rose-950 px-2 py-0.5 font-mono text-[11px] text-rose-300">
                {favorites.length}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              Scores 98–100 match. Presale alerts prioritized immediately.
            </p>

            <ul className="mt-4 space-y-2.5">
              {favorites.map((fav) => (
                <li
                  key={fav.artistId}
                  className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/80 p-3"
                >
                  <div>
                    <span className="block text-xs font-bold text-white">
                      {fav.artistName}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      Added {new Date(fav.addedAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* One-click Unfavorite and Ignore actions */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          fav.artistId,
                          fav.artistName,
                          'like',
                        )
                      }
                      className="rounded-lg bg-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-300 transition-all hover:bg-zinc-700 active:scale-95"
                      title="Demote to Liked"
                    >
                      Demote
                    </button>
                    <button
                      type="button"
                      onClick={() => removeArtistPreference(fav.artistId)}
                      className="rounded-lg bg-zinc-800 p-1 text-zinc-400 transition-all hover:text-rose-400 active:scale-95"
                      title="Remove from favorites"
                      aria-label={`Remove ${fav.artistName} from favorites`}
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Group 2: Liked Artists */}
        <section className="flex flex-col justify-between rounded-3xl border border-emerald-900/40 bg-zinc-900/60 p-5 shadow-xl backdrop-blur">
          <div>
            <div className="flex items-center justify-between border-b border-emerald-900/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">👍</span>
                <h3 className="text-sm font-bold text-white">Liked Artists</h3>
              </div>
              <span className="rounded-full border border-emerald-800 bg-emerald-950 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                {likes.length}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              High match factor (88–92%). Feeds into general streams.
            </p>

            <ul className="mt-4 space-y-2.5">
              {likes.map((like) => (
                <li
                  key={like.artistId}
                  className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/80 p-3"
                >
                  <div>
                    <span className="block text-xs font-bold text-white">
                      {like.artistName}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {like.source === 'spotify_import'
                        ? 'Spotify Import'
                        : 'Manual Add'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setArtistPreference(
                          like.artistId,
                          like.artistName,
                          'favorite',
                        )
                      }
                      className="rounded-lg border border-rose-800/60 bg-rose-950/70 px-2 py-1 font-mono text-[11px] text-rose-300 transition-all hover:bg-rose-900 active:scale-95"
                      title="Promote to Favorite"
                    >
                      ★ Fav
                    </button>
                    <button
                      type="button"
                      onClick={() => removeArtistPreference(like.artistId)}
                      className="rounded-lg bg-zinc-800 p-1 text-zinc-400 transition-all hover:text-rose-400 active:scale-95"
                      title="Remove from likes"
                      aria-label={`Remove ${like.artistName} from likes`}
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Group 3: Ignored Artists (Suppression List) */}
        <section className="flex flex-col justify-between rounded-3xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-xl backdrop-blur">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🚫</span>
                <h3 className="text-sm font-bold text-white">
                  Ignored Artists
                </h3>
              </div>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
                {ignored.length}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              Invariant 11: Headlining shows by these artists are fully
              suppressed.
            </p>

            <ul className="mt-4 space-y-2.5">
              {ignored.map((ign) => (
                <li
                  key={ign.artistId}
                  className="flex items-center justify-between rounded-xl border border-rose-950/50 bg-zinc-950/80 p-3"
                >
                  <div>
                    <span className="block text-xs font-bold text-rose-300">
                      {ign.artistName}
                    </span>
                    <span className="font-mono text-[10px] text-rose-500">
                      Suppressed
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeArtistPreference(ign.artistId)}
                    className="rounded-lg bg-zinc-800 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-all hover:bg-zinc-700 active:scale-95"
                  >
                    Un-ignore
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
