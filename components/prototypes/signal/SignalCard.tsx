'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { PrototypeEvent } from '@/lib/prototypes/fixtures';
import { usePrototypeStore } from '@/lib/prototypes/store';
import {
  computeSignalScore,
  formatEventDate,
  formatEventPrice,
} from '@/lib/prototypes/signal-helpers';
import { AudioPreviewPlayer } from './AudioPreviewPlayer';

interface SignalCardProps {
  event: PrototypeEvent;
  priorityScoreBadge?: boolean;
}

export function SignalCard({ event }: SignalCardProps) {
  const {
    viewMode,
    preferences,
    savedEventIds,
    alertEventIds,
    toggleSaveEvent,
    toggleAlertEvent,
  } = usePrototypeStore();
  const [isHovered, setIsHovered] = useState(false);

  const isSaved = savedEventIds.includes(event.id);
  const hasAlert = alertEventIds.includes(event.id);

  const signal = computeSignalScore(event, preferences, viewMode);
  const dateInfo = formatEventDate(event.localStartDate);
  const priceFormatted = formatEventPrice(
    event.minPrice,
    event.maxPrice,
    event.currency,
  );

  const headliner =
    event.artists.find((a) => a.billingPosition === 'headliner') ||
    event.artists[0];
  const supportActs = event.artists.filter(
    (a) => a.billingPosition !== 'headliner',
  );

  const handleSaveClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSaveEvent(event.id);
  };

  const handleAlertClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleAlertEvent(event.id);
  };

  return (
    <article
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border bg-zinc-900/70 p-5 backdrop-blur-md transition-all duration-200 ${
        signal.isSuppressed
          ? 'border-rose-950/60 opacity-60 hover:opacity-100'
          : 'border-zinc-800/90 hover:border-zinc-700'
      }`}
      style={{
        boxShadow:
          isHovered && !signal.isSuppressed
            ? `0 0 30px -5px ${event.posterColor}30, 0 10px 25px -5px rgba(0,0,0,0.5)`
            : '0 4px 12px rgba(0, 0, 0, 0.25)',
      }}
    >
      {/* Top Artwork Gradient Aura (Subtle atmospheric glow) */}
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-20 blur-3xl transition-opacity duration-300 group-hover:opacity-40"
        style={{ backgroundColor: event.posterColor }}
      />

      <div>
        {/* Header Bar: Signal Score Pill + Date + Quick Actions */}
        <div className="flex items-start justify-between gap-2">
          {/* Signal Match / Radar Pill */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-tight shadow-sm ${signal.badgeColorClass}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: event.posterColor }}
              />
              {signal.badgeLabel}
            </span>

            {/* Ticket Status Pill */}
            {event.ticketStatus === 'presale' && (
              <span className="rounded-full border border-violet-700/60 bg-violet-950/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-300">
                ⚡ PRESALE
              </span>
            )}
            {event.ticketStatus === 'low_inventory' && (
              <span className="animate-pulse rounded-full border border-amber-700/60 bg-amber-950/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                ⚠️ &lt;35 LEFT
              </span>
            )}
            {event.ticketStatus === 'sold_out' && (
              <span className="rounded-full border border-rose-700/60 bg-rose-950/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
                SOLD OUT
              </span>
            )}
          </div>

          {/* Quick Action Icons: Save & Alert */}
          <div className="flex shrink-0 items-center gap-1">
            {/* Alert Toggle */}
            <button
              type="button"
              onClick={handleAlertClick}
              aria-label={
                hasAlert
                  ? `Remove alert for ${event.title}`
                  : `Set alert for ${event.title}`
              }
              aria-pressed={hasAlert}
              className={`rounded-lg p-1.5 transition-colors duration-150 active:scale-90 ${
                hasAlert
                  ? 'bg-violet-600 text-white shadow-[0_0_10px_rgba(139,92,246,0.5)]'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
              title={hasAlert ? 'Alert Active' : 'Set Presale/Ticket Alert'}
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
            </button>

            {/* Save to Watchlist */}
            <button
              type="button"
              onClick={handleSaveClick}
              aria-label={
                isSaved
                  ? `Remove ${event.title} from watchlist`
                  : `Save ${event.title} to watchlist`
              }
              aria-pressed={isSaved}
              className={`rounded-lg p-1.5 transition-colors duration-150 active:scale-90 ${
                isSaved
                  ? 'border border-rose-500/40 bg-rose-500/20 text-rose-400'
                  : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
              title={isSaved ? 'Saved in Watchlist' : 'Save to Watchlist'}
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
            </button>
          </div>
        </div>

        {/* Date Strip & Relative Pill */}
        <div className="mt-3 flex items-center gap-2 font-mono text-xs text-zinc-400">
          <span className="font-semibold text-zinc-200">
            {dateInfo.dayOfWeek}, {dateInfo.monthDay}
          </span>
          {dateInfo.relativeLabel && (
            <span className="py-0.2 rounded bg-zinc-800/80 px-1.5 text-[10px] text-zinc-300">
              {dateInfo.relativeLabel}
            </span>
          )}
          {event.doorTime && (
            <span className="text-zinc-500">• Doors {event.doorTime}</span>
          )}
        </div>

        {/* Artist / Event Title */}
        <Link
          href={`/prototypes/signal/concerts/${event.id}`}
          className="group/title mt-2 block"
        >
          <h3 className="text-xl font-bold tracking-tight text-white transition-colors group-hover/title:text-violet-300">
            {event.title}
          </h3>
        </Link>

        {/* Support Acts & Lineup */}
        {supportActs.length > 0 && (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-400">
            with{' '}
            {supportActs.map((act, i) => (
              <span key={act.id} className="text-zinc-300">
                {act.name}
                {i < supportActs.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>
        )}

        {/* Venue, City & Distance */}
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-zinc-300">
          <svg
            className="h-3.5 w-3.5 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="font-medium text-white">{event.venueName}</span>
          <span className="text-zinc-500">•</span>
          <span>
            {event.city}, {event.region}
          </span>
        </div>

        {/* Signal Editorial Match Justification */}
        <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-2.5 text-xs">
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 font-bold text-violet-400">↳</span>
            <p className="leading-relaxed text-zinc-300">
              <strong className="text-zinc-200">Signal Insight:</strong>{' '}
              {signal.matchReason}
            </p>
          </div>
        </div>

        {/* Vibe & Genre Tags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-md bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
            {event.genre}
          </span>
          {event.vibeTags.slice(0, 2).map((vibe) => (
            <span
              key={vibe}
              className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400"
            >
              {vibe}
            </span>
          ))}
          <span className="rounded-md border border-zinc-800/60 bg-zinc-900/40 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
            {event.ageRestriction}
          </span>
        </div>
      </div>

      {/* Footer Strip: Price, Audio Snippet, & Decision CTA */}
      <div className="mt-5 flex items-center justify-between gap-2 border-t border-zinc-800/70 pt-3">
        <div>
          <span className="block font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            Ticket Price
          </span>
          <span className="font-mono text-sm font-bold text-white">
            {priceFormatted}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {event.spotifyPreviewTrack && (
            <AudioPreviewPlayer
              trackTitle={event.spotifyPreviewTrack.title}
              duration={event.spotifyPreviewTrack.duration}
              artistName={headliner?.name}
              accentColor={event.posterColor}
              compact
            />
          )}

          <Link
            href={`/prototypes/signal/concerts/${event.id}`}
            className="inline-flex items-center gap-1 rounded-xl bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-all duration-150 hover:bg-zinc-700 hover:text-white active:scale-95"
          >
            <span>Evaluate</span>
            <span>&rarr;</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
