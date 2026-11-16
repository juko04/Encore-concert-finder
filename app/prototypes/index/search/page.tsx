'use client';

import React, { useState, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { usePrototypeStore } from '@/lib/prototypes/store';
import { EventCard } from '@/components/prototypes/index/EventCard';
import { EventListItem } from '@/components/prototypes/index/EventListItem';
import { calculateDistanceMiles } from '@/components/prototypes/index/formatters';
import {
  SearchIcon,
  SlidersIcon,
  LayoutGridIcon,
  LayoutListIcon,
  XIcon,
  HeartIcon,
  BellIcon,
} from '@/components/prototypes/index/icons';

function SearchExperienceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    events,
    savedEventIds,
    alertEventIds,
    viewMode,
    toggleSaveEvent,
    toggleAlertEvent,
  } = usePrototypeStore();

  const isAuth = viewMode === 'authenticated';

  // Read initial filter values from URL search params if present
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [dateFilter, setDateFilter] = useState(
    searchParams.get('date') || 'all',
  );
  const [priceFilter, setPriceFilter] = useState(
    searchParams.get('price') || 'all',
  );
  const [cityFilter, setCityFilter] = useState(
    searchParams.get('city') || 'all',
  );
  const [genreFilter, setGenreFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [venueFilter, setVenueFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get('status') || 'all',
  );
  const [savedOnly, setSavedOnly] = useState(false);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [includeSuppressed, setIncludeSuppressed] = useState(false);
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'date_asc');
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Collect unique genres and venues from fixtures for dynamic filter options
  const uniqueGenres = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => set.add(e.genre));
    return Array.from(set);
  }, [events]);

  const uniqueVenues = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => set.add(e.venueName));
    return Array.from(set);
  }, [events]);

  const uniqueCities = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.city) set.add(e.city);
    });
    return Array.from(set);
  }, [events]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (query.trim()) count++;
    if (dateFilter !== 'all') count++;
    if (priceFilter !== 'all') count++;
    if (cityFilter !== 'all') count++;
    if (genreFilter !== 'all') count++;
    if (ageFilter !== 'all') count++;
    if (venueFilter !== 'all') count++;
    if (statusFilter !== 'all') count++;
    if (savedOnly) count++;
    if (alertsOnly) count++;
    return count;
  }, [
    query,
    dateFilter,
    priceFilter,
    cityFilter,
    genreFilter,
    ageFilter,
    venueFilter,
    statusFilter,
    savedOnly,
    alertsOnly,
  ]);

  const handleResetFilters = () => {
    setQuery('');
    setDateFilter('all');
    setPriceFilter('all');
    setCityFilter('all');
    setGenreFilter('all');
    setAgeFilter('all');
    setVenueFilter('all');
    setStatusFilter('all');
    setSavedOnly(false);
    setAlertsOnly(false);
    setIncludeSuppressed(false);
    setSortBy('date_asc');
    router.replace('/prototypes/index/search');
  };

  // Filter and Sort Engine
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // 1. Text Query
      if (query.trim()) {
        const q = query.toLowerCase();
        const artistMatch = event.artists.some((a) =>
          a.name.toLowerCase().includes(q),
        );
        const titleMatch = event.title.toLowerCase().includes(q);
        const venueMatch = event.venueName.toLowerCase().includes(q);
        const genreMatch = event.genre.toLowerCase().includes(q);
        const vibeMatch = event.vibeTags.some((v) =>
          v.toLowerCase().includes(q),
        );
        if (
          !artistMatch &&
          !titleMatch &&
          !venueMatch &&
          !genreMatch &&
          !vibeMatch
        ) {
          return false;
        }
      }

      // 2. Date Filter
      if (dateFilter === 'this_weekend') {
        const isWeekend = ['2026-11-13', '2026-11-14', '2026-11-15'].includes(
          event.localStartDate,
        );
        if (!isWeekend) return false;
      } else if (dateFilter === 'next_7_days') {
        if (event.localStartDate > '2026-11-20') return false;
      } else if (dateFilter === 'november') {
        if (!event.localStartDate.startsWith('2026-11')) return false;
      } else if (dateFilter === 'december') {
        if (!event.localStartDate.startsWith('2026-12')) return false;
      }

      // 3. Price Filter
      if (priceFilter === 'free') {
        if (event.minPrice !== 0) return false;
      } else if (priceFilter === 'under_25' || priceFilter === 'under_30') {
        const threshold = priceFilter === 'under_30' ? 30 : 25;
        if (
          event.minPrice === null ||
          event.minPrice === undefined ||
          event.minPrice > threshold
        ) {
          return false;
        }
      } else if (priceFilter === 'under_50') {
        if (
          event.minPrice === null ||
          event.minPrice === undefined ||
          event.minPrice > 50
        ) {
          return false;
        }
      } else if (priceFilter === 'under_100') {
        if (
          event.minPrice === null ||
          event.minPrice === undefined ||
          event.minPrice > 100
        ) {
          return false;
        }
      }

      // 4. City Filter
      if (cityFilter !== 'all' && event.city !== cityFilter) {
        return false;
      }

      // 5. Genre Filter
      if (genreFilter !== 'all' && event.genre !== genreFilter) {
        return false;
      }

      // 6. Age Filter
      if (ageFilter !== 'all' && event.ageRestriction !== ageFilter) {
        return false;
      }

      // 7. Venue Filter
      if (venueFilter !== 'all' && event.venueName !== venueFilter) {
        return false;
      }

      // 8. Status Filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'presale') {
          if (event.ticketStatus !== 'presale') return false;
        } else if (statusFilter === 'low_inventory') {
          if (event.ticketStatus !== 'low_inventory') return false;
        } else if (statusFilter === 'available') {
          if (event.ticketStatus !== 'available') return false;
        } else if (statusFilter === 'sold_out') {
          if (event.ticketStatus !== 'sold_out') return false;
        }
      }

      // 9. Saved / Alerts Only
      if (savedOnly && !savedEventIds.includes(event.id)) {
        return false;
      }
      if (alertsOnly && !alertEventIds.includes(event.id)) {
        return false;
      }

      // 10. Invariant 11 Suppression Rule (Authenticated Member mode)
      if (isAuth && !includeSuppressed) {
        if (event.samplePersonalScore.affinityType === 'disliked') {
          return false;
        }
      }

      return true;
    });
  }, [
    events,
    query,
    dateFilter,
    priceFilter,
    cityFilter,
    genreFilter,
    ageFilter,
    venueFilter,
    statusFilter,
    savedOnly,
    alertsOnly,
    isAuth,
    includeSuppressed,
    savedEventIds,
    alertEventIds,
  ]);

  // Sorting
  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      if (sortBy === 'date_asc') {
        return a.localStartDate.localeCompare(b.localStartDate);
      }
      if (sortBy === 'price_asc') {
        const priceA = a.minPrice ?? 9999;
        const priceB = b.minPrice ?? 9999;
        return priceA - priceB;
      }
      if (sortBy === 'distance_asc') {
        const distA = calculateDistanceMiles(a.lat, a.lng) ?? 9999;
        const distB = calculateDistanceMiles(b.lat, b.lng) ?? 9999;
        return distA - distB;
      }
      if (sortBy === 'match' || sortBy === 'relevance') {
        const scoreA = isAuth
          ? a.samplePersonalScore.authenticatedScore
          : a.samplePersonalScore.guestScore;
        const scoreB = isAuth
          ? b.samplePersonalScore.authenticatedScore
          : b.samplePersonalScore.guestScore;
        return scoreB - scoreA;
      }
      return 0;
    });
  }, [filteredEvents, sortBy, isAuth]);

  return (
    <div className="space-y-6">
      {/* Top Search & Filter Bar */}
      <div className="flex flex-col items-stretch justify-between gap-3 border-b border-zinc-200/80 pb-5 sm:flex-row sm:items-center">
        <div className="relative max-w-xl flex-1">
          <SearchIcon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artists, venues, genres, vibes..."
            className="shadow-2xs w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-4 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          {/* Mobile Filter Toggle */}
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="shadow-2xs inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 lg:hidden"
          >
            <SlidersIcon className="h-3.5 w-3.5" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="py-0.2 ml-1 rounded-full bg-zinc-900 px-1.5 text-[10px] text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sort Selector */}
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-xs uppercase text-zinc-400 sm:inline">
              Sort:
            </span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="shadow-2xs rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-zinc-900 focus:outline-none"
            >
              <option value="date_asc">Date (Soonest)</option>
              <option value="match">
                {isAuth ? 'Match Score (Highest)' : 'Curated Rank'}
              </option>
              <option value="price_asc">Price (Low to High)</option>
              <option value="distance_asc">Distance (Closest)</option>
            </select>
          </div>

          {/* View Toggle (Grid vs List) */}
          <div className="shadow-2xs flex items-center rounded-xl border border-zinc-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setViewLayout('grid')}
              aria-label="Grid layout"
              className={`rounded-lg p-1.5 transition-colors ${
                viewLayout === 'grid'
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-400 hover:text-zinc-700'
              }`}
            >
              <LayoutGridIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('list')}
              aria-label="List layout"
              className={`rounded-lg p-1.5 transition-colors ${
                viewLayout === 'list'
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-400 hover:text-zinc-700'
              }`}
            >
              <LayoutListIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout (Sidebar + Results) */}
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-4">
        {/* Desktop Filter Sidebar */}
        <aside className="shadow-xs top-22 sticky hidden space-y-6 rounded-2xl border border-zinc-200/80 bg-white p-5 lg:block">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
              <SlidersIcon className="h-4 w-4" />
              <span>Filter Options</span>
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="font-mono text-xs text-zinc-400 transition-colors hover:text-zinc-800"
              >
                Reset All ({activeFilterCount})
              </button>
            )}
          </div>

          {/* Date Filter */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Date & Timing
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'all', label: 'All Dates' },
                { id: 'this_weekend', label: 'This Weekend' },
                { id: 'next_7_days', label: 'Next 7 Days' },
                { id: 'november', label: 'November' },
                { id: 'december', label: 'December' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDateFilter(item.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-all ${
                    dateFilter === item.id
                      ? 'shadow-xs border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-zinc-50/60 text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Price Range Filter */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Ticket Price
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'all', label: 'Any Price' },
                { id: 'free', label: 'Free ($0)' },
                { id: 'under_25', label: 'Under $25' },
                { id: 'under_50', label: 'Under $50' },
                { id: 'under_100', label: 'Under $100' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPriceFilter(item.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-all ${
                    priceFilter === item.id
                      ? 'shadow-xs border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-zinc-50/60 text-zinc-700 hover:bg-zinc-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* City / Location */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              City / Metro
            </label>
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="shadow-2xs w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-zinc-900 focus:outline-none"
            >
              <option value="all">All Cities (Colorado)</option>
              {uniqueCities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Genre / Style */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Genre & Vibe
            </label>
            <select
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              className="shadow-2xs w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-zinc-900 focus:outline-none"
            >
              <option value="all">All Genres</option>
              {uniqueGenres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Specific Venue */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Venue
            </label>
            <select
              value={venueFilter}
              onChange={(e) => setVenueFilter(e.target.value)}
              className="shadow-2xs w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-zinc-900 focus:outline-none"
            >
              <option value="all">All Venues</option>
              {uniqueVenues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* Ticket Status */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Ticket Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="shadow-2xs w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-zinc-900 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="available">Available Now</option>
              <option value="low_inventory">Low Inventory</option>
              <option value="presale">Upcoming Presale</option>
              <option value="sold_out">Sold Out</option>
            </select>
          </div>

          {/* Quick Toggles: Watchlist / Alerts */}
          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Saved State
            </label>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-700">
                <input
                  type="checkbox"
                  checked={savedOnly}
                  onChange={(e) => setSavedOnly(e.target.checked)}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <HeartIcon className="h-3.5 w-3.5 text-rose-500" />
                <span>Watchlist Only ({savedEventIds.length})</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-700">
                <input
                  type="checkbox"
                  checked={alertsOnly}
                  onChange={(e) => setAlertsOnly(e.target.checked)}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <BellIcon className="h-3.5 w-3.5 text-violet-500" />
                <span>Active Alerts Only ({alertEventIds.length})</span>
              </label>
            </div>
          </div>

          {/* Invariant 11 Suppression Toggle (Member Mode only) */}
          {isAuth && (
            <div className="border-t border-zinc-100 pt-4">
              <label className="flex cursor-pointer items-start gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={includeSuppressed}
                  onChange={(e) => setIncludeSuppressed(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <div>
                  <span className="font-semibold text-zinc-800">
                    Show Disliked Shows
                  </span>
                  <p className="mt-0.5 text-[11px] leading-tight text-zinc-400">
                    Shows headliners suppressed by Invariant 11 (e.g. Neon Hype
                    Machine).
                  </p>
                </div>
              </label>
            </div>
          )}
        </aside>

        {/* Results Column */}
        <main className="space-y-4 lg:col-span-3">
          {/* Results Summary Bar */}
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-zinc-500">
              Showing{' '}
              <span className="font-semibold text-zinc-900">
                {sortedEvents.length}
              </span>{' '}
              of {events.length} concerts in Colorado
            </p>

            {activeFilterCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Event Listing View (Grid vs List) */}
          {sortedEvents.length === 0 ? (
            <div className="space-y-4 rounded-3xl border border-dashed border-zinc-300 bg-white p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
                <SearchIcon className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-zinc-900">
                No matching concerts found
              </h3>
              <p className="mx-auto max-w-sm text-xs text-zinc-500">
                No concerts match your current search and filter combination.
                Try resetting your price or date filters.
              </p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="shadow-xs inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800"
              >
                Reset Filters
              </button>
            </div>
          ) : viewLayout === 'grid' ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {sortedEvents.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  isSaved={savedEventIds.includes(event.id)}
                  hasAlert={alertEventIds.includes(event.id)}
                  viewMode={viewMode}
                  onToggleSave={toggleSaveEvent}
                  onToggleAlert={toggleAlertEvent}
                />
              ))}
            </div>
          ) : (
            <div className="shadow-xs divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white">
              {sortedEvents.map((event) => (
                <EventListItem
                  key={event.id}
                  event={event}
                  isSaved={savedEventIds.includes(event.id)}
                  hasAlert={alertEventIds.includes(event.id)}
                  viewMode={viewMode}
                  onToggleSave={toggleSaveEvent}
                  onToggleAlert={toggleAlertEvent}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Mobile Filters Drawer / Modal */}
      {mobileFiltersOpen && (
        <div className="backdrop-blur-xs animate-in fade-in fixed inset-0 z-50 flex flex-col justify-end bg-black/40 duration-150 lg:hidden">
          <div className="animate-in slide-in-from-bottom max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl duration-200">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
              <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
                <SlidersIcon className="h-4 w-4" />
                <span>Filters & Refinements</span>
              </h3>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-6">
              {/* Date */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-zinc-500">
                  Date Range
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'all', label: 'All Dates' },
                    { id: 'this_weekend', label: 'This Weekend' },
                    { id: 'next_7_days', label: 'Next 7 Days' },
                    { id: 'november', label: 'November' },
                  ].map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDateFilter(d.id)}
                      className={`rounded-lg border p-2 text-left text-xs font-medium ${
                        dateFilter === d.id
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase text-zinc-500">
                  Max Price
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'all', label: 'Any' },
                    { id: 'free', label: 'Free ($0)' },
                    { id: 'under_25', label: 'Under $25' },
                    { id: 'under_50', label: 'Under $50' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPriceFilter(p.id)}
                      className={`rounded-lg border p-2 text-left text-xs font-medium ${
                        priceFilter === p.id
                          ? 'border-zinc-900 bg-zinc-900 text-white'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 border-t border-zinc-100 pt-4">
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-semibold text-zinc-700"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(false)}
                  className="shadow-xs flex-1 rounded-xl bg-zinc-900 py-3 text-xs font-semibold text-white"
                >
                  View ({sortedEvents.length}) Results
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SearchExperiencePage() {
  return (
    <Suspense
      fallback={
        <div className="py-12 text-center font-mono text-xs text-zinc-400">
          Loading live music index...
        </div>
      }
    >
      <SearchExperienceContent />
    </Suspense>
  );
}
