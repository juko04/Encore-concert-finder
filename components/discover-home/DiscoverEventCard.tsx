'use client';

import React from 'react';
import Link from 'next/link';
import type { IndexEventItem } from '@/components/index/types';
import {
  formatIndexEventDate,
  formatIndexPrice,
  getArtistAccent,
  getVerifiedAvailabilityBadge,
  getCardMatchScoreLabel,
} from '@/components/index/formatters';
import { SupportActsLine } from '@/components/index/SupportActsLine';
import { GenreBadge } from '@/components/index/GenreBadge';
import { MatchScore } from '@/components/index/MatchScore';
import { SaveHeartButton } from '@/components/index/SaveHeartButton';
import { useWatchlist } from '@/components/index/useWatchlist';
import { eventGenreList } from '@/lib/genres/catalog-genres';
import { EventImage } from '@/components/index/EventImage';

export interface DiscoverEventCardProps {
  event: IndexEventItem;
}

/**
 * Compact, image-forward card for horizontal Discover rows.
 * Image fallback hierarchy matches the Index EventCard: event image, then
 * artist image, then venue image, then a neutral accent graphic. No image is
 * ever invented.
 */
export function DiscoverEventCard({ event }: DiscoverEventCardProps) {
  const headlinerName = event.headlinerName || event.title;
  const { isSaved, toggleSave } = useWatchlist();
  const accent = getArtistAccent(headlinerName);
  const supportActs = (event.artists || []).filter(
    (a) => a.name !== headlinerName && a.billingPosition !== 'headliner',
  );

  const dateLabel = formatIndexEventDate(event);
  const [dayPart, timePart] = dateLabel.split(' · ');
  const price = formatIndexPrice(
    event.minPrice,
    event.maxPrice,
    event.currency,
    event.eventKind,
    event.ticketUrl,
  );
  const badge = getVerifiedAvailabilityBadge(
    event.inventoryStatus,
    event.ticketRemainingPercent,
  );
  const matchLabel = getCardMatchScoreLabel(event.personalScore);
  const place = [event.venueName, event.city].filter(Boolean).join(' · ');

  return (
    <div className="relative w-60 shrink-0 snap-start sm:w-64">
      <Link
        href={`/concerts/${event.id}`}
        data-testid="discover-event-card"
        className="group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white transition-all duration-200 hover:border-zinc-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
      >
        <EventImage
          event={event}
          className="aspect-[4/3] w-full"
          width={480}
          height={360}
          graphicSize="lg"
          imgClassName="transition-transform duration-300 ease-out group-hover:scale-105"
        >
          <div
            className="absolute inset-x-0 bottom-0 h-1"
            style={{
              background: `linear-gradient(90deg, ${accent.primary} 0%, ${accent.secondary} 100%)`,
            }}
          />
          <span className="absolute left-2.5 top-2.5 rounded-md bg-white/95 px-2 py-1 text-[11px] font-semibold text-zinc-800 shadow-sm">
            {dayPart}
          </span>
          {badge && (
            <span
              className={`absolute bottom-3 left-2.5 rounded-md border px-2 py-0.5 text-[11px] ${badge.bg}`}
            >
              {badge.label}
            </span>
          )}
        </EventImage>

        <div className="flex flex-1 flex-col gap-1 p-3.5">
          <h3 className="line-clamp-2 text-sm font-bold leading-snug tracking-tight text-zinc-900">
            {headlinerName}
          </h3>
          <SupportActsLine
            acts={supportActs}
            className="line-clamp-1 text-xs text-zinc-500"
          />
          <GenreBadge
            genre={eventGenreList(event)}
            inferred={event.genresInferred}
            className="self-start"
          />
          <p className="line-clamp-1 text-xs text-zinc-500">
            {timePart ? `${timePart} · ` : ''}
            {place}
          </p>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <p className="text-xs font-semibold text-zinc-800">{price}</p>
            {/* Room for the match score, which sits over the card (outside the link). */}
            {matchLabel && <span className="h-5 w-24" aria-hidden="true" />}
          </div>
        </div>
      </Link>
      <div className="absolute right-2.5 top-2.5 z-10">
        <SaveHeartButton
          eventId={event.id}
          title={headlinerName}
          isSaved={isSaved(event.id)}
          onToggle={toggleSave}
          variant="overlay"
        />
      </div>
      {matchLabel && event.personalScore && (
        <MatchScore
          personalScore={event.personalScore}
          data-testid="card-match-score"
          className="absolute bottom-3 right-3.5"
        />
      )}
    </div>
  );
}
