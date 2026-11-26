'use client';

import { GuestGate } from '@/components/auth/GuestGate';
import { SupportActsLine } from '@/components/index/SupportActsLine';
import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { IndexEventItem } from './types';
import {
  formatIndexEventDate,
  formatIndexPrice,
  getVerifiedAvailabilityBadge,
  hasRealMatchScore,
  getArtistAccent,
} from './formatters';
import { EventImage } from './EventImage';
import { MatchScore } from './MatchScore';
import { SaveHeartButton } from './SaveHeartButton';
import { GenreBadge } from './GenreBadge';
import { eventGenreList } from '@/lib/genres/catalog-genres';
import {
  BellIcon,
  MapPinIcon,
  CalendarIcon,
  SparklesIcon,
  ArrowRightIcon,
  AlertCircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from './icons';
import {
  downloadIcsFile,
  generateGoogleCalendarUrl,
} from '@/lib/utils/calendar-export';

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
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const calendarMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        calendarMenuRef.current &&
        !calendarMenuRef.current.contains(e.target as Node)
      ) {
        setCalendarMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setCalendarMenuOpen(false);
    }
    if (calendarMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [calendarMenuOpen]);

  const isPersonalized = hasRealMatchScore(event.personalScore);
  const isDisliked = Boolean(event.personalScore?.isDisliked);
  const isFavorite = Boolean(event.personalScore?.isFavorite);

  const statusBadge = getVerifiedAvailabilityBadge(
    event.inventoryStatus,
    event.ticketRemainingPercent,
  );
  const isSoldOut = event.inventoryStatus === 'sold_out';
  const isCancelled = event.inventoryStatus === 'cancelled';

  const headlinerName = event.headlinerName || event.title;
  const supportActs = (event.artists || []).filter(
    (a) => a.name !== headlinerName && a.billingPosition !== 'headliner',
  );

  const accent = getArtistAccent(headlinerName);
  const detailUrl = href || `/concerts/${event.id}`;

  return (
    <article
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/90 bg-white transition-all duration-200 ease-out hover:border-zinc-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] ${
        isDisliked ? 'border-dashed bg-zinc-50/80 opacity-60' : ''
      }`}
    >
      {/* Media: event -> artist -> venue -> graphic cascade */}
      <EventImage
        event={event}
        className="aspect-[16/9] w-full"
        graphicSize="lg"
        imgClassName="transition-transform duration-300 ease-out group-hover:scale-105"
      >
        <div
          className="absolute bottom-0 left-0 right-0 h-1"
          style={{
            background: `linear-gradient(90deg, ${accent.primary} 0%, ${accent.secondary} 100%)`,
          }}
        />
      </EventImage>

      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {/* Top Badges & Quick Action Controls */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Inventory / Status Badge */}
            {statusBadge && (
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${statusBadge.bg}`}
              >
                {statusBadge.label}
              </span>
            )}

            {/* Status labels only; the match score itself sits under the price. */}
            {isPersonalized ? (
              isDisliked ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                  <AlertCircleIcon className="h-3 w-3" />
                  <span>Suppressed (Disliked)</span>
                </span>
              ) : isFavorite ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  <SparklesIcon className="h-3 w-3 text-amber-600" />
                  <span>Favorite Artist</span>
                </span>
              ) : null
            ) : null}

            <GenreBadge
              genre={eventGenreList(event)}
              inferred={event.genresInferred}
            />
          </div>

          {/* Quick Action Controls (Save, Alert, Calendar Export) */}
          <div className="-mr-1 flex items-center gap-1">
            <SaveHeartButton
              eventId={event.id}
              title={headlinerName}
              isSaved={isSaved}
              onToggle={(id, title) => onToggleSave?.(id, title)}
            />

            <GuestGate
              message="Sign in to get ticket alerts"
              placement="bottom"
              align="end"
              className="relative z-10"
            >
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
                className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-lg border transition-all duration-150 ease-out active:scale-[0.92] ${
                  hasAlert
                    ? 'shadow-xs border-violet-200 bg-violet-50 text-violet-600'
                    : 'border-transparent text-zinc-400 hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-700'
                }`}
              >
                <BellIcon className="h-4 w-4" filled={hasAlert} />
              </button>
            </GuestGate>

            {/* Calendar Export Menu */}
            <div className="relative" ref={calendarMenuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCalendarMenuOpen(!calendarMenuOpen);
                }}
                aria-label={`Export ${headlinerName} to calendar`}
                aria-expanded={calendarMenuOpen}
                className="relative z-10 flex h-10 w-10 items-center justify-center rounded-lg border border-transparent text-zinc-400 transition-all duration-150 ease-out hover:border-zinc-200 hover:bg-zinc-50 hover:text-zinc-700 active:scale-[0.92]"
              >
                <CalendarIcon className="h-4 w-4" />
              </button>

              {calendarMenuOpen && (
                <div
                  className="absolute right-0 top-9 z-30 w-44 rounded-xl border border-zinc-200 bg-white py-1.5 text-xs shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      downloadIcsFile(event);
                      setCalendarMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                  >
                    <DownloadIcon className="h-3.5 w-3.5 text-zinc-500" />
                    <span>Apple / iCal (.ics)</span>
                  </button>
                  <a
                    href={generateGoogleCalendarUrl(event)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setCalendarMenuOpen(false)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                  >
                    <ExternalLinkIcon className="h-3.5 w-3.5 text-zinc-500" />
                    <span>Google Calendar</span>
                  </a>
                </div>
              )}
            </div>
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

          <SupportActsLine
            acts={supportActs}
            className="mt-0.5 line-clamp-1 text-xs text-zinc-500"
          />

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
              {formatIndexEventDate(event)}
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
                event.ticketUrl,
              )}
            </span>

            {event.ageRestriction &&
              event.ageRestriction.toLowerCase() !== 'all ages' && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600">
                  {event.ageRestriction}
                </span>
              )}
          </div>

          {/* Real 0-100 match score only (never fabricated for guests or suppressed shows) */}
          {isPersonalized && !isDisliked && event.personalScore && (
            <div>
              <MatchScore
                personalScore={event.personalScore}
                data-testid="card-match-score"
              />
            </div>
          )}
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

        {(event.ticketUrl || event.officialUrl) && !isCancelled && (
          <a
            // No ticket link: the show's page on the venue site (never a web search).
            href={(event.ticketUrl || event.officialUrl) as string}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`font-mono text-[11px] transition-colors ${
              isSoldOut
                ? 'font-semibold text-rose-600 hover:text-rose-800'
                : 'text-zinc-400 hover:text-zinc-800'
            }`}
          >
            {isSoldOut
              ? 'Sold Out ↗'
              : event.ticketUrl
                ? 'Tickets ↗'
                : 'Venue page ↗'}
          </a>
        )}
      </div>
    </article>
  );
}
