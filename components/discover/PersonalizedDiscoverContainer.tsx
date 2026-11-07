'use client';

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import Link from 'next/link';
import type { PersonalizedDiscoverResult } from '@/lib/recommendation/service';
import type { DiscoveryMode, ScoringPreset } from '@/lib/recommendation/types';
import {
  DISCOVERY_MODES,
  DISCOVERY_MODE_CONFIGS,
} from '@/lib/recommendation/modes';
import { PersonalizedEventCard } from './PersonalizedEventCard';
import {
  updateRecommendationPresetAction,
  updateTravelRadiusAction,
  updateTypicalBudgetAction,
  getPersonalizedRecommendationsAction,
  getCatalogCitiesAction,
} from '@/app/discover/actions';

export interface PersonalizedDiscoverContainerProps {
  initialData: PersonalizedDiscoverResult;
  showScoringInspector?: boolean;
}

const PRESET_CONFIG: Array<{
  id: ScoringPreset;
  label: string;
  description: string;
}> = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Even blend of artists, distance, price & timing',
  },
  {
    id: 'artist_first',
    label: 'Artists',
    description: 'Prioritizes favorite & liked artists above all',
  },
  {
    id: 'nearby',
    label: 'Nearby',
    description: 'Prioritizes shows closest to your home radius',
  },
  {
    id: 'value',
    label: 'Value',
    description: 'Prioritizes low-cost and budget-friendly tickets',
  },
];

const RADIUS_OPTIONS = [15, 25, 50, 100, 200];
const BUDGET_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Any', value: null },
  { label: '$40', value: 40 },
  { label: '$60', value: 60 },
  { label: '$80', value: 80 },
  { label: '$100', value: 100 },
  { label: '$150', value: 150 },
];

export function PersonalizedDiscoverContainer({
  initialData,
  showScoringInspector = false,
}: PersonalizedDiscoverContainerProps) {
  const [isPending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  // Preferences & configuration state
  const [activePreset, setActivePreset] = useState<ScoringPreset>(
    initialData.activePreset,
  );
  const [activeMode, setActiveMode] = useState<DiscoveryMode>(
    initialData.activeMode ?? 'all',
  );
  const [radiusMiles, setRadiusMiles] = useState<number>(
    initialData.userProfile?.defaultRadiusMiles ?? 25,
  );
  const [budget, setBudget] = useState<number | null>(
    initialData.userProfile?.maxNormalTicketPrice ?? null,
  );

  // Recommendations data: full candidate pool and metadata maintained in state
  const [recommendations, setRecommendations] = useState(
    initialData.recommendations,
  );
  const [exploratory, setExploratory] = useState(initialData.exploratory);
  const [totalCandidateCount, setTotalCandidateCount] = useState<number>(
    initialData.totalCandidateCount,
  );
  const [suppressedCount, setSuppressedCount] = useState<number>(
    initialData.suppressed.length,
  );
  const [ineligibleCount, setIneligibleCount] = useState<number>(
    initialData.ineligibleCount,
  );

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [catalogCities, setCatalogCities] = useState<string[]>([]);

  // Status state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Load unique catalog cities from server for the city filter dropdown
  useEffect(() => {
    getCatalogCitiesAction().then((res) => {
      if (res.success && res.data && res.data.length > 0) {
        setCatalogCities(res.data);
      }
    });
  }, []);

  // Compute available cities from either server list or loaded events
  const availableCities = useMemo(() => {
    if (catalogCities.length > 0) return catalogCities;
    const citySet = new Set<string>();
    for (const rec of recommendations) {
      if (rec.event.city?.trim()) citySet.add(rec.event.city.trim());
    }
    for (const exp of exploratory) {
      if (exp.event.city?.trim()) citySet.add(exp.event.city.trim());
    }
    return Array.from(citySet).sort();
  }, [catalogCities, recommendations, exploratory]);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Central refresh helper
  const refreshRecommendations = (overrides?: {
    preset?: ScoringPreset;
    mode?: DiscoveryMode;
    search?: string;
    city?: string;
  }) => {
    const targetPreset = overrides?.preset ?? activePreset;
    const targetMode = overrides?.mode ?? activeMode;
    const targetSearch =
      overrides?.search !== undefined ? overrides.search : searchQuery;
    const targetCity =
      overrides?.city !== undefined ? overrides.city : selectedCity;

    const reqId = ++requestIdRef.current;

    startTransition(async () => {
      const payload: {
        preset?: ScoringPreset;
        mode?: DiscoveryMode;
        search?: string;
        city?: string;
      } = {
        preset: targetPreset,
      };
      if (targetMode && targetMode !== 'all') {
        payload.mode = targetMode;
      }
      if (targetSearch && targetSearch.trim().length > 0) {
        payload.search = targetSearch.trim();
      }
      if (targetCity && targetCity.trim().length > 0) {
        payload.city = targetCity.trim();
      }

      const fetchRes = await getPersonalizedRecommendationsAction(payload);

      if (reqId !== requestIdRef.current) return;

      if (fetchRes.success && fetchRes.data) {
        setRecommendations(fetchRes.data.recommendations);
        setExploratory(fetchRes.data.exploratory);
        setTotalCandidateCount(fetchRes.data.totalCandidateCount);
        setSuppressedCount(fetchRes.data.suppressed.length);
        setIneligibleCount(fetchRes.data.ineligibleCount);
        setIsStale(false);
      } else {
        setIsStale(true);
        setErrorMessage(
          fetchRes.error ||
            'Unable to refresh recommendations. Showing previous results.',
        );
      }
    });
  };

  // Handler: Change discovery mode tab
  const handleModeChange = (newMode: DiscoveryMode) => {
    if (newMode === activeMode || isPending) return;
    setActiveMode(newMode);
    setErrorMessage(null);
    refreshRecommendations({ mode: newMode });
  };

  // Handler: Change preset
  const handlePresetChange = (newPreset: ScoringPreset) => {
    if (newPreset === activePreset || isPending) return;

    const previousPreset = activePreset;
    setActivePreset(newPreset);
    setErrorMessage(null);
    const reqId = ++requestIdRef.current;

    startTransition(async () => {
      const saveRes = await updateRecommendationPresetAction(newPreset);
      if (reqId !== requestIdRef.current) return;

      if (!saveRes.success) {
        setActivePreset(previousPreset);
        setErrorMessage(saveRes.error || 'Failed to update preset.');
        return;
      }

      refreshRecommendations({ preset: newPreset });
    });
  };

  // Handler: Change travel radius
  const handleRadiusChange = (newRadius: number) => {
    if (newRadius === radiusMiles || isPending) return;

    const previousRadius = radiusMiles;
    setRadiusMiles(newRadius);
    setErrorMessage(null);
    const reqId = ++requestIdRef.current;

    startTransition(async () => {
      const saveRes = await updateTravelRadiusAction(newRadius);
      if (reqId !== requestIdRef.current) return;

      if (!saveRes.success) {
        setRadiusMiles(previousRadius);
        setErrorMessage(saveRes.error || 'Failed to update travel radius.');
        return;
      }

      refreshRecommendations();
    });
  };

  // Handler: Change budget
  const handleBudgetChange = (newBudget: number | null) => {
    if (newBudget === budget || isPending) return;

    const previousBudget = budget;
    setBudget(newBudget);
    setErrorMessage(null);
    const reqId = ++requestIdRef.current;

    startTransition(async () => {
      const saveRes = await updateTypicalBudgetAction(newBudget);
      if (reqId !== requestIdRef.current) return;

      if (!saveRes.success) {
        setBudget(previousBudget);
        setErrorMessage(saveRes.error || 'Failed to update typical budget.');
        return;
      }

      refreshRecommendations();
    });
  };

  // Handler: Search input change with debouncing to query full catalog
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      refreshRecommendations({ search: value });
    }, 300);
  };

  // Handler: City dropdown change
  const handleCityChange = (city: string) => {
    setSelectedCity(city);
    refreshRecommendations({ city });
  };

  // Handler: Clear search and city filters
  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedCity('');
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    refreshRecommendations({ search: '', city: '' });
  };

  // Handler: Retry refreshing recommendations after transient failure
  const handleRetryRefresh = () => {
    if (isPending) return;
    setErrorMessage(null);
    refreshRecommendations();
  };

  // Filter recommendations and exploratory lists for instant client-side feedback
  const filterList = React.useCallback(
    (list: typeof recommendations) => {
      return list.filter((item) => {
        if (
          selectedCity &&
          item.event.city?.toLowerCase() !== selectedCity.toLowerCase()
        ) {
          return false;
        }

        if (searchQuery.trim().length > 0) {
          const q = searchQuery.trim().toLowerCase();
          const matchesTitle = item.event.title.toLowerCase().includes(q);
          const matchesVenue =
            item.event.venueName?.toLowerCase().includes(q) ?? false;
          const matchesArtist =
            item.event.artists?.some((a) => a.name.toLowerCase().includes(q)) ??
            false;
          if (!matchesTitle && !matchesVenue && !matchesArtist) {
            return false;
          }
        }

        return true;
      });
    },
    [selectedCity, searchQuery],
  );

  const filteredRecommendations = useMemo(
    () => filterList(recommendations),
    [recommendations, filterList],
  );

  const filteredExploratory = useMemo(
    () => filterList(exploratory),
    [exploratory, filterList],
  );

  const totalFilteredCount =
    filteredRecommendations.length + filteredExploratory.length;
  const totalDisplayableCount = recommendations.length + exploratory.length;

  const isFilterActive =
    Boolean(searchQuery.trim()) || Boolean(selectedCity.trim());

  // Genuinely empty candidate pool: zero candidates in database and no active search/city filter
  const isCatalogEmpty = totalCandidateCount === 0 && !isFilterActive;

  // Nonempty candidate pool, but zero eligible/unsuppressed recommendations
  const isNoEligibleRecommendations =
    !isCatalogEmpty && !isFilterActive && totalDisplayableCount === 0;

  // Active search/city filter matches 0
  const isFilterEmpty = isFilterActive && totalFilteredCount === 0;

  return (
    <div className="space-y-8">
      {/* Top Header */}
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
            Concerts and festivals ranked for your taste, travel practicality,
            and budget.
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
            href="/profile/taste"
            data-testid="discover-taste-link"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-indigo-500 hover:text-white"
          >
            <span>🎵</span> Music Taste
          </Link>
        </div>
      </header>

      {/* Transient Error Banner */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="discover-error-banner"
          className="flex items-center justify-between rounded-xl border border-red-800/80 bg-red-950/40 p-4 text-sm text-red-200"
        >
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            data-testid="dismiss-error-button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-semibold text-red-300 hover:text-white"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Persistent Stale Data Indicator */}
      {isStale && (
        <div
          role="status"
          data-testid="stale-recommendations-banner"
          className="flex flex-col gap-2 rounded-xl border border-amber-800/80 bg-amber-950/40 p-4 text-sm text-amber-200 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>
              Your settings were saved, but refreshing recommendations failed.
              Displayed recommendations and scores may be outdated.
            </span>
          </div>
          <button
            type="button"
            data-testid="retry-refresh-button"
            onClick={handleRetryRefresh}
            disabled={isPending}
            className="self-start rounded-md bg-amber-900/60 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-800 sm:self-auto"
          >
            {isPending ? 'Retrying...' : 'Retry Refresh'}
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

      {/* Onboarding Callout for Users with Incomplete Taste / Spotify Preferences */}
      {!initialData.hasPreferences && (
        <section
          data-testid="onboarding-banner"
          className="rounded-2xl border border-indigo-800/60 bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-zinc-900/80 p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                🎵 Personalize Your Live Music Feed
              </h2>
              <p className="mt-1 text-xs text-zinc-300 sm:text-sm">
                {initialData.isSpotifyConnected
                  ? 'Your Spotify account is connected! Add artists you love in Music Taste to unlock personalized scores and highlight must-see shows.'
                  : "You haven't added any favorite artists or connected Spotify yet. Add artists you love to unlock personalized scores and highlight must-see shows!"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/profile/taste"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
              >
                Set Up Music Taste →
              </Link>
              {!initialData.isSpotifyConnected && (
                <Link
                  href="/profile/taste"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:border-emerald-500 hover:text-white"
                >
                  <span>🎧</span> Connect Spotify
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {initialData.hasPreferences && !initialData.isSpotifyConnected && (
        <section
          data-testid="spotify-connect-callout"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎧</span>
              <div>
                <h3 className="text-sm font-semibold text-zinc-200">
                  Connect Spotify for Automatic Artist Sync
                </h3>
                <p className="text-xs text-zinc-400">
                  Sync your top artists and listening history directly to Encore
                  for automated tour tracking.
                </p>
              </div>
            </div>
            <Link
              href="/profile/taste"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-900/60 hover:text-white"
            >
              Connect Spotify →
            </Link>
          </div>
        </section>
      )}

      {/* Controls Bar: Priority Presets, Radius, Budget, Search & City Filter */}
      <section
        data-testid="discover-controls"
        className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm"
      >
        {/* Preset Selector */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Scoring Priority
            </span>
            {isPending && (
              <span className="animate-pulse text-xs text-indigo-400">
                Updating recommendations...
              </span>
            )}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRESET_CONFIG.map((preset) => {
              const isActive = activePreset === preset.id;
              const testId = `preset-${preset.id.replace('_', '-')}`;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={testId}
                  aria-pressed={isActive}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => handlePresetChange(preset.id)}
                  disabled={isPending}
                  className={`flex flex-col rounded-xl border p-3 text-left transition ${
                    isActive
                      ? 'border-indigo-500 bg-indigo-950/50 shadow-sm'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-sm font-semibold ${
                        isActive ? 'text-indigo-200' : 'text-zinc-200'
                      }`}
                    >
                      {preset.label}
                    </span>
                    {isActive && (
                      <span className="h-2 w-2 rounded-full bg-indigo-400" />
                    )}
                  </div>
                  <span className="mt-1 line-clamp-2 text-[11px] text-zinc-400">
                    {preset.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Travel Radius and Typical Budget Selectors */}
        <div className="grid grid-cols-1 gap-4 border-t border-zinc-800/80 pt-4 sm:grid-cols-2">
          {/* Radius Selector */}
          <fieldset>
            <legend
              id="radius-legend"
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-400"
            >
              Travel Radius
            </legend>
            <div
              role="group"
              aria-labelledby="radius-legend"
              className="mt-2 flex flex-wrap items-center gap-1.5"
              data-testid="radius-selector"
            >
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={radiusMiles === r}
                  data-active={radiusMiles === r ? 'true' : 'false'}
                  onClick={() => handleRadiusChange(r)}
                  disabled={isPending}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    radiusMiles === r
                      ? 'border-indigo-500 bg-indigo-950/60 font-semibold text-indigo-200'
                      : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
                  }`}
                >
                  {r} mi
                </button>
              ))}
            </div>
            {!initialData.isLocationConfigured && (
              <p className="mt-2 text-[11px] text-zinc-400">
                Home location not configured. Distance scores use neutral
                values.{' '}
                <Link
                  href="/profile/taste"
                  className="text-indigo-400 underline hover:text-indigo-300"
                >
                  Configure location
                </Link>
              </p>
            )}
          </fieldset>

          {/* Budget Selector */}
          <fieldset>
            <legend
              id="budget-legend"
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-400"
            >
              Typical Budget
            </legend>
            <div
              role="group"
              aria-labelledby="budget-legend"
              className="mt-2 flex flex-wrap items-center gap-1.5"
              data-testid="budget-selector"
            >
              {BUDGET_OPTIONS.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  aria-pressed={budget === b.value}
                  data-active={budget === b.value ? 'true' : 'false'}
                  onClick={() => handleBudgetChange(b.value)}
                  disabled={isPending}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    budget === b.value
                      ? 'border-indigo-500 bg-indigo-950/60 font-semibold text-indigo-200'
                      : 'border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Text Search & City Filter Bar */}
        <div className="grid grid-cols-1 gap-3 border-t border-zinc-800/80 pt-4 sm:grid-cols-3">
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

      {/* 1. Catalog Empty State (Zero events in catalog) */}
      {isCatalogEmpty && (
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
      )}

      {/* 2. No Eligible Recommendations State (Candidates exist, but none eligible/unsuppressed) */}
      {isNoEligibleRecommendations && (
        <div
          data-testid={
            ineligibleCount === totalCandidateCount
              ? 'no-eligible-results-banner'
              : 'no-eligible-recommendations-banner'
          }
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
        >
          <h2 className="text-lg font-semibold text-zinc-200">
            {ineligibleCount === totalCandidateCount
              ? 'No upcoming eligible events'
              : activeMode !== 'all'
                ? DISCOVERY_MODE_CONFIGS[activeMode].emptyStateHeading
                : 'No eligible recommendations with your current preferences'}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            {ineligibleCount === totalCandidateCount
              ? 'Upcoming catalog events are currently past, cancelled, or postponed. Check back soon as new dates are announced.'
              : suppressedCount > 0
                ? "Upcoming events in your area feature artists you've marked as not interested or disliked. Adjust your music taste preferences to discover more shows."
                : activeMode !== 'all'
                  ? DISCOVERY_MODE_CONFIGS[activeMode].emptyStateDescription
                  : 'We found upcoming events in the catalog, but none currently match your active taste or eligibility thresholds. Try adjusting your travel radius, typical budget, or music taste preferences.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {activeMode !== 'all' && (
              <button
                type="button"
                onClick={() => handleModeChange('all')}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
              >
                Switch to All Shows
              </button>
            )}
            <Link
              href="/profile/taste"
              className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-700"
            >
              Adjust Music Taste →
            </Link>
          </div>
        </div>
      )}

      {/* 3. Search/City Filter Empty State (Events exist in mode, but active search/filter matches 0) */}
      {isFilterEmpty && (
        <div
          data-testid="empty-filtered-banner"
          className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-12 text-center"
        >
          <h2 className="text-lg font-semibold text-zinc-200">
            No events match your search criteria
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Try adjusting your search keywords, clearing filters, or switching
            cities.
          </p>
          <button
            type="button"
            onClick={handleClearFilters}
            data-testid="clear-filters-btn"
            className="mt-4 rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 hover:text-white"
          >
            Clear Filters
          </button>
        </div>
      )}

      {/* Primary Recommendations Section */}
      {filteredRecommendations.length > 0 && (
        <section data-testid="primary-recommendations-section">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                Recommended For You
              </h2>
              <p className="text-xs text-zinc-400">
                Ranked by your{' '}
                {PRESET_CONFIG.find(
                  (p) => p.id === activePreset,
                )?.label.toLowerCase()}{' '}
                priority
                {activeMode !== 'all' &&
                  ` · ${DISCOVERY_MODE_CONFIGS[activeMode].label}`}
              </p>
            </div>
            <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
              {filteredRecommendations.length} show
              {filteredRecommendations.length === 1 ? '' : 's'}
            </span>
          </div>

          <div
            data-testid="recommendations-grid"
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {filteredRecommendations.map((scored) => (
              <PersonalizedEventCard
                key={scored.eventId}
                scoredEvent={scored}
              />
            ))}
          </div>
        </section>
      )}

      {/* Exploratory Section */}
      {filteredExploratory.length > 0 && (
        <section
          data-testid="exploratory-recommendations-section"
          className="border-t border-zinc-800/80 pt-8"
        >
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                Discover Something New
              </h2>
              <p className="text-xs text-zinc-400">
                Artists you haven&apos;t rated yet that fit your travel radius
                and ticket budget.
              </p>
            </div>
            <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
              {filteredExploratory.length} show
              {filteredExploratory.length === 1 ? '' : 's'}
            </span>
          </div>

          <div
            data-testid="exploratory-grid"
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            {filteredExploratory.map((scored) => (
              <PersonalizedEventCard
                key={scored.eventId}
                scoredEvent={scored}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
