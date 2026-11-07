'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import Link from 'next/link';
import type { PublicDiscoverResult } from '@/lib/recommendation/service';
import type { DiscoveryMode } from '@/lib/recommendation/types';
import {
  DISCOVERY_MODES,
  DISCOVERY_MODE_CONFIGS,
} from '@/lib/recommendation/modes';
import { EventCard } from '@/components/catalog/EventCard';
import {
  getCatalogCitiesAction,
  getPublicDiscoverAction,
} from '@/app/discover/actions';

export interface GuestDiscoverContainerProps {
  initialData: PublicDiscoverResult;
  showScoringInspector?: boolean;
}

export function GuestDiscoverContainer({
  initialData,
  showScoringInspector = false,
}: GuestDiscoverContainerProps) {
  const [isPending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  const [activeMode, setActiveMode] = useState<DiscoveryMode>(
    initialData.activeMode ?? 'all',
  );
  const [events, setEvents] = useState(initialData.events);
  const [isEmptyCatalog, setIsEmptyCatalog] = useState(
    initialData.isEmptyCatalog,
  );
  const [, setTotalCount] = useState(initialData.totalCount);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [catalogCities, setCatalogCities] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch catalog cities on mount
  useEffect(() => {
    getCatalogCitiesAction().then((res) => {
      if (res.success && res.data && res.data.length > 0) {
        setCatalogCities(res.data);
      }
    });
  }, []);

  // Extract unique cities from events or server list
  const availableCities = useMemo(() => {
    if (catalogCities.length > 0) return catalogCities;
    const citySet = new Set<string>();
    for (const evt of events) {
      if (evt.city?.trim()) citySet.add(evt.city.trim());
    }
    return Array.from(citySet).sort();
  }, [catalogCities, events]);

  // Central refresh helper for public discover
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const refreshPublicEvents = (overrides?: {
    mode?: DiscoveryMode;
    search?: string;
    city?: string;
  }) => {
    const targetMode = overrides?.mode ?? activeMode;
    const targetSearch =
      overrides?.search !== undefined ? overrides.search : searchQuery;
    const targetCity =
      overrides?.city !== undefined ? overrides.city : selectedCity;

    const reqId = ++requestIdRef.current;

    startTransition(async () => {
      const res = await getPublicDiscoverAction({
        mode: targetMode,
        search: targetSearch || undefined,
        city: targetCity || undefined,
      });

      if (reqId !== requestIdRef.current) return;

      if (res.success && res.data) {
        setEvents(res.data.events);
        setIsEmptyCatalog(res.data.isEmptyCatalog);
        setTotalCount(res.data.totalCount);
      } else {
        setErrorMessage(
          res.error || 'Failed to refresh events. Showing previous results.',
        );
      }
    });
  };

  const handleModeChange = (newMode: DiscoveryMode) => {
    if (newMode === activeMode || isPending) return;
    setActiveMode(newMode);
    setErrorMessage(null);
    refreshPublicEvents({ mode: newMode });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      refreshPublicEvents({ search: value });
    }, 300);
  };

  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    refreshPublicEvents({ city });
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedCity('');
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    refreshPublicEvents({ search: '', city: '' });
  };

  // Client-side filtering over loaded events for instant feedback
  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (
        selectedCity &&
        evt.city?.toLowerCase() !== selectedCity.toLowerCase()
      ) {
        return false;
      }
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.trim().toLowerCase();
        const matchesTitle = evt.title.toLowerCase().includes(q);
        const matchesVenue = evt.venueName?.toLowerCase().includes(q) ?? false;
        const matchesArtist =
          evt.artists?.some((a) => a.name.toLowerCase().includes(q)) ?? false;
        if (!matchesTitle && !matchesVenue && !matchesArtist) {
          return false;
        }
      }
      return true;
    });
  }, [events, selectedCity, searchQuery]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/"
            className="text-xs font-medium text-zinc-400 hover:text-zinc-200"
          >
            ← Back to Home
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Discover Live Music
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Explore upcoming concerts and events across verified venues and
            sources.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {showScoringInspector && (
            <Link
              href="/discover/scoring-preview"
              data-testid="discover-scoring-preview-link"
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3.5 py-2 text-xs font-semibold text-indigo-200 transition-colors hover:border-indigo-500 hover:text-white"
            >
              <span>🎯</span> Scoring Inspector
            </Link>
          )}
          <Link
            href="/login"
            data-testid="guest-sign-in-link"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Transient Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="guest-error-banner"
          className="flex items-center justify-between rounded-xl border border-red-800/80 bg-red-950/40 p-4 text-sm text-red-200"
        >
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-semibold text-red-300 hover:text-white"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Discovery Mode Switcher Tabs */}
      <section aria-label="Discovery Modes" className="space-y-3">
        <div
          role="tablist"
          aria-label="Discovery Modes"
          className="flex flex-wrap items-center gap-2"
        >
          {DISCOVERY_MODES.map((mode) => {
            const isActive = activeMode === mode.id;
            return (
              <button
                key={mode.id}
                role="tab"
                type="button"
                data-testid={`mode-tab-${mode.id}`}
                aria-selected={isActive}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => handleModeChange(mode.id)}
                disabled={isPending}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-950/70 text-white shadow-sm'
                    : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <span>{mode.badge}</span>
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <p>
            <span className="font-semibold text-zinc-300">
              {DISCOVERY_MODE_CONFIGS[activeMode].tagline}:
            </span>{' '}
            {DISCOVERY_MODE_CONFIGS[activeMode].description}
          </p>
        </div>
      </section>

      {/* "Make These Recommendations Yours" Callout Banner */}
      <section
        data-testid="guest-personalization-banner"
        className="rounded-2xl border border-indigo-800/60 bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-zinc-900/80 p-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-white">
              ✨ Make These Recommendations Yours
            </h2>
            <p className="mt-1 text-xs text-zinc-300 sm:text-sm">
              You are browsing public upcoming concerts. Sign in to Encore to
              rate your favorite artists, connect your Spotify listening
              history, and get personalized match scores based on your taste,
              travel radius, and ticket budget.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-zinc-900 transition hover:bg-zinc-100"
            >
              Sign In to Personalize
            </Link>
          </div>
        </div>
      </section>

      {/* Filters: Search & City Filter */}
      <section
        data-testid="guest-filters"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <input
              type="text"
              data-testid="search-input"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Filter by artist name, venue, or title..."
              className="focus:outline-hidden w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <select
              data-testid="city-filter"
              value={selectedCity}
              onChange={(e) => handleCityChange(e.target.value)}
              className="focus:outline-hidden w-full rounded-lg border border-zinc-700 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500"
            >
              <option value="">All Cities</option>
              {availableCities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Empty States */}
      {isEmptyCatalog && activeMode === 'all' ? (
        <div
          data-testid="empty-catalog-banner"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
        >
          <h2 className="text-lg font-semibold text-zinc-200">
            No upcoming events found
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Events will appear here as source adapters ingest upcoming shows
            into the catalog.
          </p>
        </div>
      ) : searchQuery.trim().length > 0 || selectedCity.trim().length > 0 ? (
        filteredEvents.length === 0 ? (
          <div
            data-testid="empty-filtered-banner"
            className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
          >
            <h2 className="text-lg font-semibold text-zinc-200">
              No events match your search criteria
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Try adjusting your search query or city filter.
            </p>
            <button
              type="button"
              onClick={handleClearFilters}
              data-testid="clear-filters-btn"
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
            >
              Clear filters
            </button>
          </div>
        ) : null
      ) : events.length === 0 ? (
        <div
          data-testid="no-upcoming-events-banner"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
        >
          <h2 className="text-lg font-semibold text-zinc-200">
            {activeMode !== 'all'
              ? DISCOVERY_MODE_CONFIGS[activeMode].emptyStateHeading
              : 'No upcoming concerts currently scheduled'}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            {activeMode !== 'all'
              ? DISCOVERY_MODE_CONFIGS[activeMode].emptyStateDescription
              : 'There are no upcoming live concerts currently scheduled in the catalog. Check back soon as new tour dates and shows are announced.'}
          </p>
          {activeMode !== 'all' && (
            <button
              type="button"
              onClick={() => handleModeChange('all')}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
            >
              Switch to All Shows
            </button>
          )}
        </div>
      ) : filteredEvents.length === 0 ? (
        <div
          data-testid="empty-filtered-banner"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
        >
          <h2 className="text-lg font-semibold text-zinc-200">
            No events match your search criteria
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Try clearing the search query or selecting All Cities.
          </p>
          {(searchQuery || selectedCity) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCity('');
                refreshPublicEvents({ search: '', city: '' });
              }}
              className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 hover:text-white"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div
          data-testid="guest-events-grid"
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
