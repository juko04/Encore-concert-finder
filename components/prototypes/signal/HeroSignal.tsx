'use client';

import React from 'react';
import Link from 'next/link';
import type { PrototypeEvent } from '@/lib/prototypes/fixtures';
import { usePrototypeStore } from '@/lib/prototypes/store';
import {
  computeSignalScore,
  formatEventDate,
  formatEventPrice,
} from '@/lib/prototypes/signal-helpers';
import { AudioPreviewPlayer } from './AudioPreviewPlayer';

interface HeroSignalProps {
  event: PrototypeEvent;
}

export function HeroSignal({ event }: HeroSignalProps) {
  const {
    viewMode,
    preferences,
    savedEventIds,
    alertEventIds,
    toggleSaveEvent,
    toggleAlertEvent,
  } = usePrototypeStore();

  const signal = computeSignalScore(event, preferences, viewMode);
  const dateInfo = formatEventDate(event.localStartDate);
  const priceFormatted = formatEventPrice(
    event.minPrice,
    event.maxPrice,
    event.currency,
  );

  const isSaved = savedEventIds.includes(event.id);
  const hasAlert = alertEventIds.includes(event.id);

  return (
    <section
      aria-label="Hero Signal Recommendation"
      className="relative overflow-hidden rounded-3xl border border-zinc-700/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950 p-6 shadow-2xl backdrop-blur-xl sm:p-8 md:p-10"
      style={{
        boxShadow: `0 0 60px -15px ${event.posterColor}33, 0 20px 40px -10px rgba(0,0,0,0.7)`,
      }}
    >
      {/* Dynamic Background Glow derived from artist poster color */}
      <div
        className="pointer-events-none absolute -left-20 -top-40 h-96 w-96 rounded-full opacity-25 blur-[120px]"
        style={{ backgroundColor: event.posterColor }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-20 h-96 w-96 rounded-full opacity-20 blur-[140px]"
        style={{ backgroundColor: event.posterSecondaryColor }}
      />

      <div className="relative z-10 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
        {/* Left Column: Context & Editorial Signal */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-950/70 px-3 py-1 font-mono text-xs font-bold text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.3)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-violet-400" />
              TOP RADAR SIGNAL
            </span>

            <span
              className={`rounded-full border px-3 py-1 font-mono text-xs font-bold ${signal.badgeColorClass}`}
            >
              {signal.badgeLabel}
            </span>

            {event.ticketStatus === 'presale' && (
              <span className="rounded-full border border-amber-500/40 bg-amber-950/70 px-2.5 py-1 font-mono text-xs font-semibold text-amber-300">
                ⚡ PRESALE OPENS THURSDAY
              </span>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
              <span className="font-semibold text-zinc-200">
                {dateInfo.dayOfWeek}, {dateInfo.monthDay}, {dateInfo.year}
              </span>
              <span>•</span>
              <span className="text-zinc-300">{event.venueName}</span>
              <span>•</span>
              <span>
                {event.city}, {event.region}
              </span>
            </div>

            <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">
              {event.title}
            </h2>
          </div>

          {/* Editorial Insights Bullet Highlights */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 sm:p-5">
            <h4 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-violet-400">
              Why the Signal Recommends This:
            </h4>
            <ul className="space-y-1.5 text-sm text-zinc-300">
              {event.whyItSuitsYou.slice(0, 3).map((reason, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="shrink-0 font-bold text-emerald-400">✓</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href={`/prototypes/signal/concerts/${event.id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-zinc-950 shadow-lg transition-all duration-150 hover:bg-zinc-200 active:scale-[0.98]"
            >
              <span>Evaluate Concert Details</span>
              <span>&rarr;</span>
            </Link>

            {/* Alert Toggle Button */}
            <button
              type="button"
              onClick={() => toggleAlertEvent(event.id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-150 active:scale-[0.98] ${
                hasAlert
                  ? 'border-violet-500/80 bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.5)]'
                  : 'border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:border-zinc-500 hover:text-white'
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
                {hasAlert ? 'Presale Alert Active' : 'Set Presale Alert'}
              </span>
            </button>

            {/* Save to Watchlist */}
            <button
              type="button"
              onClick={() => toggleSaveEvent(event.id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-150 active:scale-[0.98] ${
                isSaved
                  ? 'border-rose-500/60 bg-rose-950/40 text-rose-300'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
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
              <span>{isSaved ? 'Saved in Watchlist' : 'Watch'}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Audio Preview & Visual Poster Badge */}
        <div className="space-y-4 lg:col-span-5">
          <div
            className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 shadow-xl"
            style={{
              borderColor: `${event.posterColor}44`,
            }}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="font-mono text-[10px] uppercase text-zinc-400">
                  Target Venue
                </span>
                <p className="text-sm font-semibold text-white sm:text-base">
                  {event.venueName}
                </p>
              </div>
              <div className="text-right">
                <span className="font-mono text-[10px] uppercase text-zinc-400">
                  Estimated Entry
                </span>
                <p className="font-mono text-sm font-bold text-white sm:text-base">
                  {priceFormatted}
                </p>
              </div>
            </div>

            <div className="space-y-2 pb-2 pt-3">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Sound & Atmosphere</span>
                <span className="font-mono text-zinc-200">{event.genre}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Age Restriction</span>
                <span className="font-mono text-zinc-200">
                  {event.ageRestriction}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Inventory Status</span>
                <span className="font-mono uppercase text-emerald-400">
                  {event.ticketStatus}
                </span>
              </div>
            </div>

            {/* Embedded Audio Preview */}
            {event.spotifyPreviewTrack && (
              <div className="mt-4 border-t border-zinc-800/80 pt-3">
                <AudioPreviewPlayer
                  trackTitle={event.spotifyPreviewTrack.title}
                  duration={event.spotifyPreviewTrack.duration}
                  artistName={event.artists[0]?.name}
                  accentColor={event.posterColor}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
