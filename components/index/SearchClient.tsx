'use client';

import {
  canonicalGenreLabel,
  eventMatchesGenre,
  genreMatchesQuery,
  normalizeGenreFacets,
} from '@/lib/genres/catalog-genres';
import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import type {
  IndexEventItem,
  IndexSortBy,
  IndexInventoryStatus,
} from './types';
import { toIndexEventItem } from './types';
import {
  DISCOVER_TIMEZONE,
  getDiscoverDateWindows,
} from '@/lib/discover/dates';
import { deriveLocalDateFromInstant } from '@/lib/domain/value-objects';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';
import { EventCard } from './EventCard';
import { EventListItem } from './EventListItem';
import { UndoToast } from './UndoToast';
import { useWatchlist } from './useWatchlist';
import { SavedShowTicker } from './SavedShowTicker';
import {
  SearchIcon,
  SlidersIcon,
  LayoutGridIcon,
  LayoutListIcon,
  XIcon,
  CalendarIcon,
  TicketIcon,
} from './icons';

export interface SearchClientProps {
  events?: Array<CanonicalEventSummary | ScoredEvent | IndexEventItem>;
  initialEvents?: Array<CanonicalEventSummary | ScoredEvent | IndexEventItem>;
  totalCount?: number;
  initialQuery?: string;
  initialSortBy?: IndexSortBy;
  referenceDate?: string;
  title?: string;
  subtitle?: string;
  /** Optional filter state hydrated from /search URL params (set by the page). */
  initialVenue?: string;
  initialCity?: string;
  initialGenre?: string;
  initialStartDate?: string;
  initialEndDate?: string;
  initialFreeOnly?: boolean;
  /** Hydrated from ?maxPrice= so "Under $30" links keep their price cap. */
  initialMaxPrice?: number;
  /** Hydrated from ?includeUnknownPrice=false (verified prices only). */
  initialIncludeUnknownPrice?: boolean;
  initialFacets?: {
    venues?: Array<{ id: string; name: string; city?: string }>;
    cities?: string[];
    genres?: string[];
  };
}

/** Today (YYYY-MM-DD) in the Discover timezone, never the browser's UTC date. */
function resolveRefIso(referenceDate?: string): string {
  if (referenceDate) return referenceDate;
  return deriveLocalDateFromInstant(
    new Date().toISOString(),
    DISCOVER_TIMEZONE,
  );
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The inclusive date window for a quick date chip; shared by server query + local filter. */
function quickDateWindow(
  filter: string,
  refIso: string,
): { start: string; end: string } | null {
  if (filter === 'today') return { start: refIso, end: refIso };
  if (filter === 'next_7_days') {
    return { start: refIso, end: addDaysIso(refIso, 7) };
  }
  if (filter === 'this_weekend') {
    const w = getDiscoverDateWindows(new Date(`${refIso}T12:00:00Z`)).weekend;
    return { start: w.startDate, end: w.endDate };
  }
  return null;
}

export function SearchClient({
  events: rawEvents,
  initialEvents: rawInitialEvents,
  totalCount,
  initialQuery = '',
  initialSortBy = 'date_asc',
  referenceDate,
  title = 'Discover Live Music',
  subtitle = 'Curated concerts, transparent pricing, and personalized music discovery.',
  initialVenue,
  initialCity,
  initialGenre,
  initialStartDate,
  initialEndDate,
  initialFreeOnly = false,
  initialMaxPrice,
  initialIncludeUnknownPrice = true,
  initialFacets,
}: SearchClientProps) {
  const baseRaw = rawInitialEvents ?? rawEvents ?? [];
  const [eventsList, setEventsList] = useState<IndexEventItem[]>(() =>
    baseRaw.map(toIndexEventItem),
  );
  const [serverTotalCount, setServerTotalCount] = useState<number>(
    totalCount ?? baseRaw.length,
  );
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(() => {
    if (totalCount !== undefined) {
      return baseRaw.length < totalCount;
    }
    return baseRaw.length >= 50;
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isServerSearching, setIsServerSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const isInitialMount = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  // Catalog-wide facets
  const [catalogFacets, setCatalogFacets] = useState<{
    venues: Array<{ id?: string; name: string }>;
    cities: string[];
    genres: string[];
  }>({
    venues: initialFacets?.venues || [],
    cities: initialFacets?.cities || [],
    genres: initialFacets?.genres || [],
  });

  // Name -> id normalisation of a URL venue must wait for the FULL venue list;
  // before that, only the venues present in the first page of results are known.
  const [facetsReady, setFacetsReady] = useState(
    (initialFacets?.venues?.length ?? 0) > 0,
  );

  useEffect(() => {
    let cancelled = false;
    async function fetchCatalogFacets() {
      try {
        const res = await fetch('/api/catalog/facets');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.venues) {
            setFacetsReady(true);
            setCatalogFacets({
              venues: data.venues || [],
              cities: data.cities || [],
              genres: data.genres || [],
            });
          }
        }
      } catch {
        // Fall back gracefully
      }
    }
    fetchCatalogFacets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const list = (rawInitialEvents ?? rawEvents ?? []).map(toIndexEventItem);
    setEventsList(list);
    setServerTotalCount(totalCount ?? list.length);
    setHasMore(
      totalCount !== undefined ? list.length < totalCount : list.length >= 50,
    );
    setCurrentPage(1);
  }, [rawEvents, rawInitialEvents, totalCount]);

  const normalizedEvents = eventsList;

  const { isSaved, hasAlert, toggleSave, toggleAlert, undoStack, undo } =
    useWatchlist();

  // Search & Filter State
  const [query, setQuery] = useState(initialQuery);
  const [dateFilter, setDateFilter] = useState<string>(
    initialStartDate || initialEndDate ? 'custom' : 'all',
  );
  const [customStartDate, setCustomStartDate] = useState(
    initialStartDate ?? '',
  );
  const [customEndDate, setCustomEndDate] = useState(initialEndDate ?? '');
  // A URL price cap maps onto a preset when it matches one exactly; otherwise it
  // becomes the strict budget slider so the cap is never silently dropped.
  const presetForCap =
    initialMaxPrice === 25
      ? 'under_25'
      : initialMaxPrice === 50
        ? 'under_50'
        : initialMaxPrice === 100
          ? 'under_100'
          : null;
  const capUsesBudget =
    initialMaxPrice !== undefined &&
    !initialFreeOnly &&
    (presetForCap === null || !initialIncludeUnknownPrice);
  const [pricePreset, setPricePreset] = useState<string>(
    initialFreeOnly
      ? 'free'
      : presetForCap && !capUsesBudget
        ? presetForCap
        : 'all',
  );
  const [maxPriceBudget, setMaxPriceBudget] = useState<number>(
    capUsesBudget
      ? Math.min(Math.max(Math.round(initialMaxPrice! / 5) * 5, 10), 250)
      : 150,
  );
  const [outsideBudgetAllowed, setOutsideBudgetAllowed] =
    useState(!capUsesBudget);
  const [includeUnknownPrice] = useState(initialIncludeUnknownPrice);
  const [selectedVenue, setSelectedVenue] = useState<string>(
    initialVenue || 'all',
  );
  const [selectedCity, setSelectedCity] = useState<string>(
    initialCity || 'all',
  );
  const [selectedGenre, setSelectedGenre] = useState<string>(
    (initialGenre && (canonicalGenreLabel(initialGenre) ?? initialGenre)) ||
      'all',
  );
  const [statusFilter, setStatusFilter] = useState<
    IndexInventoryStatus | 'all'
  >('all');
  const [sortBy, setSortBy] = useState<IndexSortBy>(initialSortBy);
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Venue options: one per venue id (no duplicate keys). Rooms that share a
  // display name get their city appended so they can be told apart. A venue
  // given by NAME in the URL (homepage chips) that matches no id stays
  // selectable as a synthetic name-based option so the control reflects the URL.
  const uniqueVenues = useMemo(() => {
    const byId = new Map<
      string,
      { id?: string; name: string; city?: string }
    >();
    const noId = new Map<string, { id?: string; name: string }>();
    if (catalogFacets.venues.length > 0) {
      for (const v of catalogFacets.venues as Array<{
        id?: string;
        name: string;
        city?: string;
      }>) {
        if (v.id) {
          if (!byId.has(v.id)) byId.set(v.id, v);
        } else if (!noId.has(v.name)) {
          noId.set(v.name, { name: v.name });
        }
      }
    } else {
      normalizedEvents.forEach((e) => {
        if (!e.venueName || e.venueName === 'Venue TBA') return;
        if (e.venueId) {
          if (!byId.has(e.venueId)) {
            byId.set(e.venueId, {
              id: e.venueId,
              name: e.venueName,
              city: e.city ?? undefined,
            });
          }
        } else if (!noId.has(e.venueName)) {
          noId.set(e.venueName, { name: e.venueName });
        }
      });
    }
    const nameCounts = new Map<string, number>();
    byId.forEach((v) =>
      nameCounts.set(v.name, (nameCounts.get(v.name) ?? 0) + 1),
    );
    const list: Array<{ id?: string; name: string; label: string }> = [];
    byId.forEach((v) =>
      list.push({
        id: v.id,
        name: v.name,
        label:
          (nameCounts.get(v.name) ?? 0) > 1 && v.city
            ? `${v.name} — ${v.city}`
            : v.name,
      }),
    );
    noId.forEach((v) => {
      if (!nameCounts.has(v.name)) list.push({ ...v, label: v.name });
    });
    // URL gave a venue name that no option covers yet (facets still loading).
    if (
      selectedVenue !== 'all' &&
      !list.some(
        (v) => v.id === selectedVenue || (!v.id && v.name === selectedVenue),
      )
    ) {
      const sameName = list.filter((v) => v.id && v.name === selectedVenue);
      // A name that resolves to exactly one venue is swapped for its id by the
      // effect below; several same-name rooms stay a name (all of them) filter.
      if (sameName.length !== 1) {
        list.push({
          name: selectedVenue,
          label: sameName.length > 1 ? `${selectedVenue} (all)` : selectedVenue,
        });
      }
    }
    // Identical labels (same name AND city) get a stable ordinal so the picker
    // never shows two indistinguishable options.
    const labelCounts = new Map<string, number>();
    list.forEach((v) =>
      labelCounts.set(v.label, (labelCounts.get(v.label) ?? 0) + 1),
    );
    const seenLabels = new Map<string, number>();
    list
      .slice()
      .sort((a, b) => (a.id ?? a.name).localeCompare(b.id ?? b.name))
      .forEach((v) => {
        if ((labelCounts.get(v.label) ?? 0) > 1) {
          const n = (seenLabels.get(v.label) ?? 0) + 1;
          seenLabels.set(v.label, n);
          v.label = `${v.label} (${n})`;
        }
      });
    return list.sort((a, b) => a.label.localeCompare(b.label));
  }, [catalogFacets.venues, normalizedEvents, selectedVenue]);

  // Normalise a venue NAME from the URL to its venue id once options are known.
  useEffect(() => {
    if (selectedVenue === 'all' || !facetsReady) return;
    if (uniqueVenues.some((v) => v.id === selectedVenue)) return;
    const matches = uniqueVenues.filter(
      (v) => v.id && v.name === selectedVenue,
    );
    if (matches.length === 1 && matches[0].id) {
      setSelectedVenue(matches[0].id);
    }
  }, [uniqueVenues, selectedVenue, facetsReady]);

  const uniqueCities = useMemo(() => {
    if (catalogFacets.cities.length > 0) {
      return catalogFacets.cities;
    }
    const set = new Set<string>();
    normalizedEvents.forEach((e) => {
      if (e.city) set.add(e.city);
    });
    return Array.from(set).sort();
  }, [catalogFacets.cities, normalizedEvents]);

  const uniqueGenres = useMemo(() => {
    // Shared vocabulary: non-genres dropped, raw strings collapsed to canonical labels.
    if (catalogFacets.genres.length > 0) {
      return normalizeGenreFacets(catalogFacets.genres);
    }
    return normalizeGenreFacets(normalizedEvents.map((e) => e.genre));
  }, [catalogFacets.genres, normalizedEvents]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (query.trim()) count++;
    if (dateFilter !== 'all') count++;
    if (pricePreset !== 'all') count++;
    if (!outsideBudgetAllowed) count++;
    if (selectedVenue !== 'all') count++;
    if (selectedCity !== 'all') count++;
    if (selectedGenre !== 'all') count++;
    if (statusFilter !== 'all') count++;
    return count;
  }, [
    query,
    dateFilter,
    pricePreset,
    outsideBudgetAllowed,
    selectedVenue,
    selectedCity,
    selectedGenre,
    statusFilter,
  ]);

  const handleResetFilters = () => {
    setQuery('');
    setDateFilter('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setPricePreset('all');
    setMaxPriceBudget(150);
    setOutsideBudgetAllowed(true);
    setSelectedVenue('all');
    setSelectedCity('all');
    setSelectedGenre('all');
    setStatusFilter('all');
    setSortBy('date_asc');
    setSearchError(null);
    setCurrentPage(1);
  };

  const buildSearchParams = useCallback(
    (pageNumber: number) => {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (selectedVenue !== 'all') {
        const found = uniqueVenues.find((v) => v.id === selectedVenue);
        if (found?.id) {
          params.set('venueId', found.id);
        } else {
          params.set('venue', selectedVenue);
        }
      }
      if (selectedCity !== 'all') params.set('city', selectedCity);
      if (selectedGenre !== 'all') params.set('genre', selectedGenre);

      const refIso = resolveRefIso(referenceDate);
      const quick = quickDateWindow(dateFilter, refIso);
      if (quick) {
        params.set('startDate', quick.start);
        params.set('endDate', quick.end);
      } else if (dateFilter === 'custom') {
        if (customStartDate) params.set('startDate', customStartDate);
        if (customEndDate) params.set('endDate', customEndDate);
      }

      if (pricePreset === 'free') {
        params.set('freeOnly', 'true');
      } else if (pricePreset === 'under_25') {
        params.set('maxPrice', '25');
      } else if (pricePreset === 'under_50') {
        params.set('maxPrice', '50');
      } else if (pricePreset === 'under_100') {
        params.set('maxPrice', '100');
      }

      if (!outsideBudgetAllowed) {
        params.set('maxPrice', String(maxPriceBudget));
      }
      if (!includeUnknownPrice && params.has('maxPrice')) {
        params.set('includeUnknownPrice', 'false');
      }

      if (sortBy) {
        params.set('sort', sortBy);
      }

      params.set('limit', '50');
      params.set('page', String(pageNumber));

      return params;
    },
    [
      query,
      selectedVenue,
      selectedCity,
      selectedGenre,
      uniqueVenues,
      dateFilter,
      customStartDate,
      customEndDate,
      pricePreset,
      outsideBudgetAllowed,
      maxPriceBudget,
      includeUnknownPrice,
      sortBy,
      referenceDate,
    ],
  );

  const executeSearch = useCallback(
    async (pageNumber: number = 1) => {
      if (typeof fetch !== 'function') return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const currentRequestId = ++requestIdRef.current;

      try {
        setIsServerSearching(true);
        setSearchError(null);
        const params = buildSearchParams(pageNumber);
        const res = await fetch(`/api/catalog/search?${params.toString()}`, {
          signal: controller.signal,
        });

        if (currentRequestId !== requestIdRef.current) return;

        if (res.ok) {
          const data = await res.json();
          const items: Array<CanonicalEventSummary | IndexEventItem> =
            Array.isArray(data) ? data : data.events || [];
          const pagination = Array.isArray(data) ? null : data.pagination;

          setEventsList(items.map(toIndexEventItem));
          setCurrentPage(pageNumber);
          if (pagination) {
            setServerTotalCount(pagination.totalCount);
            setHasMore(pagination.hasMore);
          } else {
            setServerTotalCount(items.length);
            setHasMore(items.length >= 50);
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          setSearchError(
            errData.error || 'Failed to search concerts. Please try again.',
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        if (currentRequestId === requestIdRef.current) {
          console.error('[SearchClient] Error searching events:', err);
          setSearchError(
            'Network error while searching concerts. Please check your connection.',
          );
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsServerSearching(false);
        }
      }
    },
    [buildSearchParams],
  );

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Immediately cancel any in-flight load-more or search requests when filter dependencies change
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    requestIdRef.current++;

    const timer = setTimeout(() => {
      executeSearch(1);
    }, 250);

    return () => clearTimeout(timer);
  }, [executeSearch]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore || typeof fetch !== 'function') return;
    setIsLoadingMore(true);
    setSearchError(null);

    // Participate in request-version tracking so filter changes cancel stale Load More
    const loadMoreRequestId = ++requestIdRef.current;

    try {
      const nextPage = currentPage + 1;
      const params = buildSearchParams(nextPage);

      // Use AbortController so filter changes can cancel this request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await fetch(`/api/catalog/search?${params.toString()}`, {
        signal: controller.signal,
      });

      // If filters changed while this was in-flight, discard the result
      if (loadMoreRequestId !== requestIdRef.current) {
        return;
      }

      if (res.ok) {
        const data = await res.json();
        const items: Array<CanonicalEventSummary | IndexEventItem> =
          Array.isArray(data) ? data : data.events || [];
        const pagination = Array.isArray(data) ? null : data.pagination;
        const normalized = items.map(toIndexEventItem);

        setEventsList((prev) => {
          const seen = new Set(prev.map((e) => e.id));
          const unique = normalized.filter((e) => !seen.has(e.id));
          return [...prev, ...unique];
        });
        setCurrentPage(nextPage);
        if (pagination) {
          setServerTotalCount(pagination.totalCount);
          setHasMore(pagination.hasMore);
        } else {
          setHasMore(normalized.length >= 50);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setSearchError(errData.error || 'Failed to load more concerts.');
      }
    } catch (err) {
      // Ignore abort errors from filter changes
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      console.error('[SearchClient] Error loading more events:', err);
      setSearchError('Network error while loading more concerts.');
    } finally {
      if (loadMoreRequestId === requestIdRef.current) {
        setIsLoadingMore(false);
      }
    }
  };

  // Filter and sort engine
  const filteredEvents = useMemo(() => {
    const refIso = resolveRefIso(referenceDate);
    const quick = quickDateWindow(dateFilter, refIso);

    return normalizedEvents.filter((event) => {
      // 1. Keyword search
      if (query.trim()) {
        const q = query.toLowerCase().trim();
        const headlinerMatch = event.headlinerName?.toLowerCase().includes(q);
        const titleMatch = event.title?.toLowerCase().includes(q);
        const artistMatch = event.artists?.some((a) =>
          a.name.toLowerCase().includes(q),
        );
        const venueMatch = event.venueName?.toLowerCase().includes(q);
        const cityMatch = event.city?.toLowerCase().includes(q);
        const genreMatch = genreMatchesQuery(q, event.genre, event.subgenres);
        const vibeMatch = event.vibeTags?.some((v) =>
          v.toLowerCase().includes(q),
        );

        if (
          !headlinerMatch &&
          !titleMatch &&
          !artistMatch &&
          !venueMatch &&
          !cityMatch &&
          !genreMatch &&
          !vibeMatch
        ) {
          return false;
        }
      }

      // 2. Date Filter
      if (quick) {
        if (
          event.localStartDate < quick.start ||
          event.localStartDate > quick.end
        ) {
          return false;
        }
      } else if (dateFilter === 'custom') {
        if (customStartDate && event.localStartDate < customStartDate) {
          return false;
        }
        if (customEndDate && event.localStartDate > customEndDate) {
          return false;
        }
      }

      // 3. Price Filter
      if (pricePreset === 'free') {
        if (event.minPrice !== 0 && event.eventKind !== 'free_event') {
          return false;
        }
      } else if (pricePreset === 'under_25') {
        if (event.minPrice != null && event.minPrice > 25) return false;
      } else if (pricePreset === 'under_50') {
        if (event.minPrice != null && event.minPrice > 50) return false;
      } else if (pricePreset === 'under_100') {
        if (event.minPrice != null && event.minPrice > 100) return false;
      }

      // Price budget slider
      if (!outsideBudgetAllowed && event.minPrice != null) {
        if (event.minPrice > maxPriceBudget) return false;
      }
      if (
        !includeUnknownPrice &&
        event.minPrice == null &&
        event.eventKind !== 'free_event'
      ) {
        return false;
      }

      // 4. Venue Filter
      if (
        selectedVenue !== 'all' &&
        event.venueId !== selectedVenue &&
        event.venueName !== selectedVenue
      ) {
        return false;
      }

      // 5. City Filter
      if (selectedCity !== 'all' && event.city !== selectedCity) {
        return false;
      }

      // 6. Genre Filter (checks event genre metadata and subgenres)
      if (selectedGenre !== 'all') {
        if (!eventMatchesGenre(selectedGenre, event.genre, event.subgenres)) {
          return false;
        }
      }

      // 7. Inventory Status
      if (statusFilter !== 'all') {
        if (event.inventoryStatus !== statusFilter) {
          return false;
        }
      }

      return true;
    });
  }, [
    normalizedEvents,
    query,
    dateFilter,
    customStartDate,
    customEndDate,
    pricePreset,
    maxPriceBudget,
    outsideBudgetAllowed,
    includeUnknownPrice,
    selectedVenue,
    selectedCity,
    selectedGenre,
    statusFilter,
    referenceDate,
  ]);

  // Sort filtered results
  const sortedEvents = useMemo(() => {
    const list = [...filteredEvents];
    list.sort((a, b) => {
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
    return list;
  }, [filteredEvents, sortBy]);

  return (
    <div className="space-y-6 pb-16">
      {/* Saved Shows Ticker Notification */}
      <SavedShowTicker events={eventsList} />

      {/* Search Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200/80 pb-6 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">
            {title}
          </h1>
          <p className="mt-1 max-w-xl text-xs text-zinc-500 sm:text-sm">
            {subtitle}
          </p>
        </div>

        {/* View Toggle & Filter Button (Mobile) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
            className="shadow-2xs flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 md:hidden"
          >
            <SlidersIcon className="h-3.5 w-3.5 text-zinc-500" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

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
      </div>

      {/* Main Search Input */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by artist, headliner, venue, city, or genre..."
          className="shadow-2xs focus:outline-hidden w-full rounded-2xl border border-zinc-200 bg-white py-3.5 pl-12 pr-10 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-900"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:text-zinc-600"
            aria-label="Clear search query"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Layout Grid: Left Sidebar Filters (Desktop) + Right Event Feed */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
        {/* Desktop Filter Sidebar */}
        <aside
          className={`shadow-2xs space-y-6 rounded-2xl border border-zinc-200/90 bg-white p-5 md:block ${
            mobileFiltersOpen ? 'block' : 'hidden md:block'
          }`}
        >
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
              <SlidersIcon className="h-3.5 w-3.5" />
              <span>Filters ({activeFilterCount})</span>
            </h2>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs font-semibold text-rose-600 hover:underline"
              >
                Reset All
              </button>
            )}
          </div>

          {/* Date Filter */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
              <CalendarIcon className="h-3.5 w-3.5 text-zinc-400" />
              <span>Date Range</span>
            </label>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="focus:outline-hidden w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-zinc-900"
            >
              <option value="all">All Dates</option>
              <option value="today">Today Only</option>
              <option value="this_weekend">This Weekend</option>
              <option value="next_7_days">Next 7 Days</option>
              <option value="custom">Custom Range</option>
            </select>

            {dateFilter === 'custom' && (
              <div className="mt-2 space-y-2 pt-1">
                <div>
                  <span className="text-[10px] text-zinc-400">From:</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-zinc-400">To:</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full rounded border border-zinc-200 px-2 py-1 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Price Preset & Slider */}
          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
              <TicketIcon className="h-3.5 w-3.5 text-zinc-400" />
              <span>Ticket Pricing</span>
            </label>
            <select
              value={pricePreset}
              onChange={(e) => setPricePreset(e.target.value)}
              className="focus:outline-hidden w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-zinc-900"
            >
              <option value="all">All Prices</option>
              <option value="free">Free ($0) Only</option>
              <option value="under_25">Under $25</option>
              <option value="under_50">Under $50</option>
              <option value="under_100">Under $100</option>
            </select>

            {/* Budget Slider */}
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-600">
                <span>Max Budget:</span>
                <span className="font-mono font-semibold">
                  ${maxPriceBudget}
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="250"
                step="5"
                value={maxPriceBudget}
                onChange={(e) => setMaxPriceBudget(Number(e.target.value))}
                className="w-full accent-zinc-900"
              />

              <label className="mt-2 flex items-center gap-2 pt-1 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={outsideBudgetAllowed}
                  onChange={(e) => setOutsideBudgetAllowed(e.target.checked)}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span>Include shows outside budget</span>
              </label>
            </div>
          </div>

          {/* Venue Selector */}
          {uniqueVenues.length > 0 && (
            <div className="space-y-2 border-t border-zinc-100 pt-4">
              <label
                htmlFor="search-venue-select"
                className="text-xs font-semibold text-zinc-800"
              >
                Venue
              </label>
              <select
                id="search-venue-select"
                value={selectedVenue}
                onChange={(e) => setSelectedVenue(e.target.value)}
                className="focus:outline-hidden w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-zinc-900"
              >
                <option value="all">All Venues</option>
                {uniqueVenues.map((v) => (
                  <option key={v.id ?? `name:${v.name}`} value={v.id ?? v.name}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* City Selector */}
          {uniqueCities.length > 0 && (
            <div className="space-y-2 border-t border-zinc-100 pt-4">
              <label className="text-xs font-semibold text-zinc-800">
                City / Region
              </label>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="focus:outline-hidden w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-zinc-900"
              >
                <option value="all">All Cities</option>
                {uniqueCities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Genre Selector */}
          {uniqueGenres.length > 0 && (
            <div className="space-y-2 border-t border-zinc-100 pt-4">
              <label className="text-xs font-semibold text-zinc-800">
                Genre
              </label>
              <select
                value={selectedGenre}
                onChange={(e) => setSelectedGenre(e.target.value)}
                className="focus:outline-hidden w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-zinc-900"
              >
                <option value="all">All Genres</option>
                {(selectedGenre !== 'all' &&
                !uniqueGenres.includes(selectedGenre)
                  ? [selectedGenre, ...uniqueGenres]
                  : uniqueGenres
                ).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Inventory Status */}
          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <label className="text-xs font-semibold text-zinc-800">
              Availability
            </label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as IndexInventoryStatus | 'all')
              }
              className="focus:outline-hidden w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-zinc-900"
            >
              <option value="all">All Statuses</option>
              <option value="available">Tickets Available</option>
              <option value="low_inventory">Low Inventory</option>
              <option value="sold_out">Sold Out</option>
            </select>
          </div>
        </aside>

        {/* Results Column */}
        <main className="space-y-4 md:col-span-3">
          {searchError && (
            <div
              className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800"
              role="alert"
            >
              <span>{searchError}</span>
              <button
                type="button"
                data-testid="search-retry-btn"
                onClick={() => {
                  executeSearch(currentPage);
                }}
                className="rounded-lg bg-red-800 px-3 py-1 font-semibold text-white hover:bg-red-900"
              >
                Retry
              </button>
            </div>
          )}

          {/* Controls Bar: Results Count + Sort Dropdown */}
          <div className="shadow-2xs flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200/90 bg-white px-4 py-2.5">
            <span className="text-xs text-zinc-600">
              {serverTotalCount > sortedEvents.length ? (
                <>
                  Showing{' '}
                  <span className="font-semibold text-zinc-900">
                    {sortedEvents.length}
                  </span>{' '}
                  of{' '}
                  <span className="font-semibold text-zinc-900">
                    {serverTotalCount}
                  </span>{' '}
                  concerts
                </>
              ) : (
                <>
                  Found{' '}
                  <span className="font-semibold text-zinc-900">
                    {sortedEvents.length}
                  </span>{' '}
                  concerts
                </>
              )}
              {isServerSearching && (
                <span className="ml-2 inline-block h-2 w-2 animate-ping rounded-full bg-zinc-400" />
              )}
            </span>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as IndexSortBy)}
                aria-label="Sort search results"
                className="focus:outline-hidden rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 focus:border-zinc-900"
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

          {/* Event Results Display */}
          {sortedEvents.length === 0 ? (
            <div className="space-y-4 rounded-3xl border border-dashed border-zinc-300 bg-white p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400">
                <SearchIcon className="h-6 w-6" />
              </div>
              <h2 className="text-base font-semibold text-zinc-900">
                No Concerts Matched Your Query
              </h2>
              <p className="mx-auto max-w-sm text-xs text-zinc-500">
                We couldn’t find any events matching your selected filters. Try
                broadening your price ceiling or resetting filters.
              </p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="shadow-xs rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
              >
                Reset All Filters
              </button>
            </div>
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {sortedEvents.map((event) => (
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
              {sortedEvents.map((event) => (
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

          {hasMore && (
            <div className="flex justify-center pb-4 pt-6">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="shadow-xs inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-xs font-semibold text-zinc-800 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:opacity-50"
              >
                {isLoadingMore ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-900" />
                    <span>Loading more concerts...</span>
                  </>
                ) : (
                  <>
                    <span>Load More Concerts</span>
                    <span className="font-normal text-zinc-500">
                      ({sortedEvents.length} of {serverTotalCount})
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Undo Toast */}
      <UndoToast undoStack={undoStack} onUndo={undo} />
    </div>
  );
}
