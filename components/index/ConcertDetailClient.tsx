'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import type { IndexEventItem } from './types';
import { toIndexEventItem } from './types';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';
import type { ScoredEvent } from '@/lib/recommendation/types';
import {
  formatIndexDate,
  formatIndexPrice,
  getStatusBadge,
  calculateDistanceMiles,
} from './formatters';
import { AudioPreviewPlayer } from './AudioPreviewPlayer';
import { EventCard } from './EventCard';
import { UndoToast } from './UndoToast';
import { useWatchlist } from './useWatchlist';
import {
  ArrowLeftIcon,
  HeartIcon,
  BellIcon,
  CalendarIcon,
  MapPinIcon,
  TicketIcon,
  SparklesIcon,
  AlertCircleIcon,
  CheckIcon,
  ArrowUpRightIcon,
  StarIcon,
  BanIcon,
  SlidersIcon,
} from './icons';

export interface ConcertDetailClientProps {
  event: CanonicalEventSummary | ScoredEvent | IndexEventItem;
  relatedEvents?: Array<CanonicalEventSummary | ScoredEvent | IndexEventItem>;
  initialPreferences?: Array<{
    artistId: string;
    level: 'favorite' | 'like' | 'ignore';
  }>;
  onSetPreference?: (
    artistId: string,
    artistName: string,
    level: 'favorite' | 'like' | 'ignore',
  ) => void;
  onBack?: () => void;
  backHref?: string;
}

export function ConcertDetailClient({
  event: rawEvent,
  relatedEvents: rawRelated = [],
  initialPreferences = [],
  onSetPreference,
  onBack,
  backHref = '/',
}: ConcertDetailClientProps) {
  const event = useMemo(() => toIndexEventItem(rawEvent), [rawEvent]);
  const relatedEvents = useMemo(
    () => rawRelated.map(toIndexEventItem),
    [rawRelated],
  );

  const { isSaved, hasAlert, toggleSave, toggleAlert, undoStack, undo } =
    useWatchlist();

  const [preferences, setPreferences] = useState(initialPreferences);
  const [showFactorDrawer, setShowFactorDrawer] = useState(false);

  const isPersonalized = Boolean(event.personalScore?.isPersonalized);
  const score = event.personalScore?.score ?? 50;
  const isDisliked = Boolean(event.personalScore?.isDisliked);
  const isFavorite = Boolean(event.personalScore?.isFavorite);

  const statusBadge = getStatusBadge(event.inventoryStatus);
  const isSoldOut = event.inventoryStatus === 'sold_out';
  const isCancelled = event.inventoryStatus === 'cancelled';

  const headlinerName = event.headlinerName || event.title;
  const supportActs = (event.artists || []).filter(
    (a) => a.name !== headlinerName && a.billingPosition !== 'headliner',
  );

  const distanceMiles = calculateDistanceMiles(event.lat, event.lng);

  const handlePreferenceChange = (
    artistId: string,
    artistName: string,
    level: 'favorite' | 'like' | 'ignore',
  ) => {
    setPreferences((prev) => {
      const filtered = prev.filter((p) => p.artistId !== artistId);
      const existing = prev.find((p) => p.artistId === artistId);
      if (existing?.level === level) {
        return filtered; // Toggle off if clicked again
      }
      return [...filtered, { artistId, level }];
    });
    onSetPreference?.(artistId, artistName, level);
  };

  const mapSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${event.venueName || ''} ${event.city || ''} ${event.region || ''}`,
  )}`;

  return (
    <div className="space-y-8 pb-16">
      {/* Top Breadcrumb Bar */}
      <div className="flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            <span>Back to Concerts</span>
          </button>
        ) : (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
          >
            <ArrowLeftIcon className="h-3.5 w-3.5" />
            <span>Back to Concerts</span>
          </Link>
        )}

        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
            Event ID: {event.id}
          </span>
        </div>
      </div>

      {/* Hero Decision Header Card */}
      <section className="shadow-xs relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white p-6 sm:p-10">
        {/* Top Artwork Gradient Glow */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 h-2"
          style={{
            background: `linear-gradient(90deg, ${event.posterColor} 0%, ${event.posterSecondaryColor} 100%)`,
          }}
        />

        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="max-w-3xl space-y-4">
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md border px-2.5 py-0.5 text-xs font-medium ${statusBadge.bg}`}
              >
                {statusBadge.label}
              </span>

              {event.genre && (
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-mono text-xs text-zinc-600">
                  {event.genre}
                </span>
              )}

              {isPersonalized ? (
                isDisliked ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                    <AlertCircleIcon className="h-3.5 w-3.5" />
                    <span>Suppressed (Disliked Artist)</span>
                  </span>
                ) : isFavorite ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    <SparklesIcon className="h-3.5 w-3.5 text-amber-600" />
                    <span>Favorite Artist · {score}% Match</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs font-medium text-zinc-700">
                    <span>{score}% Personalized Match</span>
                  </span>
                )
              ) : (
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 font-mono text-xs text-zinc-500">
                  Guest View · Unbiased
                </span>
              )}
            </div>

            {/* Artist & Title */}
            <div>
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-4xl lg:text-5xl">
                {headlinerName}
              </h1>

              {supportActs.length > 0 && (
                <p className="mt-1 text-base font-medium text-zinc-600">
                  with {supportActs.map((a) => a.name).join(', ')}
                </p>
              )}

              {event.title && event.title !== headlinerName && (
                <p className="mt-1 text-sm italic text-zinc-500">
                  {event.title}
                </p>
              )}
            </div>

            {/* Practical Quick Facts Grid */}
            <div className="grid grid-cols-1 gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-3">
              <div className="flex items-center gap-2.5">
                <CalendarIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    {formatIndexDate(
                      event.localStartDate,
                      event.doorTime || event.startsAt,
                      event.timezone,
                    )}
                  </div>
                  {event.timezone && (
                    <div className="font-mono text-[11px] text-zinc-400">
                      Timezone: {event.timezone}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <MapPinIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                <div>
                  <div className="text-sm font-semibold text-zinc-900">
                    {event.venueName || 'Venue TBA'}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {event.city ? `${event.city}` : ''}
                    {event.region ? `, ${event.region}` : ''}
                    {distanceMiles !== null && ` (${distanceMiles} mi)`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <TicketIcon className="h-4 w-4 shrink-0 text-zinc-400" />
                <div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
                    {formatIndexPrice(
                      event.minPrice,
                      event.maxPrice,
                      event.currency,
                      event.eventKind,
                      event.ticketUrl,
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Age policy: {event.ageRestriction || 'All Ages'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Box: Direct Ticket Link + Save + Alert */}
          <div className="flex shrink-0 flex-col gap-2.5 border-t border-zinc-100 pt-6 sm:w-72 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            {event.ticketUrl && !isCancelled ? (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shadow-xs inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition-transform duration-150 ease-out hover:bg-zinc-800 active:scale-[0.97]"
              >
                <span>
                  {isSoldOut ? 'Check Verified Resale' : 'Official Tickets'}
                </span>
                <ArrowUpRightIcon className="h-4 w-4" />
              </a>
            ) : isCancelled ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-100 p-3 text-center text-xs font-semibold text-zinc-500">
                Event Cancelled
              </div>
            ) : event.eventKind === 'free_event' ||
              (event.minPrice === 0 && event.maxPrice === 0) ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs font-semibold text-emerald-800">
                Free Admission · No Advance Ticket Required
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-center text-xs font-semibold text-zinc-600">
                Ticket Link Unavailable · Check Venue Door
              </div>
            )}

            <button
              type="button"
              onClick={() => toggleSave(event.id, headlinerName)}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
                isSaved(event.id)
                  ? 'shadow-2xs border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <HeartIcon className="h-4 w-4" filled={isSaved(event.id)} />
              <span>
                {isSaved(event.id) ? 'Saved to Watchlist' : 'Add to Watchlist'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => toggleAlert(event.id, headlinerName)}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all duration-150 ease-out active:scale-[0.97] ${
                hasAlert(event.id)
                  ? 'shadow-2xs border-violet-200 bg-violet-50 text-violet-700'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <BellIcon className="h-4 w-4" filled={hasAlert(event.id)} />
              <span>
                {hasAlert(event.id)
                  ? 'Ticket Alerts Active'
                  : 'Enable Ticket Alerts'}
              </span>
            </button>

            {event.presaleDate && (
              <div className="rounded-lg border border-violet-100 bg-violet-50/60 p-2.5 text-[11px] text-violet-800">
                <span className="font-semibold">Presale Window: </span>
                {new Date(event.presaleDate).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })}
              </div>
            )}

            {/* Factor breakdown toggle button */}
            {event.personalScore?.factors && (
              <button
                type="button"
                onClick={() => setShowFactorDrawer(!showFactorDrawer)}
                className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                <SlidersIcon className="h-3.5 w-3.5 text-zinc-500" />
                <span>
                  {showFactorDrawer
                    ? 'Hide Factor Breakdown'
                    : 'View Factor Breakdown'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Personalized Factor Breakdown Drawer */}
        {showFactorDrawer && event.personalScore?.factors && (
          <div className="animate-in fade-in slide-in-from-top-2 mt-6 border-t border-zinc-100 pt-6 duration-150">
            <h3 className="text-sm font-bold text-zinc-900">
              Personalized Recommendation Factor Breakdown
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Deterministic scoring factors across artist affinity, geographic
              distance, price alignment, and timing.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(event.personalScore.factors).map(
                ([factorName, factor]) => {
                  if (!factor) return null;
                  const factorTitle = `${factorName.charAt(0).toUpperCase()}${factorName.slice(1)} Fit`;
                  return (
                    <div
                      key={factorName}
                      className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-3.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-700">
                          {factorTitle}
                        </span>
                        <span className="font-mono text-xs font-bold text-zinc-900">
                          {factor.score}/100
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                        {factor.explanation}
                      </p>
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}
      </section>

      {/* Main 2-Column Section: Decision Guide (Why vs Considerations) + Lineup/Player */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left 2 Columns: Decision Guide & Lineup */}
        <div className="space-y-6 lg:col-span-2">
          {/* Honest Decision Guide */}
          <div className="shadow-xs overflow-hidden rounded-3xl border border-zinc-200/90 bg-white">
            <div className="border-b border-zinc-100 bg-zinc-50/70 px-6 py-4">
              <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900">
                <SparklesIcon className="h-4 w-4 text-zinc-700" />
                <span>Editorial Decision Guide</span>
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Authentic evaluation of this show’s strengths and practical
                considerations before purchasing tickets.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 divide-y divide-zinc-100 p-6 md:grid-cols-2 md:divide-x md:divide-y-0">
              {/* Why This Suits You */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
                    <CheckIcon className="h-3 w-3 text-emerald-700" />
                  </div>
                  <span>Why This Suits You</span>
                </div>

                <ul className="space-y-2.5 text-xs leading-relaxed text-zinc-600">
                  {event.whyItSuitsYou && event.whyItSuitsYou.length > 0 ? (
                    event.whyItSuitsYou.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-0.5 font-bold text-emerald-500">
                          ✓
                        </span>
                        <span>{reason}</span>
                      </li>
                    ))
                  ) : (
                    <>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 font-bold text-emerald-500">
                          ✓
                        </span>
                        <span>
                          Headlining performance featuring {headlinerName}.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 font-bold text-emerald-500">
                          ✓
                        </span>
                        <span>
                          Genuine venue listing with direct ticket purchase
                          verification.
                        </span>
                      </li>
                    </>
                  )}
                </ul>
              </div>

              {/* What to Consider Before Attending */}
              <div className="space-y-3 pt-6 md:pt-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100">
                    <AlertCircleIcon className="h-3 w-3 text-amber-700" />
                  </div>
                  <span>What to Consider Before Attending</span>
                </div>

                <ul className="space-y-2.5 text-xs leading-relaxed text-zinc-600">
                  {event.considerations && event.considerations.length > 0 ? (
                    event.considerations.map((con, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-0.5 font-bold text-amber-500">
                          !
                        </span>
                        <span>{con}</span>
                      </li>
                    ))
                  ) : (
                    <>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 font-bold text-amber-500">
                          !
                        </span>
                        <span>
                          Verify door times and venue age restrictions before
                          arrival.
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 font-bold text-amber-500">
                          !
                        </span>
                        <span>
                          Check parking availability and local transport
                          options.
                        </span>
                      </li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>

          {/* Lineup & Billing Details with Preference Modifiers */}
          <div className="shadow-xs space-y-4 rounded-3xl border border-zinc-200/90 bg-white p-6">
            <h2 className="text-base font-bold text-zinc-900">
              Lineup & Billing Details
            </h2>
            <p className="text-xs text-zinc-500">
              Manage your artist affinity. Favoriting a headliner ensures high
              priority; ignoring a headliner suppresses the show per Invariant
              11.
            </p>

            <div className="space-y-3 pt-2">
              {event.artists.map((artist) => {
                const artistId = artist.id || artist.name;
                const currentPref = preferences.find(
                  (p) => p.artistId === artistId,
                );
                return (
                  <div
                    key={artistId}
                    className="flex flex-col justify-between gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-4 sm:flex-row sm:items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">
                          {artist.name}
                        </span>
                        <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                          {artist.billingPosition}
                        </span>
                        {currentPref && (
                          <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                            {currentPref.level}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {artist.billingPosition === 'headliner'
                          ? 'Primary performer / headliner'
                          : artist.billingPosition === 'support'
                            ? 'Touring support act'
                            : 'Lineup performer'}
                      </p>
                    </div>

                    {/* Quick Preference Buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handlePreferenceChange(
                            artistId,
                            artist.name,
                            'favorite',
                          )
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                          currentPref?.level === 'favorite'
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        <StarIcon
                          className="h-3 w-3"
                          filled={currentPref?.level === 'favorite'}
                        />
                        <span>Favorite</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handlePreferenceChange(artistId, artist.name, 'like')
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                          currentPref?.level === 'like'
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        <HeartIcon
                          className="h-3 w-3"
                          filled={currentPref?.level === 'like'}
                        />
                        <span>Like</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handlePreferenceChange(
                            artistId,
                            artist.name,
                            'ignore',
                          )
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                          currentPref?.level === 'ignore'
                            ? 'border-rose-300 bg-rose-50 text-rose-800'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        <BanIcon className="h-3 w-3" />
                        <span>Ignore</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Audio Player & Venue Profile */}
        <div className="space-y-6">
          {/* Audio Preview Track */}
          {event.spotifyPreviewTrack && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Audio Sample
              </h2>
              <AudioPreviewPlayer
                track={event.spotifyPreviewTrack}
                artistName={headlinerName}
                posterColor={event.posterColor}
              />
            </div>
          )}

          {/* Venue & Logistics Profile */}
          <div className="shadow-xs space-y-4 rounded-3xl border border-zinc-200/90 bg-white p-6">
            <h2 className="text-base font-bold text-zinc-900">
              Venue & Logistics
            </h2>

            <div className="space-y-3 text-xs text-zinc-600">
              <div>
                <span className="font-semibold text-zinc-800">Venue: </span>
                <span>{event.venueName || 'Venue TBA'}</span>
              </div>

              <div>
                <span className="font-semibold text-zinc-800">Location: </span>
                <span>
                  {event.city ? event.city : ''}
                  {event.region ? `, ${event.region}` : ''}
                </span>
              </div>

              {event.lat != null && event.lng != null && (
                <div>
                  <span className="font-semibold text-zinc-800">
                    Coordinates:{' '}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {event.lat.toFixed(4)}, {event.lng.toFixed(4)}
                  </span>
                </div>
              )}

              <div className="pt-1">
                <a
                  href={mapSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700 hover:text-zinc-900 hover:underline"
                >
                  <MapPinIcon className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Open in Google Maps ↗</span>
                </a>
              </div>

              {event.vibeTags && event.vibeTags.length > 0 && (
                <div className="pt-2">
                  <span className="font-semibold text-zinc-800">
                    Vibe & Atmosphere:{' '}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {event.vibeTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Related Concerts */}
      {relatedEvents.length > 0 && (
        <section className="space-y-4 border-t border-zinc-200 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-zinc-900">
              Similar Upcoming Concerts
            </h2>
            <Link
              href={backHref}
              className="text-xs font-semibold text-zinc-900 hover:underline"
            >
              Browse All →
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {relatedEvents.slice(0, 3).map((rel) => (
              <EventCard
                key={rel.id}
                event={rel}
                isSaved={isSaved(rel.id)}
                hasAlert={hasAlert(rel.id)}
                onToggleSave={toggleSave}
                onToggleAlert={toggleAlert}
              />
            ))}
          </div>
        </section>
      )}

      {/* Undo Toast */}
      <UndoToast undoStack={undoStack} onUndo={undo} />
    </div>
  );
}
