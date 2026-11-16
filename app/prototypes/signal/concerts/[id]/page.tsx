'use client';

import React, { use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { usePrototypeStore } from '@/lib/prototypes/store';
import {
  computeSignalScore,
  formatEventDate,
  formatEventPrice,
} from '@/lib/prototypes/signal-helpers';
import { AudioPreviewPlayer } from '@/components/prototypes/signal/AudioPreviewPlayer';

interface ConcertDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function ConcertDetailPage({ params }: ConcertDetailPageProps) {
  const { id } = use(params);
  const {
    events,
    preferences,
    viewMode,
    savedEventIds,
    alertEventIds,
    toggleSaveEvent,
    toggleAlertEvent,
  } = usePrototypeStore();

  const event = events.find((ev) => ev.id === id);

  if (!event) {
    return notFound();
  }

  const signal = computeSignalScore(event, preferences, viewMode);
  const dateInfo = formatEventDate(event.localStartDate);
  const priceFormatted = formatEventPrice(
    event.minPrice,
    event.maxPrice,
    event.currency,
  );

  const isSaved = savedEventIds.includes(event.id);
  const hasAlert = alertEventIds.includes(event.id);

  const headliner =
    event.artists.find((a) => a.billingPosition === 'headliner') ||
    event.artists[0];
  const supportActs = event.artists.filter(
    (a) => a.billingPosition !== 'headliner',
  );

  return (
    <main className="relative min-h-screen pb-20">
      {/* 1. Immersive Atmospheric Backdrop using Artist Poster Color */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[500px] opacity-25 blur-[120px] transition-all"
        style={{
          background: `radial-gradient(circle at 50% 10%, ${event.posterColor} 0%, ${event.posterSecondaryColor} 70%, transparent 100%)`,
        }}
      />

      <div className="relative mx-auto max-w-6xl space-y-10 px-4 pt-6 sm:px-6 lg:px-8">
        {/* Navigation Breadcrumb & Back Action */}
        <div className="flex items-center justify-between font-mono text-xs">
          <Link
            href="/prototypes/signal"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white active:scale-95"
          >
            <span>&larr;</span>
            <span>Back to Signal Feed</span>
          </Link>

          <div className="flex items-center gap-2 text-zinc-500">
            <span>
              {event.city}, {event.region}
            </span>
            <span>/</span>
            <span className="text-zinc-300">{event.venueName}</span>
          </div>
        </div>

        {/* 2. Hero Evaluation Header & Title */}
        <section aria-label="Concert Overview" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs font-bold shadow-md ${signal.badgeColorClass}`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: event.posterColor }}
              />
              {signal.badgeLabel}
            </span>

            {event.ticketStatus === 'presale' && (
              <span className="rounded-full border border-violet-700/60 bg-violet-950/80 px-2.5 py-1 font-mono text-xs font-semibold text-violet-300">
                ⚡ Presale Window: Opens Thursday
              </span>
            )}
            {event.ticketStatus === 'low_inventory' && (
              <span className="animate-pulse rounded-full border border-amber-700/60 bg-amber-950/80 px-2.5 py-1 font-mono text-xs font-semibold text-amber-300">
                ⚠️ Low Inventory (&lt;35 tickets left)
              </span>
            )}
            {event.ticketStatus === 'sold_out' && (
              <span className="rounded-full border border-rose-700/60 bg-rose-950/80 px-2.5 py-1 font-mono text-xs font-semibold text-rose-300">
                Sold Out at Primary Box Office
              </span>
            )}

            <span className="rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 font-mono text-xs text-zinc-400">
              {event.eventKind === 'multi_day_festival'
                ? 'Multi-Day Festival'
                : 'Live Concert'}
            </span>
          </div>

          <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
            {event.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 font-mono text-sm text-zinc-300">
            <div className="flex items-center gap-1.5">
              <span className="text-violet-400">📅</span>
              <span className="font-bold text-white">
                {dateInfo.dayOfWeek}, {dateInfo.monthDay}, {dateInfo.year}
              </span>
              {dateInfo.relativeLabel && (
                <span className="rounded border border-violet-800 bg-violet-950/80 px-2 py-0.5 text-xs text-violet-300">
                  {dateInfo.relativeLabel}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-violet-400">⏰</span>
              <span>
                {event.doorTime ? `Doors ${event.doorTime}` : '8:00 PM'}
              </span>
              <span className="text-zinc-500">({event.timezone})</span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-violet-400">📍</span>
              <span className="font-semibold text-white">
                {event.venueName}
              </span>
              <span className="text-zinc-500">•</span>
              <span>
                {event.city}, {event.region}
              </span>
            </div>
          </div>
        </section>

        {/* 3. Preliminary Quick Decision Strip */}
        <section
          aria-label="Preliminary Decision Strip"
          className="rounded-3xl border border-zinc-700/80 bg-zinc-900/80 p-5 shadow-2xl backdrop-blur-xl sm:p-6"
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:items-center">
            {/* Price & Entry Summary */}
            <div className="border-b border-zinc-800/80 pb-4 md:col-span-4 md:border-b-0 md:border-r md:pb-0 md:pr-6">
              <span className="block font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                Ticket Admission
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-black text-white sm:text-3xl">
                  {priceFormatted}
                </span>
                {event.currency && (
                  <span className="font-mono text-xs text-zinc-500">
                    {event.currency}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                {event.minPrice === 0
                  ? 'Free community admission — no ticket required'
                  : event.ticketStatus === 'sold_out'
                    ? 'Face-value primary sold out. Monitor radar for ticket drops.'
                    : 'Official verified primary face-value pricing.'}
              </p>
            </div>

            {/* Live Decision Actions: Ticket Link, Alerts, Watchlist */}
            <div className="flex flex-wrap items-center gap-3 md:col-span-8">
              {/* Official Ticket Link CTA */}
              {event.ticketUrl ? (
                <a
                  href={event.ticketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-zinc-950 shadow-lg transition-all hover:bg-zinc-200 active:scale-95"
                >
                  <span>
                    {event.ticketStatus === 'presale'
                      ? 'Register for Presale'
                      : event.ticketStatus === 'sold_out'
                        ? 'View Official Primary Box Office'
                        : 'Get Official Tickets'}
                  </span>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              ) : (
                <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-5 py-3 font-mono text-xs font-bold text-emerald-300">
                  Free Event · No Tickets Needed
                </div>
              )}

              {/* Alert Toggle Button */}
              <button
                type="button"
                onClick={() => toggleAlertEvent(event.id)}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all active:scale-95 ${
                  hasAlert
                    ? 'border-violet-500 bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.5)]'
                    : 'border-zinc-700 bg-zinc-950/80 text-zinc-200 hover:border-zinc-500 hover:text-white'
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill={hasAlert ? 'currentColor' : 'none'}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
                <span>
                  {hasAlert
                    ? 'Active Signal Alert'
                    : event.ticketStatus === 'presale'
                      ? 'Set Presale Alert'
                      : event.ticketStatus === 'low_inventory'
                        ? 'Set Low Ticket Alert'
                        : 'Track Event Alerts'}
                </span>
              </button>

              {/* Save to Watchlist */}
              <button
                type="button"
                onClick={() => toggleSaveEvent(event.id)}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all active:scale-95 ${
                  isSaved
                    ? 'border-rose-500/70 bg-rose-950/60 text-rose-300'
                    : 'border-zinc-800 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill={isSaved ? 'currentColor' : 'none'}
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                  />
                </svg>
                <span>
                  {isSaved ? 'Saved in Watchlist' : 'Add to Watchlist'}
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* 4. Deep Editorial Evaluation: Pros & Honest Considerations Grid */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Card A: Why the Signal Recommends This */}
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl backdrop-blur sm:p-7">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">
              <span className="flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              <span>Intelligent Signal Justification</span>
            </div>
            <h3 className="mt-2 text-xl font-bold text-white">
              Why the Signal Recommends This Show
            </h3>
            <p className="mt-1 text-xs text-zinc-400">
              Personalized evaluation based on your listening affinities and
              acoustic preferences:
            </p>

            <ul className="mt-5 space-y-3.5">
              {event.whyItSuitsYou.map((pro, index) => (
                <li
                  key={index}
                  className="flex items-start gap-3 text-sm text-zinc-200"
                >
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-600/40 bg-emerald-950 text-xs font-bold text-emerald-400">
                    ✓
                  </div>
                  <span className="leading-relaxed">{pro}</span>
                </li>
              ))}
            </ul>

            {/* Score Factor Visual Bars */}
            <div className="mt-8 space-y-3 border-t border-zinc-800 pt-5">
              <h4 className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                Signal Score Factor Breakdown ({signal.score}/100)
              </h4>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between font-mono text-xs text-zinc-400">
                    <span>Artist & Sound Affinity</span>
                    <span className="font-bold text-white">
                      {signal.breakdown.artistAffinity}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-violet-500"
                      style={{ width: `${signal.breakdown.artistAffinity}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between font-mono text-xs text-zinc-400">
                    <span>Venue Acoustic & Atmosphere Fit</span>
                    <span className="font-bold text-white">
                      {signal.breakdown.venueFit}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${signal.breakdown.venueFit}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between font-mono text-xs text-zinc-400">
                    <span>Ticket Price & Spontaneous Value</span>
                    <span className="font-bold text-white">
                      {signal.breakdown.priceValue}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${signal.breakdown.priceValue}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card B: What to Consider Before Attending (Honest Practical Drawbacks) */}
          <div className="rounded-3xl border border-amber-950/60 bg-zinc-900/60 p-6 shadow-xl backdrop-blur sm:p-7">
            <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-amber-400">
              <span>⚠️</span>
              <span>Practical Attendance Realities</span>
            </div>
            <h3 className="mt-2 text-xl font-bold text-white">
              What to Consider Before Attending
            </h3>
            <p className="mt-1 text-xs text-zinc-400">
              Candid friction factors, curfews, parking, and venue caveats to
              ensure no surprises:
            </p>

            <ul className="mt-5 space-y-3.5">
              {event.considerations.map((con, index) => (
                <li
                  key={index}
                  className="flex items-start gap-3 text-sm text-zinc-300"
                >
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-600/40 bg-amber-950 text-xs font-bold text-amber-400">
                    !
                  </div>
                  <span className="leading-relaxed">{con}</span>
                </li>
              ))}
            </ul>

            {/* Quick Venue & Restrictions Overview */}
            <div className="mt-8 space-y-3 border-t border-zinc-800/80 pt-5">
              <h4 className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                Key Venue & House Rules
              </h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                  <span className="block font-mono text-[10px] text-zinc-500">
                    AGE POLICY
                  </span>
                  <span className="mt-0.5 block font-bold text-white">
                    {event.ageRestriction}
                  </span>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                  <span className="block font-mono text-[10px] text-zinc-500">
                    ROOM LAYOUT
                  </span>
                  <span className="mt-0.5 block font-bold text-white">
                    {event.vibeTags.includes('Intimate Room')
                      ? 'Intimate Standing Room'
                      : event.vibeTags.includes('Tiered Sightlines')
                        ? 'Tiered GA Sightlines'
                        : 'Outdoor Amphitheater'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Audio Preview & Spotify Simulation */}
        {event.spotifyPreviewTrack && (
          <section
            aria-label="Audio Preview"
            className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl backdrop-blur sm:p-7"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  Spotify Audio Preview Snippet
                </span>
                <h3 className="mt-1 text-xl font-bold text-white">
                  Sample {headliner.name}&apos;s Signature Sound
                </h3>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Hear 30 seconds of high-fidelity audio before committing to
                  tickets.
                </p>
              </div>

              <div className="w-full sm:w-auto sm:min-w-[340px]">
                <AudioPreviewPlayer
                  trackTitle={event.spotifyPreviewTrack.title}
                  duration={event.spotifyPreviewTrack.duration}
                  artistName={headliner.name}
                  accentColor={event.posterColor}
                />
              </div>
            </div>
          </section>
        )}

        {/* 6. Lineup & Venue Card */}
        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Lineup Card */}
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl backdrop-blur">
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-violet-400">
              Lineup & Billing
            </h4>
            <div className="mt-4 space-y-3">
              {/* Headliner */}
              <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/80 p-3.5">
                <div>
                  <span className="rounded border border-violet-800 bg-violet-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-300">
                    HEADLINER
                  </span>
                  <p className="mt-1 text-base font-bold text-white">
                    {headliner.name}
                  </p>
                </div>
                <span className="font-mono text-xs text-zinc-400">
                  {event.genre}
                </span>
              </div>

              {/* Support Acts */}
              {supportActs.map((act) => (
                <div
                  key={act.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3"
                >
                  <div>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      SUPPORT
                    </span>
                    <p className="mt-0.5 text-sm font-semibold text-zinc-200">
                      {act.name}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-zinc-500">
                    Guest Artist
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Venue Card */}
          <div className="flex flex-col justify-between rounded-3xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl backdrop-blur">
            <div>
              <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-violet-400">
                Venue Details
              </h4>
              <h3 className="mt-2 text-2xl font-bold text-white">
                {event.venueName}
              </h3>
              <p className="mt-1 text-xs text-zinc-400">
                {event.city}, {event.region}
                {event.lat != null && event.lng != null && (
                  <span>
                    {' '}
                    • Coords: {event.lat.toFixed(4)}, {event.lng.toFixed(4)}
                  </span>
                )}
              </p>

              {/* Atmosphere Vibe Tags */}
              <div className="mt-4 flex flex-wrap gap-2">
                {event.vibeTags.map((vibe) => (
                  <span
                    key={vibe}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200"
                  >
                    {vibe}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-4 text-xs text-zinc-400">
              <span>Timezone</span>
              <span className="font-mono font-semibold text-zinc-200">
                {event.timezone}
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
