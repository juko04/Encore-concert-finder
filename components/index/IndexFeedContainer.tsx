'use client';

import {
  eventMatchesGenre,
  genreMatchesQuery,
  normalizeGenreFacets,
} from '@/lib/genres/catalog-genres';
import React, { useState, useMemo } from 'react';
import type { IndexEventItem, IndexMode, IndexSortBy } from './types';
import { toIndexEventItem } from './types';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';
import { EventCard } from './EventCard';
import { EventListItem } from './EventListItem';
import { UndoToast } from './UndoToast';
import { useWatchlist } from './useWatchlist';
import {
  SearchIcon,
  LayoutGridIcon,
  LayoutListIcon,
  SparklesIcon,
  CalendarIcon,
  TicketIcon,
  CompassIcon,
  XIcon,
} from './icons';

export interface IndexFeedContainerProps {
  events: Array<CanonicalEventSummary | ScoredEvent | IndexEventItem>;
  initialMode?: IndexMode;
  initialLayout?: 'grid' | 'list';
  referenceDate?: string; // YYYY-MM-DD for deterministic weekend calculation
  title?: string;
  subtitle?: string;
}

function getWeekendDates(refDateStr?: string): string[] {
  const base = refDateStr ? new Date(`${refDateStr}T12:00:00Z`) : new Date();

  // Find upcoming Friday
  const day = base.getUTCDay();
  const diffToFriday = (5 - day + 7) % 7;
  const friday = new Date(base.getTime() + diffToFriday * 86400000);
  const saturday = new Date(friday.getTime() + 86400000);
  const sunday = new Date(friday.getTime() + 172800000);

  const format = (d: Date) => d.toISOString().split('T')[0];
  return [format(friday), format(saturday), format(sunday)];
}

export function IndexFeedContainer({
  events: rawEvents,
  initialMode = 'all',
  initialLayout = 'grid',
  referenceDate,
  title = 'Encore Concert Index',
  subtitle = 'Curated live music, transparent ticketing, and personalized recommendations.',
}: IndexFeedContainerProps) {
  const normalizedEvents = useMemo(() => {
    return rawEvents.map(toIndexEventItem);
  }, [rawEvents]);

  const { isSaved, hasAlert, toggleSave, toggleAlert, undoStack, undo } =
    useWatchlist();

  const [mode, setMode] = useState<IndexMode>(initialMode);
  const [layout, setLayout] = useState<'grid' | 'list'>(initialLayout);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [sortBy, setSortBy] = useState<IndexSortBy>('date_asc');

  // Extract unique genres for filter pills
  const uniqueGenres = useMemo(() => {
    return normalizeGenreFacets(normalizedEvents.map((e) => e.genre));
  }, [normalizedEvents]);

  const weekendDates = useMemo(
    () => getWeekendDates(referenceDate),
    [referenceDate],
  );

  // Filter and sort events
  const displayedEvents = useMemo(() => {
    let result = [...normalizedEvents];

    // 1. Mode filtering
    if (mode === 'this_weekend') {
      result = result.filter((e) => {
        if (weekendDates.includes(e.localStartDate)) return true;
        // Check day of week fallback
        try {
          const [y, m, d] = e.localStartDate.split('-').map(Number);
          const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
          const dow = dt.getUTCDay();
          return dow === 0 || dow === 5 || dow === 6;
        } catch {
          return false;
        }
      });
    } else if (mode === 'free') {
      result = result.filter(
        (e) =>
          e.minPrice === 0 ||
          (e.eventKind as string) === 'free_event' ||
          (e.minPrice === null && (e.eventKind as string) === 'free_event'),
      );
    } else if (mode === 'recommended') {
      result = result.filter((e) => !e.personalScore?.isDisliked);
    }

    // 2. Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((e) => {
        const titleMatch = e.title?.toLowerCase().includes(q);
        const headlinerMatch = e.headlinerName?.toLowerCase().includes(q);
        const artistMatch = e.artists?.some((a) =>
          a.name.toLowerCase().includes(q),
        );
        const venueMatch = e.venueName?.toLowerCase().includes(q);
        const cityMatch = e.city?.toLowerCase().includes(q);
        const genreMatch = genreMatchesQuery(q, e.genre);
        return (
          titleMatch ||
          headlinerMatch ||
          artistMatch ||
          venueMatch ||
          cityMatch ||
          genreMatch
        );
      });
    }

    // 3. Genre filter
    if (selectedGenre !== 'all') {
      result = result.filter((e) =>
        eventMatchesGenre(selectedGenre, e.genre, e.subgenres),
      );
    }

    // 4. Sorting
    result.sort((a, b) => {
      if (sortBy === 'date_asc') {
        return a.localStartDate.localeCompare(b.localStartDate);
      }
      if (sortBy === 'date_desc') {
        return b.localStartDate.localeCompare(a.localStartDate);
      }
      if (sortBy === 'price_asc') {
        const priceA = a.minPrice ?? 9999;
        const priceB = b.minPrice ?? 9999;
        return priceA - priceB;
      }
      if (sortBy === 'price_desc') {
        const priceA = a.maxPrice ?? a.minPrice ?? 0;
        const priceB = b.maxPrice ?? b.minPrice ?? 0;
        return priceB - priceA;
      }
      if (sortBy === 'match_desc') {
        const scoreA = a.personalScore?.score ?? 50;
        const scoreB = b.personalScore?.score ?? 50;
        return scoreB - scoreA;
      }
      if (sortBy === 'title_asc') {
        return a.headlinerName.localeCompare(b.headlinerName);
      }
      return 0;
    });

    return result;
  }, [
    normalizedEvents,
    mode,
    weekendDates,
    searchQuery,
    selectedGenre,
    sortBy,
  ]);

  const modeChips: Array<{
    id: IndexMode;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'all', label: 'All Shows', icon: CompassIcon },
    { id: 'this_weekend', label: 'This Weekend', icon: CalendarIcon },
    { id: 'recommended', label: 'Recommended', icon: SparklesIcon },
    { id: 'free', label: 'Free ($0)', icon: TicketIcon },
  ];

  return (
    <div className="space-y-6">
      {/* Top Section Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200/80 pb-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-zinc-500 sm:text-sm">
            {subtitle}
          </p>
        </div>

        {/* View Layout Toggle (Grid vs List) */}
        <div className="shadow-2xs flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setLayout('grid')}
            aria-label="Grid layout"
            aria-pressed={layout === 'grid'}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              layout === 'grid'
                ? 'shadow-xs bg-zinc-900 text-white'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
            }`}
          >
            <LayoutGridIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setLayout('list')}
            aria-label="List layout"
            aria-pressed={layout === 'list'}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              layout === 'list'
                ? 'shadow-xs bg-zinc-900 text-white'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
            }`}
          >
            <LayoutListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mode Chips & Quick Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Mode Selector Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {modeChips.map((chip) => {
            const Icon = chip.icon;
            const active = mode === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setMode(chip.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
                  active
                    ? 'shadow-xs bg-zinc-900 text-white'
                    : 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium text-zinc-500">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as IndexSortBy)}
            aria-label="Sort concerts"
            className="shadow-2xs focus:outline-hidden rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 focus:border-zinc-900"
          >
            <option value="date_asc">Date (Soonest)</option>
            <option value="date_desc">Date (Latest)</option>
            <option value="price_asc">Price (Lowest)</option>
            <option value="price_desc">Price (Highest)</option>
            <option value="match_desc">Match Score</option>
            <option value="title_asc">Artist (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Search Input & Genre Pills */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Search Bar */}
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search artists, venues, genres, cities..."
            className="shadow-2xs focus:outline-hidden w-full rounded-xl border border-zinc-200 bg-white py-2 pl-10 pr-9 text-xs text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-900 sm:text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-600"
              aria-label="Clear search"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Genre Pill Filter */}
        {uniqueGenres.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setSelectedGenre('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedGenre === 'all'
                  ? 'bg-zinc-200 font-semibold text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70'
              }`}
            >
              All Genres
            </button>
            {uniqueGenres.slice(0, 5).map((genre) => (
              <button
                key={genre}
                type="button"
                onClick={() => setSelectedGenre(genre)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedGenre === genre
                    ? 'bg-zinc-900 font-semibold text-white'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70'
                }`}
              >
                {genre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Shows Count Banner */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          Showing{' '}
          <span className="font-semibold text-zinc-800">
            {displayedEvents.length}
          </span>{' '}
          concerts
        </span>
        {(searchQuery || selectedGenre !== 'all' || mode !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedGenre('all');
              setMode('all');
            }}
            className="font-medium text-zinc-600 hover:text-zinc-900 hover:underline"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Events Render Area */}
      {displayedEvents.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400">
            <CompassIcon className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-zinc-900">
            No Concerts Found
          </h3>
          <p className="mx-auto max-w-sm text-xs text-zinc-500">
            No live events matched your active filters. Try resetting search
            terms or broadening date and genre options.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedGenre('all');
              setMode('all');
            }}
            className="shadow-xs rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
          >
            View All Shows
          </button>
        </div>
      ) : layout === 'grid' ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              isSaved={isSaved(event.id)}
              hasAlert={hasAlert(event.id)}
              onToggleSave={toggleSave}
              onToggleAlert={toggleAlert}
            />
          ))}
        </div>
      ) : (
        <div className="shadow-2xs overflow-hidden rounded-2xl border border-zinc-200/90">
          {displayedEvents.map((event) => (
            <EventListItem
              key={event.id}
              event={event}
              isSaved={isSaved(event.id)}
              hasAlert={hasAlert(event.id)}
              onToggleSave={toggleSave}
              onToggleAlert={toggleAlert}
            />
          ))}
        </div>
      )}

      {/* Watchlist Undo Toast */}
      <UndoToast undoStack={undoStack} onUndo={undo} />
    </div>
  );
}
