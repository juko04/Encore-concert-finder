'use client';

import React from 'react';
import Link from 'next/link';
import type { PrototypeEvent } from '@/lib/prototypes/fixtures';
import type { UserViewMode } from '@/lib/prototypes/store';
import { formatEventDate, formatPrice, getStatusBadge } from './formatters';
import {
  HeartIcon,
  BellIcon,
  MapPinIcon,
  CalendarIcon,
  SparklesIcon,
  ArrowRightIcon,
  AlertCircleIcon,
} from './icons';

interface EventCardProps {
  event: PrototypeEvent;
  isSaved: boolean;
  hasAlert: boolean;
  viewMode: UserViewMode;
  onToggleSave: (id: string) => void;
  onToggleAlert: (id: string) => void;
}

export function EventCard({
  event,
  isSaved,
  hasAlert,
  viewMode,
  onToggleSave,
  onToggleAlert,
}: EventCardProps) {
  const isAuth = viewMode === 'authenticated';
  const score = isAuth
    ? event.samplePersonalScore.authenticatedScore
    : event.samplePersonalScore.guestScore;

  const isDisliked =
    isAuth && event.samplePersonalScore.affinityType === 'disliked';
  const isFavorite =
    isAuth && event.samplePersonalScore.affinityType === 'favorite';
  const statusBadge = getStatusBadge(event.ticketStatus);

  const headliner =
    event.artists.find((a) => a.billingPosition === 'headliner') ||
    event.artists[0];
  const supportActs = event.artists.filter((a) => a.id !== headliner?.id);

  return (
    <article
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/90 bg-white transition-all duration-200 ease-out hover:border-zinc-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] ${
        isDisliked ? 'border-dashed bg-zinc-50/80 opacity-60' : ''
      }`}
    >
      {/* Visual Accent Top Bar (Derived from Poster Palette) */}
      <div
        className="h-1.5 w-full transition-opacity duration-200 group-hover:h-2"
        style={{
          background: `linear-gradient(90deg, ${event.posterColor} 0%, ${event.posterSecondaryColor} 100%)`,
        }}
      />

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {/* Top Badges & Quick Action Controls */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Status Badge */}
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${statusBadge.bg}`}
            >
              {statusBadge.label}
            </span>

            {/* Match Score Badge (Personalized vs Guest Mode) */}
            {isAuth ? (
              isDisliked ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                  <AlertCircleIcon className="h-3 w-3" />
                  <span>Suppressed (Disliked)</span>
                </span>
              ) : isFavorite ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  <SparklesIcon className="h-3 w-3 text-amber-600" />
                  <span>Favorite Artist · {score}%</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                  <span>{score}% match</span>
                </span>
              )
            ) : (
              <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                {event.genre.split('/')[0].trim()}
              </span>
            )}
          </div>

          {/* Quick Action Buttons (Save & Alert) */}
          <div className="-mr-1 flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSave(event.id);
              }}
              aria-label={
                isSaved
                  ? `Remove ${event.title} from watchlist`
                  : `Save ${event.title} to watchlist`
              }
              aria-pressed={isSaved}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 ease-out active:scale-[0.92] ${
                isSaved
                  ? 'shadow-xs border-rose-200 bg-rose-50 text-rose-600'
                  : 'border-transparent text-zinc-400 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-700'
              }`}
            >
              <HeartIcon className="h-4 w-4" filled={isSaved} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleAlert(event.id);
              }}
              aria-label={
                hasAlert
                  ? `Disable alerts for ${event.title}`
                  : `Enable presale & ticket alerts for ${event.title}`
              }
              aria-pressed={hasAlert}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 ease-out active:scale-[0.92] ${
                hasAlert
                  ? 'shadow-xs border-violet-200 bg-violet-50 text-violet-600'
                  : 'border-transparent text-zinc-400 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-700'
              }`}
            >
              <BellIcon className="h-4 w-4" filled={hasAlert} />
            </button>
          </div>
        </div>

        {/* Primary Content: Event Title & Headliner */}
        <div className="mb-4">
          <Link
            href={`/prototypes/index/concerts/${event.id}`}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            <h3 className="text-lg font-semibold leading-snug text-zinc-900 transition-colors group-hover:text-zinc-700">
              {headliner?.name || event.title}
            </h3>
          </Link>

          {supportActs.length > 0 && (
            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
              with {supportActs.map((a) => a.name).join(', ')}
            </p>
          )}

          {event.title !== headliner?.name && (
            <p className="mt-1 line-clamp-1 text-xs italic text-zinc-400">
              {event.title}
            </p>
          )}
        </div>

        {/* Metadata Details (Date, Venue, Price) */}
        <div className="mt-auto space-y-1.5 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span className="font-medium text-zinc-800">
              {formatEventDate(event.localStartDate, event.doorTime)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span className="truncate">
              {event.venueName} ·{' '}
              <span className="text-zinc-400">
                {event.city}, {event.region}
              </span>
            </span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
              {formatPrice(event.minPrice, event.maxPrice, event.currency)}
            </span>

            {event.ageRestriction !== 'all_ages' && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
                {event.ageRestriction}
              </span>
            )}
          </div>
        </div>

        {/* Match Reason or Curated Pitch */}
        {isAuth && event.samplePersonalScore.matchReason && !isDisliked && (
          <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-600">
            <span className="font-medium text-zinc-800">Why: </span>
            {event.samplePersonalScore.matchReason}
          </div>
        )}
      </div>

      {/* Card Footer Link */}
      <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/60 px-5 py-2.5 text-xs font-medium text-zinc-600 transition-colors group-hover:bg-zinc-50 group-hover:text-zinc-900">
        <Link
          href={`/prototypes/index/concerts/${event.id}`}
          className="inline-flex items-center gap-1.5 hover:underline focus-visible:outline-none"
        >
          <span>View Details & Guide</span>
          <ArrowRightIcon className="h-3.5 w-3.5 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
        </Link>

        {event.ticketUrl && (
          <a
            href={event.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-[11px] text-zinc-400 transition-colors hover:text-zinc-800"
          >
            Tickets ↗
          </a>
        )}
      </div>
    </article>
  );
}
