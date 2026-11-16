'use client';

import React from 'react';
import Link from 'next/link';
import type { PrototypeEvent } from '@/lib/prototypes/fixtures';
import type { UserViewMode } from '@/lib/prototypes/store';
import { formatEventDate, formatPrice, getStatusBadge } from './formatters';
import {
  HeartIcon,
  BellIcon,
  SparklesIcon,
  AlertCircleIcon,
  ArrowRightIcon,
} from './icons';

interface EventListItemProps {
  event: PrototypeEvent;
  isSaved: boolean;
  hasAlert: boolean;
  viewMode: UserViewMode;
  onToggleSave: (id: string) => void;
  onToggleAlert: (id: string) => void;
}

export function EventListItem({
  event,
  isSaved,
  hasAlert,
  viewMode,
  onToggleSave,
  onToggleAlert,
}: EventListItemProps) {
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

  return (
    <div
      className={`group flex flex-col justify-between gap-3 border-b border-zinc-200/80 bg-white px-4 py-3.5 transition-colors hover:bg-zinc-50/80 sm:flex-row sm:items-center ${
        isDisliked ? 'bg-zinc-50 opacity-50' : ''
      }`}
    >
      {/* Left Column: Artwork Dot / Badge + Name + Date + Venue */}
      <div className="flex min-w-0 flex-1 items-start gap-3.5 sm:items-center">
        {/* Poster Swatch Avatar */}
        <div
          className="shadow-xs relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold text-white transition-transform duration-150 group-hover:scale-105"
          style={{
            background: `linear-gradient(135deg, ${event.posterColor} 0%, ${event.posterSecondaryColor} 100%)`,
          }}
        >
          {headliner?.name.charAt(0) || 'E'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/prototypes/index/concerts/${event.id}`}
              className="truncate text-sm font-semibold text-zinc-900 hover:underline focus-visible:outline-none"
            >
              {headliner?.name || event.title}
            </Link>

            {/* Status Badge */}
            <span
              className={`py-0.2 rounded border px-1.5 text-[10px] font-medium tracking-wide ${statusBadge.bg}`}
            >
              {statusBadge.label}
            </span>

            {/* Personal Match Score */}
            {isAuth &&
              (isDisliked ? (
                <span className="py-0.2 inline-flex items-center gap-0.5 rounded border border-rose-200 bg-rose-50 px-1.5 text-[10px] font-medium text-rose-700">
                  <AlertCircleIcon className="h-2.5 w-2.5" />
                  <span>Suppressed</span>
                </span>
              ) : isFavorite ? (
                <span className="py-0.2 inline-flex items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800">
                  <SparklesIcon className="h-2.5 w-2.5 text-amber-600" />
                  <span>{score}% Match</span>
                </span>
              ) : (
                <span className="py-0.2 rounded border border-zinc-200 bg-zinc-50 px-1.5 text-[10px] font-medium text-zinc-600">
                  {score}%
                </span>
              ))}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500">
            <span className="font-medium text-zinc-700">
              {formatEventDate(event.localStartDate, event.doorTime)}
            </span>
            <span>·</span>
            <span className="truncate">
              {event.venueName} ({event.city})
            </span>
            <span>·</span>
            <span className="font-mono text-[11px] text-zinc-400">
              {event.genre.split('/')[0].trim()}
            </span>
          </div>
        </div>
      </div>

      {/* Right Column: Price + Action Buttons */}
      <div className="pl-13 flex shrink-0 items-center justify-between gap-4 sm:justify-end sm:pl-0">
        <div className="text-right">
          <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
            {formatPrice(event.minPrice, event.maxPrice, event.currency)}
          </div>
          {event.ageRestriction !== 'all_ages' && (
            <div className="font-mono text-[10px] text-zinc-400">
              {event.ageRestriction}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleSave(event.id)}
            aria-label={
              isSaved
                ? `Remove ${event.title} from watchlist`
                : `Save ${event.title} to watchlist`
            }
            aria-pressed={isSaved}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 ease-out active:scale-[0.92] ${
              isSaved
                ? 'border-rose-200 bg-rose-50 text-rose-600'
                : 'border-transparent text-zinc-400 hover:border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700'
            }`}
          >
            <HeartIcon className="h-4 w-4" filled={isSaved} />
          </button>

          <button
            type="button"
            onClick={() => onToggleAlert(event.id)}
            aria-label={
              hasAlert
                ? `Disable alerts for ${event.title}`
                : `Enable presale & ticket alerts for ${event.title}`
            }
            aria-pressed={hasAlert}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-150 ease-out active:scale-[0.92] ${
              hasAlert
                ? 'border-violet-200 bg-violet-50 text-violet-600'
                : 'border-transparent text-zinc-400 hover:border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700'
            }`}
          >
            <BellIcon className="h-4 w-4" filled={hasAlert} />
          </button>

          <Link
            href={`/prototypes/index/concerts/${event.id}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-zinc-400 transition-colors hover:border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label={`View details for ${event.title}`}
          >
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
