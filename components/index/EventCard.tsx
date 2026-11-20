'use client';

import React from 'react';
import Link from 'next/link';
import type { IndexEventItem } from './types';
import {
  formatIndexDate,
  formatIndexPrice,
  getStatusBadge,
} from './formatters';
import {
  HeartIcon,
  BellIcon,
  MapPinIcon,
  CalendarIcon,
  SparklesIcon,
  ArrowRightIcon,
  AlertCircleIcon,
} from './icons';

export interface EventCardProps {
  event: IndexEventItem;
  isSaved?: boolean;
  hasAlert?: boolean;
  onToggleSave?: (id: string, title?: string) => void;
  onToggleAlert?: (id: string, title?: string) => void;
  href?: string;
}

export function EventCard({
  event,
  isSaved = false,
  hasAlert = false,
  onToggleSave,
  onToggleAlert,
  href,
}: EventCardProps) {
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

  const detailUrl = href || `/concerts/${event.id}`;

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
            {/* Inventory / Status Badge */}
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${statusBadge.bg}`}
            >
              {statusBadge.label}
            </span>

            {/* Personal Match Score vs Guest Genre Pill */}
            {isPersonalized ? (
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
            ) : event.genre ? (
              <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-500">
                {event.genre.split('/')[0].trim()}
              </span>
            ) : null}
          </div>

          {/* Quick Action Buttons (Save & Alert) */}
          <div className="-mr-1 flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleSave?.(event.id, headlinerName);
              }}
              aria-label={
                isSaved
                  ? `Remove ${headlinerName} from watchlist`
                  : `Save ${headlinerName} to watchlist`
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
                onToggleAlert?.(event.id, headlinerName);
              }}
              aria-label={
                hasAlert
                  ? `Disable alerts for ${headlinerName}`
                  : `Enable ticket alerts for ${headlinerName}`
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
            href={detailUrl}
            className="focus-visible:outline-hidden rounded-sm focus-visible:ring-2 focus-visible:ring-zinc-900"
          >
            <h3 className="text-lg font-semibold leading-snug text-zinc-900 transition-colors group-hover:text-zinc-700">
              {headlinerName}
            </h3>
          </Link>

          {supportActs.length > 0 && (
            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
              with {supportActs.map((a) => a.name).join(', ')}
            </p>
          )}

          {event.title && event.title !== headlinerName && (
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
              {formatIndexDate(
                event.localStartDate,
                event.doorTime || event.startsAt,
                event.timezone,
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <MapPinIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <span className="truncate">
              {event.venueName || 'Venue TBA'}
              {event.city ? (
                <>
                  {' '}
                  ·{' '}
                  <span className="text-zinc-400">
                    {event.city}
                    {event.region ? `, ${event.region}` : ''}
                  </span>
                </>
              ) : null}
            </span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900">
              {formatIndexPrice(
                event.minPrice,
                event.maxPrice,
                event.currency,
                event.eventKind,
              )}
            </span>

            {event.ageRestriction &&
              event.ageRestriction.toLowerCase() !== 'all ages' && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
                  {event.ageRestriction}
                </span>
              )}
          </div>
        </div>

        {/* Match Reason or Pitch */}
        {isPersonalized && event.personalScore?.matchReason && !isDisliked && (
          <div className="mt-3 rounded-lg border border-zinc-100 bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-600">
            <span className="font-medium text-zinc-800">Why: </span>
            {event.personalScore.matchReason}
          </div>
        )}
      </div>

      {/* Card Footer Link */}
      <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50/60 px-5 py-2.5 text-xs font-medium text-zinc-600 transition-colors group-hover:bg-zinc-50 group-hover:text-zinc-900">
        <Link
          href={detailUrl}
          className="focus-visible:outline-hidden inline-flex items-center gap-1.5 hover:underline"
        >
          <span>View Details & Guide</span>
          <ArrowRightIcon className="h-3.5 w-3.5 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
        </Link>

        {event.ticketUrl && !isCancelled && (
          <a
            href={event.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`font-mono text-[11px] transition-colors ${
              isSoldOut
                ? 'font-semibold text-rose-600 hover:text-rose-800'
                : 'text-zinc-400 hover:text-zinc-800'
            }`}
          >
            {isSoldOut ? 'Sold Out ↗' : 'Tickets ↗'}
          </a>
        )}
      </div>
    </article>
  );
}
