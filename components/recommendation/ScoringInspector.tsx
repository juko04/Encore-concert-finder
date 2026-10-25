'use client';

import React, { useState, useTransition } from 'react';
import type {
  RecommendationResult,
  ScoredEvent,
  ScoringPreset,
} from '@/lib/recommendation/types';
import { PRESET_WEIGHTS } from '@/lib/recommendation/presets';
import type { UserProfile } from '@/lib/domain/profile';
import {
  getScoringPreviewAction,
  updateRecommendationPresetAction,
} from '@/app/discover/scoring-preview/actions';

/**
 * Formats event ticket price for display with authoritative currency representation.
 * Invariants:
 * 1. Verified free events (eventKind === 'free_event') with consistent price (null, undefined, 0) display as "Free Event (Verified)".
 * 2. Contradictory free events (eventKind === 'free_event' with positive minPrice) display as "Contradictory Pricing (price / Free Event)".
 * 3. Unverified zero prices (minPrice === 0 without free_event status) display with currency-aware indicators:
 *    - USD: "Unverified $0 USD (Status TBA)"
 *    - Foreign currency: "Unverified {CURRENCY} 0 (Status TBA)" (e.g. "Unverified CAD 0 (Status TBA)")
 *    - Unknown currency: "Unverified 0 (currency unknown, Status TBA)" - NEVER with $ or USD semantics.
 * 4. Missing prices display as "Price TBA".
 * 5. Foreign currencies display with authoritative code (e.g. "CAD 35", "EUR 45").
 * 6. USD prices display with explicit USD indicator (e.g. "$50 USD").
 * 7. Unknown currencies display as "50 (currency unknown)" - NEVER with $ or USD semantics.
 * 8. Non-finite or negative prices display as "Invalid Price Reported".
 */
export function formatEventPriceDisplay(event: {
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string | null;
  eventKind?: string | null;
}): string {
  const { minPrice, currency, eventKind } = event;

  // 1. Check for verified free admission or contradictory positive pricing on free events
  if (eventKind === 'free_event') {
    if (
      typeof minPrice === 'number' &&
      Number.isFinite(minPrice) &&
      minPrice > 0
    ) {
      const normalizedCurrency = currency?.trim().toUpperCase();
      let priceStr: string;
      if (!normalizedCurrency) {
        priceStr = `${minPrice} (currency unknown)`;
      } else if (normalizedCurrency === 'USD') {
        priceStr = `$${minPrice} USD`;
      } else {
        priceStr = `${normalizedCurrency} ${minPrice}`;
      }
      return `Contradictory Pricing (${priceStr} / Free Event)`;
    }

    return 'Free Event (Verified)';
  }

  // 2. Missing price check
  if (minPrice === null || minPrice === undefined) {
    return 'Price TBA';
  }

  // 3. Non-finite or negative price check
  if (
    typeof minPrice !== 'number' ||
    !Number.isFinite(minPrice) ||
    minPrice < 0
  ) {
    return 'Invalid Price Reported';
  }

  const normalizedCurrency = currency?.trim().toUpperCase();

  // 4. Unverified zero check (eventKind !== 'free_event')
  // Avoid suggesting USD when currency is CAD, EUR, or unknown
  if (minPrice === 0) {
    if (!normalizedCurrency) {
      return 'Unverified 0 (currency unknown, Status TBA)';
    }
    if (normalizedCurrency === 'USD') {
      return 'Unverified $0 USD (Status TBA)';
    }
    return `Unverified ${normalizedCurrency} 0 (Status TBA)`;
  }

  // 5. Positive prices with currency formatting
  if (!normalizedCurrency) {
    return `${minPrice} (currency unknown)`;
  }

  if (normalizedCurrency === 'USD') {
    return `$${minPrice} USD`;
  }

  return `${normalizedCurrency} ${minPrice}`;
}

interface ScoringInspectorProps {
  initialResult: RecommendationResult;
  initialPreset: ScoringPreset;
  initialProfile: UserProfile | null;
  isGuest: boolean;
  usingFixtures: boolean;
  isSyntheticDemo?: boolean;
  isEmptyCatalog?: boolean;
  initialError?: string;
}

export function ScoringInspector({
  initialResult,
  initialPreset,
  initialProfile,
  isGuest,
  usingFixtures: initialUsingFixtures,
  isSyntheticDemo: initialIsSyntheticDemo = false,
  isEmptyCatalog: initialIsEmptyCatalog = false,
  initialError,
}: ScoringInspectorProps) {
  const [result, setResult] = useState<RecommendationResult>(initialResult);
  const [preset, setPreset] = useState<ScoringPreset>(initialPreset);
  const [usingFixtures, setUsingFixtures] = useState(initialUsingFixtures);
  const [isSyntheticDemo, setIsSyntheticDemo] = useState(
    initialIsSyntheticDemo || initialUsingFixtures,
  );
  const [isEmptyCatalog, setIsEmptyCatalog] = useState(initialIsEmptyCatalog);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialError ?? null,
  );
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<
    Record<string, boolean>
  >({});
  const [activeTab, setActiveTab] = useState<
    'recommendations' | 'exploratory' | 'suppressed'
  >('recommendations');
  const [isPending, startTransition] = useTransition();
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const handlePresetChange = (newPreset: ScoringPreset) => {
    setPreset(newPreset);
    setSaveStatus(null);
    setErrorMessage(null);

    startTransition(async () => {
      // 1. Fetch updated scoring with new preset
      const res = await getScoringPreviewAction({
        preset: newPreset,
        useFixtures: usingFixtures,
      });
      setResult(res.result);
      setIsSyntheticDemo(res.isSyntheticDemo);
      setIsEmptyCatalog(res.isEmptyCatalog);
      if (res.error) {
        setErrorMessage(res.error);
      }

      // 2. Persist to profile if authenticated
      if (!isGuest) {
        const saveRes = await updateRecommendationPresetAction(newPreset);
        if (saveRes.success) {
          setSaveStatus('Preset saved to your profile.');
        } else if (saveRes.error) {
          setErrorMessage(saveRes.error);
        }
      }
    });
  };

  const handleToggleFixtures = (fixtures: boolean) => {
    setUsingFixtures(fixtures);
    setErrorMessage(null);
    startTransition(async () => {
      const res = await getScoringPreviewAction({
        preset,
        useFixtures: fixtures,
      });
      setResult(res.result);
      setIsSyntheticDemo(res.isSyntheticDemo);
      setIsEmptyCatalog(res.isEmptyCatalog);
      if (res.error) {
        setErrorMessage(res.error);
      }
    });
  };

  const toggleDiagnostics = (eventId: string) => {
    setExpandedDiagnostics((prev) => ({
      ...prev,
      [eventId]: !prev[eventId],
    }));
  };

  const weights = PRESET_WEIGHTS[preset];

  return (
    <div className="space-y-8" data-testid="scoring-inspector">
      {/* Header Banner */}
      <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-6 backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                Development Inspector · PR #11 Foundation
              </div>
              {isSyntheticDemo ? (
                <div
                  data-testid="synthetic-fixtures-badge"
                  className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Authoritative Synthetic Fixtures (Demo)
                </div>
              ) : (
                <div
                  data-testid="live-catalog-badge"
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Live Canonical Database Catalog
                </div>
              )}
            </div>
            <h1 className="mt-3 text-2xl font-bold text-white sm:text-3xl">
              Recommendation Scoring Inspector
            </h1>
            <p className="mt-1 text-sm text-zinc-300">
              Evaluate real deterministic multi-factor calculations, inspect
              factor breakdowns, and test priority presets on canonical concert
              data.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-300">
              <input
                type="checkbox"
                checked={usingFixtures}
                onChange={(e) => handleToggleFixtures(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
                data-testid="toggle-fixtures-checkbox"
              />
              <span>Use Representative Test Fixtures</span>
            </label>
            <span className="text-[11px] text-zinc-400">
              {usingFixtures
                ? 'Showing 10 seeded edge-case events'
                : 'Showing live canonical database events'}
            </span>
          </div>
        </div>

        {/* User Context & Thresholds pill */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-indigo-500/20 pt-4 text-xs text-zinc-300">
          <div>
            <span className="text-zinc-400">Mode: </span>
            <span className="font-semibold text-zinc-200">
              {isGuest ? 'Guest / Demo Profile' : 'Authenticated User Profile'}
            </span>
          </div>
          <div>
            <span className="text-zinc-400">Radius: </span>
            <span className="font-semibold text-zinc-200">
              {initialProfile?.defaultRadiusMiles ?? 25} miles
            </span>
          </div>
          <div>
            <span className="text-zinc-400">Typical Budget: </span>
            <span className="font-semibold text-zinc-200">
              ${initialProfile?.maxNormalTicketPrice ?? 60}
            </span>
          </div>
          <div>
            <span className="text-zinc-400">Favorite Ceiling: </span>
            <span className="font-semibold text-zinc-200">
              ${initialProfile?.maxFavoriteArtistPrice ?? 150}
            </span>
          </div>
          {saveStatus && (
            <div className="font-medium text-emerald-400">✓ {saveStatus}</div>
          )}
        </div>
      </div>

      {/* Safe Error Banner if query failed */}
      {errorMessage && (
        <div
          data-testid="scoring-preview-error"
          className="rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-xs font-medium text-red-200"
        >
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Empty Catalog Notice if live database returned 0 events */}
      {isEmptyCatalog && (
        <div
          data-testid="scoring-empty-catalog"
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 text-center text-sm text-zinc-300"
        >
          <p className="font-semibold text-white">No Canonical Events Found</p>
          <p className="mt-1 text-xs text-zinc-400">
            The live database does not currently contain any upcoming events.
            Toggle &quot;Use Representative Test Fixtures&quot; above to inspect
            scoring behavior on seeded edge-case scenarios.
          </p>
        </div>
      )}

      {/* Preset Switcher Bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Active Priority Preset
            </span>
            <p className="text-xs text-zinc-400">
              Select one of four fixed presets to adjust weighting balance.
            </p>
          </div>

          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="preset-switcher"
          >
            {(
              [
                ['balanced', 'Balanced (50/20/20/10)'],
                ['artist_first', 'Artist-First (65/15/10/10)'],
                ['nearby', 'Nearby (40/35/15/10)'],
                ['value', 'Value (40/15/35/10)'],
              ] as const
            ).map(([pKey, label]) => {
              const isActive = preset === pKey;
              return (
                <button
                  key={pKey}
                  type="button"
                  onClick={() => handlePresetChange(pKey)}
                  disabled={isPending}
                  data-testid={`preset-btn-${pKey}`}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                      : 'border border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500 hover:text-white'
                  } ${isPending ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Weights Breakdown Bar */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-zinc-950/60 p-2.5 text-center">
            <span className="text-[11px] text-zinc-400">Artist Interest</span>
            <div className="mt-0.5 text-sm font-bold text-indigo-400">
              {weights.artist}%
            </div>
          </div>
          <div className="rounded-lg bg-zinc-950/60 p-2.5 text-center">
            <span className="text-[11px] text-zinc-400">Distance & Effort</span>
            <div className="mt-0.5 text-sm font-bold text-emerald-400">
              {weights.distance}%
            </div>
          </div>
          <div className="rounded-lg bg-zinc-950/60 p-2.5 text-center">
            <span className="text-[11px] text-zinc-400">Price & Value</span>
            <div className="mt-0.5 text-sm font-bold text-amber-400">
              {weights.price}%
            </div>
          </div>
          <div className="rounded-lg bg-zinc-950/60 p-2.5 text-center">
            <span className="text-[11px] text-zinc-400">Timing & Date</span>
            <div className="mt-0.5 text-sm font-bold text-cyan-400">
              {weights.timing}%
            </div>
          </div>
        </div>
      </div>

      {/* Tabs for Recommendations vs Exploratory vs Suppressed */}
      <div>
        <div className="flex items-center gap-3 border-b border-zinc-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('recommendations')}
            data-testid="tab-recommendations"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'recommendations'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Primary Matches ({result.recommendations.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('exploratory')}
            data-testid="tab-exploratory"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'exploratory'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Exploratory / Discovery ({result.exploratory.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('suppressed')}
            data-testid="tab-suppressed"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'suppressed'
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Suppressed ({result.suppressed.length})
          </button>
          {result.ineligibleCount > 0 && (
            <span className="ml-auto text-xs text-zinc-400">
              {result.ineligibleCount} past events filtered
            </span>
          )}
        </div>

        {/* Tab Contents */}
        <div className="mt-6">
          {activeTab === 'recommendations' && (
            <div data-testid="recommendations-list" className="space-y-4">
              {result.recommendations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-400">
                  No matched recommendations for your explicit artist
                  preferences. Explore upcoming shows in the Exploratory tab.
                </div>
              ) : (
                result.recommendations.map((item, idx) => (
                  <ScoredEventCard
                    key={item.eventId}
                    rank={idx + 1}
                    scoredEvent={item}
                    isExpanded={!!expandedDiagnostics[item.eventId]}
                    onToggle={() => toggleDiagnostics(item.eventId)}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'exploratory' && (
            <div data-testid="exploratory-list" className="space-y-4">
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 text-xs text-zinc-300">
                <span className="font-semibold text-zinc-200">
                  Unmarked Artist Discovery Pool:
                </span>{' '}
                These events feature artists not yet in your preference profile.
                They are scored with neutral exploratory interest (40) and
                ranked by price value, venue proximity, and timing convenience.
              </div>
              {result.exploratory.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-400">
                  No exploratory events found.
                </div>
              ) : (
                result.exploratory.map((item, idx) => (
                  <ScoredEventCard
                    key={item.eventId}
                    rank={idx + 1}
                    scoredEvent={item}
                    isExpanded={!!expandedDiagnostics[item.eventId]}
                    onToggle={() => toggleDiagnostics(item.eventId)}
                  />
                ))
              )}
            </div>
          )}

          {activeTab === 'suppressed' && (
            <div data-testid="suppressed-list" className="space-y-4">
              <div className="rounded-xl border border-red-900/30 bg-red-950/20 p-4 text-xs text-red-200">
                <span className="font-semibold">Suppressed Events:</span> Events
                featuring artists you explicitly marked as &quot;Not
                Interested&quot; (dislike) or cancelled/postponed events are
                suppressed from normal recommendations.
              </div>
              {result.suppressed.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-400">
                  No suppressed events.
                </div>
              ) : (
                result.suppressed.map((item, idx) => (
                  <ScoredEventCard
                    key={item.eventId}
                    rank={idx + 1}
                    scoredEvent={item}
                    isExpanded={!!expandedDiagnostics[item.eventId]}
                    onToggle={() => toggleDiagnostics(item.eventId)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoredEventCard({
  rank,
  scoredEvent,
  isExpanded,
  onToggle,
}: {
  rank: number;
  scoredEvent: ScoredEvent;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { event, score, factors, explanation, isSuppressed } = scoredEvent;

  return (
    <div
      data-testid={`scored-event-card-${event.id}`}
      className={`rounded-xl border p-5 transition-all ${
        isSuppressed
          ? 'border-red-900/40 bg-zinc-950/60 opacity-80'
          : 'border-zinc-800 bg-zinc-900/80 hover:border-zinc-700'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Event Identity */}
        <div className="flex items-start gap-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-xs font-bold text-zinc-300">
            #{rank}
          </div>

          <div>
            <h3 className="text-base font-semibold text-white">
              {event.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
              <span>📅 {event.localStartDate}</span>
              <span>
                📍 {event.venueName}
                {event.city ? `, ${event.city}` : ''}
              </span>
              <span data-testid={`event-price-${event.id}`}>
                🏷️ {formatEventPriceDisplay(event)}
              </span>
            </div>

            {/* Structured Explanation */}
            <p
              className="mt-2 text-xs font-medium text-indigo-300"
              data-testid={`event-explanation-${event.id}`}
            >
              {explanation}
            </p>
          </div>
        </div>

        {/* Score Badge */}
        <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
          <div
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold ${
              isSuppressed
                ? 'border border-red-800/40 bg-red-950/60 text-red-400'
                : score >= 80
                  ? 'border border-emerald-800/40 bg-emerald-950/60 text-emerald-300'
                  : score >= 60
                    ? 'border border-indigo-800/40 bg-indigo-950/60 text-indigo-300'
                    : 'border border-zinc-700 bg-zinc-800/80 text-zinc-300'
            }`}
            data-testid={`event-score-${event.id}`}
          >
            <span>Score:</span>
            <span className="text-base">{score}</span>
          </div>

          <button
            type="button"
            onClick={onToggle}
            data-testid={`toggle-diagnostics-btn-${event.id}`}
            className="text-[11px] text-zinc-400 underline decoration-dotted hover:text-zinc-200"
          >
            {isExpanded ? 'Hide Diagnostics' : 'Inspect Breakdown'}
          </button>
        </div>
      </div>

      {/* Factor Pills */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3">
        <span
          className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-2 py-0.5 text-[11px] text-indigo-300"
          data-testid={`factor-pill-artist-${event.id}`}
        >
          🎵 Artist: {factors.artist.score} ({factors.artist.weight}%)
        </span>
        <span
          className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-2 py-0.5 text-[11px] text-emerald-300"
          data-testid={`factor-pill-distance-${event.id}`}
        >
          📍 Distance: {factors.distance.score} ({factors.distance.weight}%)
        </span>
        <span
          className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-2 py-0.5 text-[11px] text-amber-300"
          data-testid={`factor-pill-price-${event.id}`}
        >
          🏷️ Price: {factors.price.score} ({factors.price.weight}%)
        </span>
        <span
          className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-2 py-0.5 text-[11px] text-cyan-300"
          data-testid={`factor-pill-timing-${event.id}`}
        >
          📅 Timing: {factors.timing.score} ({factors.timing.weight}%)
        </span>
      </div>

      {/* Expandable Developer Diagnostics */}
      {isExpanded && (
        <div
          data-testid={`event-diagnostics-${event.id}`}
          className="mt-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs text-zinc-400"
        >
          <div className="border-b border-zinc-800 pb-1 font-semibold text-zinc-200">
            Developer Factor Diagnostics (ID: {event.id})
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <span className="text-zinc-500">Artist Factor:</span>{' '}
              {factors.artist.score} / 100 · Contribution:{' '}
              {factors.artist.weightedContribution} pts
              <div className="text-[11px] text-zinc-500">
                {factors.artist.explanation}
              </div>
            </div>
            <div>
              <span className="text-zinc-500">Distance Factor:</span>{' '}
              {factors.distance.score} / 100 · Contribution:{' '}
              {factors.distance.weightedContribution} pts
              <div className="text-[11px] text-zinc-500">
                {factors.distance.explanation}
              </div>
            </div>
            <div>
              <span className="text-zinc-500">Price Factor:</span>{' '}
              {factors.price.score} / 100 · Contribution:{' '}
              {factors.price.weightedContribution} pts
              <div className="text-[11px] text-zinc-500">
                {factors.price.explanation}
              </div>
            </div>
            <div>
              <span className="text-zinc-500">Timing Factor:</span>{' '}
              {factors.timing.score} / 100 · Contribution:{' '}
              {factors.timing.weightedContribution} pts
              <div className="text-[11px] text-zinc-500">
                {factors.timing.explanation}
              </div>
            </div>
          </div>
          <div className="border-t border-zinc-900 pt-2 text-[11px] text-zinc-500">
            Raw Metrics: Distance=
            {scoredEvent.diagnostics.rawMetrics.distanceMiles ?? 'null'} mi ·
            Price={formatEventPriceDisplay(event)} · BudgetCeiling=
            {scoredEvent.diagnostics.rawMetrics.budgetCeiling
              ? `$${scoredEvent.diagnostics.rawMetrics.budgetCeiling} USD`
              : 'none'}
          </div>
        </div>
      )}
    </div>
  );
}
