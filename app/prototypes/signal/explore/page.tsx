'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrototypeStore } from '@/lib/prototypes/store';
import { computeSignalScore } from '@/lib/prototypes/signal-helpers';
import { SignalCard } from '@/components/prototypes/signal/SignalCard';

function ExploreContent() {
  const searchParams = useSearchParams();
  const contextParam = searchParams.get('context');
  const filterParam = searchParams.get('filter');

  const { events, preferences, viewMode, savedEventIds, alertEventIds } =
    usePrototypeStore();

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContext, setSelectedContext] = useState<string>(
    contextParam || (filterParam ? `filter-${filterParam}` : 'all'),
  );
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [selectedVenue, setSelectedVenue] = useState<string>('all');
  const [selectedAge, setSelectedAge] = useState<string>('all');
  const [maxPrice, setMaxPrice] = useState<number>(200);
  const [selectedTicketStatus, setSelectedTicketStatus] =
    useState<string>('all');
  const [onlySaved, setOnlySaved] = useState(false);
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'signal' | 'date' | 'price' | 'venue'>(
    'signal',
  );

  // Handle Preset Context Buttons
  const handleContextChange = (ctx: string) => {
    setSelectedContext(ctx);
    if (ctx === 'weekend') {
      setSelectedGenre('all');
      setMaxPrice(200);
      setOnlySaved(false);
    } else if (ctx === 'inexpensive') {
      setMaxPrice(25);
      setSelectedGenre('all');
      setOnlySaved(false);
    } else if (ctx === 'travel') {
      setMaxPrice(200);
      setSelectedVenue('all');
      setOnlySaved(false);
    } else if (ctx === 'top') {
      setMaxPrice(200);
      setOnlySaved(false);
    } else if (ctx === 'saved') {
      setOnlySaved(true);
    } else if (ctx === 'all') {
      setMaxPrice(200);
      setSelectedGenre('all');
      setSelectedVenue('all');
      setSelectedAge('all');
      setSelectedTicketStatus('all');
      setOnlySaved(false);
      setOnlyAlerts(false);
      setSearchQuery('');
    }
  };

  // Unique lists for filter options
  const genres = useMemo(() => {
    const list = new Set<string>();
    events.forEach((ev) => {
      list.add(ev.genre.split('/')[0].trim());
    });
    return Array.from(list);
  }, [events]);

  const venues = useMemo(() => {
    const list = new Set<string>();
    events.forEach((ev) => list.add(ev.venueName));
    return Array.from(list);
  }, [events]);

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const signal = computeSignalScore(ev, preferences, viewMode);

      // Invariant 11: Disliked headliners suppressed in authenticated mode
      if (signal.isSuppressed && viewMode === 'authenticated') {
        // Only show if user specifically searches for it
        if (!searchQuery.toLowerCase().includes('neon')) {
          return false;
        }
      }

      // Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = ev.title.toLowerCase().includes(query);
        const matchesVenue = ev.venueName.toLowerCase().includes(query);
        const matchesCity = ev.city
          ? ev.city.toLowerCase().includes(query)
          : false;
        const matchesGenre = ev.genre.toLowerCase().includes(query);
        const matchesArtist = ev.artists.some((a) =>
          a.name.toLowerCase().includes(query),
        );
        if (
          !matchesTitle &&
          !matchesVenue &&
          !matchesCity &&
          !matchesGenre &&
          !matchesArtist
        ) {
          return false;
        }
      }

      // Context Preset Filters
      if (selectedContext === 'weekend') {
        const isWeekend = ['2026-11-13', '2026-11-14', '2026-11-15'].includes(
          ev.localStartDate,
        );
        if (!isWeekend) return false;
      } else if (selectedContext === 'inexpensive') {
        if (ev.minPrice != null && ev.minPrice > 25) return false;
      } else if (selectedContext === 'travel') {
        const isTravel =
          ev.eventKind === 'multi_day_festival' ||
          ev.venueName.includes('Red Rocks') ||
          ev.city === 'Boulder';
        if (!isTravel) return false;
      } else if (
        selectedContext === 'top' ||
        selectedContext === 'filter-top'
      ) {
        if (signal.score < 90) return false;
      } else if (selectedContext === 'filter-favorites') {
        if (signal.affinityType !== 'favorite') return false;
      } else if (selectedContext === 'saved') {
        if (!savedEventIds.includes(ev.id)) return false;
      }

      // Genre Filter
      if (selectedGenre !== 'all') {
        if (!ev.genre.toLowerCase().includes(selectedGenre.toLowerCase()))
          return false;
      }

      // Venue Filter
      if (selectedVenue !== 'all') {
        if (ev.venueName !== selectedVenue) return false;
      }

      // Age Restriction
      if (selectedAge !== 'all') {
        if (ev.ageRestriction !== selectedAge) return false;
      }

      // Ticket Status
      if (selectedTicketStatus !== 'all') {
        if (ev.ticketStatus !== selectedTicketStatus) return false;
      }

      // Price Ceiling
      if (maxPrice < 200) {
        if (ev.minPrice != null && ev.minPrice > maxPrice) return false;
      }

      // Watchlist & Alerts toggles
      if (onlySaved && !savedEventIds.includes(ev.id)) return false;
      if (onlyAlerts && !alertEventIds.includes(ev.id)) return false;

      return true;
    });
  }, [
    events,
    searchQuery,
    selectedContext,
    selectedGenre,
    selectedVenue,
    selectedAge,
    selectedTicketStatus,
    maxPrice,
    onlySaved,
    onlyAlerts,
    preferences,
    viewMode,
    savedEventIds,
    alertEventIds,
  ]);

  // Sort filtered events
  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      const signalA = computeSignalScore(a, preferences, viewMode);
      const signalB = computeSignalScore(b, preferences, viewMode);

      if (sortBy === 'signal') {
        return signalB.score - signalA.score;
      }
      if (sortBy === 'date') {
        return a.localStartDate.localeCompare(b.localStartDate);
      }
      if (sortBy === 'price') {
        const priceA = a.minPrice ?? 999;
        const priceB = b.minPrice ?? 999;
        return priceA - priceB;
      }
      if (sortBy === 'venue') {
        return a.venueName.localeCompare(b.venueName);
      }
      return 0;
    });
  }, [filteredEvents, sortBy, preferences, viewMode]);

  const resetAllFilters = () => {
    setSelectedContext('all');
    setSelectedGenre('all');
    setSelectedVenue('all');
    setSelectedAge('all');
    setSelectedTicketStatus('all');
    setMaxPrice(200);
    setOnlySaved(false);
    setOnlyAlerts(false);
    setSearchQuery('');
  };

  const isAnyFilterActive =
    selectedContext !== 'all' ||
    selectedGenre !== 'all' ||
    selectedVenue !== 'all' ||
    selectedAge !== 'all' ||
    selectedTicketStatus !== 'all' ||
    maxPrice < 200 ||
    onlySaved ||
    onlyAlerts ||
    searchQuery.trim().length > 0;

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-violet-400">
            Unrestricted Contextual Scanner
          </span>
          <span className="text-zinc-600">•</span>
          <span className="font-mono text-xs text-zinc-400">
            {viewMode === 'authenticated'
              ? 'Personal Affinity Ranking'
              : 'Balanced Guest Ranking'}
          </span>
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Explore Concert Signals
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Filter and scan across dates, genres, acoustic atmospheres, and price
          points. Every result computes a live signal score reflecting your
          preferences.
        </p>
      </div>

      {/* Search Bar & Quick Context Pills */}
      <div className="space-y-4">
        {/* Main Search Input */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-zinc-400">
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by artist, venue, genre, or keyword (e.g., The Cure, Bluebird, Shoegaze)..."
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/90 py-3.5 pl-11 pr-10 text-base text-white placeholder-zinc-500 shadow-xl backdrop-blur transition-all focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-zinc-400 hover:text-white"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Quick Context Scanner Bar */}
        <div className="scrollbar-none flex items-center gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => handleContextChange('all')}
            className={`shrink-0 rounded-xl px-3 py-1.5 font-mono text-xs font-medium transition-all active:scale-95 ${
              selectedContext === 'all'
                ? 'bg-white font-bold text-zinc-950 shadow-md'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            All Signals
          </button>

          <button
            type="button"
            onClick={() => handleContextChange('weekend')}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-xs font-medium transition-all active:scale-95 ${
              selectedContext === 'weekend'
                ? 'bg-blue-600 font-bold text-white shadow-[0_0_12px_rgba(59,130,246,0.4)]'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <span>🌙</span>
            <span>This Weekend</span>
          </button>

          <button
            type="button"
            onClick={() => handleContextChange('inexpensive')}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-xs font-medium transition-all active:scale-95 ${
              selectedContext === 'inexpensive'
                ? 'bg-emerald-600 font-bold text-white shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <span>💸</span>
            <span>Under $25 / Free</span>
          </button>

          <button
            type="button"
            onClick={() => handleContextChange('travel')}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-xs font-medium transition-all active:scale-95 ${
              selectedContext === 'travel'
                ? 'bg-pink-600 font-bold text-white shadow-[0_0_12px_rgba(236,72,153,0.4)]'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <span>✈️</span>
            <span>Worth Traveling For</span>
          </button>

          <button
            type="button"
            onClick={() => handleContextChange('top')}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-xs font-medium transition-all active:scale-95 ${
              selectedContext === 'top' || selectedContext === 'filter-top'
                ? 'bg-violet-600 font-bold text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <span>⚡</span>
            <span>90%+ Matches</span>
          </button>

          <button
            type="button"
            onClick={() => handleContextChange('saved')}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-xs font-medium transition-all active:scale-95 ${
              selectedContext === 'saved'
                ? 'bg-rose-600 font-bold text-white shadow-[0_0_12px_rgba(225,29,72,0.4)]'
                : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
            }`}
          >
            <span>❤️</span>
            <span>Watchlist ({savedEventIds.length})</span>
          </button>

          {/* Toggle Advanced Deep Filters */}
          <button
            type="button"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-xs transition-colors active:scale-95 ${
              showAdvancedFilters
                ? 'border-violet-500 bg-violet-950/60 text-violet-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
            <span>Filters {isAnyFilterActive ? '•' : ''}</span>
          </button>
        </div>
      </div>

      {/* Advanced Deep Filter Drawer */}
      {showAdvancedFilters && (
        <div className="animate-in fade-in space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl backdrop-blur-md duration-150">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {/* 1. Price Ceiling Slider */}
            <div>
              <div className="mb-2 flex items-center justify-between font-mono text-xs">
                <span className="text-zinc-400">Price Ceiling:</span>
                <span className="font-bold text-white">
                  {maxPrice >= 200 ? 'Any Price' : `< $${maxPrice}`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full cursor-pointer accent-violet-500"
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-500">
                <span>Free ($0)</span>
                <span>$50</span>
                <span>$100</span>
                <span>$200+</span>
              </div>
            </div>

            {/* 2. Genre Select */}
            <div>
              <label
                htmlFor="genre-select"
                className="mb-2 block font-mono text-xs text-zinc-400"
              >
                Genre / Atmosphere:
              </label>
              <select
                id="genre-select"
                value={selectedGenre}
                onChange={(e) => setSelectedGenre(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
              >
                <option value="all">All Genres</option>
                {genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* 3. Venue Select */}
            <div>
              <label
                htmlFor="venue-select"
                className="mb-2 block font-mono text-xs text-zinc-400"
              >
                Target Venue:
              </label>
              <select
                id="venue-select"
                value={selectedVenue}
                onChange={(e) => setSelectedVenue(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
              >
                <option value="all">All Venues</option>
                {venues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Age Restriction */}
            <div>
              <label
                htmlFor="age-select"
                className="mb-2 block font-mono text-xs text-zinc-400"
              >
                Age Restriction:
              </label>
              <select
                id="age-select"
                value={selectedAge}
                onChange={(e) => setSelectedAge(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
              >
                <option value="all">Any Restriction</option>
                <option value="all_ages">All Ages Only</option>
                <option value="18+">18+ Allowed</option>
                <option value="21+">21+ Only</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
            {/* Status & Alerts Toggles */}
            <div className="flex items-center gap-4 text-xs">
              <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={onlyAlerts}
                  onChange={(e) => setOnlyAlerts(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-violet-600 focus:ring-0"
                />
                <span>Active Alerts Only ({alertEventIds.length})</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-zinc-300">
                <input
                  type="checkbox"
                  checked={onlySaved}
                  onChange={(e) => setOnlySaved(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-violet-600 focus:ring-0"
                />
                <span>Watchlist Only ({savedEventIds.length})</span>
              </label>
            </div>

            {/* Reset Filters CTA */}
            {isAnyFilterActive && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="font-mono text-xs text-violet-400 underline hover:text-violet-300"
              >
                Reset All Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sorting & Results Bar */}
      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-white">
            {sortedEvents.length}{' '}
            {sortedEvents.length === 1 ? 'Concert Signal' : 'Concert Signals'}
          </span>
          {isAnyFilterActive && (
            <span className="rounded-full border border-violet-800 bg-violet-950/60 px-2 py-0.5 font-mono text-[10px] text-violet-300">
              Filtered
            </span>
          )}
        </div>

        {/* Sort Selector */}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-zinc-500">Sort by:</span>
          <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-0.5">
            <button
              type="button"
              onClick={() => setSortBy('signal')}
              className={`rounded-lg px-2.5 py-1 font-mono transition-all active:scale-95 ${
                sortBy === 'signal'
                  ? 'bg-violet-600 font-bold text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Signal Score
            </button>
            <button
              type="button"
              onClick={() => setSortBy('date')}
              className={`rounded-lg px-2.5 py-1 font-mono transition-all active:scale-95 ${
                sortBy === 'date'
                  ? 'bg-zinc-800 font-bold text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Date
            </button>
            <button
              type="button"
              onClick={() => setSortBy('price')}
              className={`rounded-lg px-2.5 py-1 font-mono transition-all active:scale-95 ${
                sortBy === 'price'
                  ? 'bg-zinc-800 font-bold text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Price
            </button>
            <button
              type="button"
              onClick={() => setSortBy('venue')}
              className={`rounded-lg px-2.5 py-1 font-mono transition-all active:scale-95 ${
                sortBy === 'venue'
                  ? 'bg-zinc-800 font-bold text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Venue
            </button>
          </div>
        </div>
      </div>

      {/* Grid of Results */}
      {sortedEvents.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sortedEvents.map((event) => (
            <SignalCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
          <span className="text-4xl">📡</span>
          <h3 className="mt-3 text-lg font-bold text-white">
            No Signals Found
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
            Your current filter combination didn&apos;t match any concerts in
            the test catalog.
          </p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow transition-all hover:bg-violet-500 active:scale-95"
          >
            Reset All Filters
          </button>
        </div>
      )}
    </main>
  );
}

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center font-mono text-sm text-zinc-500">
          Loading Signal Scanner...
        </div>
      }
    >
      <ExploreContent />
    </Suspense>
  );
}
