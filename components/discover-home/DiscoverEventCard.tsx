'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { IndexEventItem } from '@/components/index/types';
import {
  formatIndexDate,
  formatIndexPrice,
  getArtistAccent,
  getStatusBadge,
} from '@/components/index/formatters';

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
  const [imageFailed, setImageFailed] = useState(false);

  const headlinerName = event.headlinerName || event.title;
  const headliner =
    event.artists?.find(
      (a) => a.billingPosition === 'headliner' || a.name === headlinerName,
    ) || event.artists?.[0];

  const image =
    event.imageUrl ||
    headliner?.imageUrl ||
    event.artists?.find((a) => a.imageUrl)?.imageUrl ||
    event.venueImageUrl ||
    null;
  const showImage = Boolean(image) && !imageFailed;

  const accent = getArtistAccent(headlinerName);
  const supportActs = (event.artists || [])
    .filter(
      (a) => a.name !== headlinerName && a.billingPosition !== 'headliner',
    )
    .map((a) => a.name);

  const dateLabel = formatIndexDate(
    event.localStartDate,
    event.startsAt,
    event.timezone,
  );
  const [dayPart, timePart] = dateLabel.split(' · ');
  const price = formatIndexPrice(
    event.minPrice,
    event.maxPrice,
    event.currency,
    event.eventKind,
    event.ticketUrl,
  );
  const badge = getStatusBadge(
    event.inventoryStatus,
    event.ticketRemainingPercent,
  );
  const showBadge =
    event.inventoryStatus === 'sold_out' ||
    event.inventoryStatus === 'cancelled';
  const place = [event.venueName, event.city].filter(Boolean).join(' · ');

  return (
    <Link
      href={`/concerts/${event.id}`}
      data-testid="discover-event-card"
      className="group flex w-60 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white transition-all duration-200 hover:border-zinc-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] sm:w-64"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image as string}
            alt={headlinerName}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${accent.primary}1f 0%, ${accent.secondary}38 100%)`,
            }}
            aria-hidden="true"
          >
            <span
              className="select-none text-6xl font-extrabold tracking-tight"
              style={{ color: accent.primary, opacity: 0.55 }}
            >
              {headlinerName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-1"
          style={{
            background: `linear-gradient(90deg, ${accent.primary} 0%, ${accent.secondary} 100%)`,
          }}
        />
        <span className="absolute left-2.5 top-2.5 rounded-md bg-white/95 px-2 py-1 text-[11px] font-semibold text-zinc-800 shadow-sm">
          {dayPart}
        </span>
        {showBadge && (
          <span
            className={`absolute right-2.5 top-2.5 rounded-md border px-2 py-0.5 text-[11px] ${badge.bg}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3 className="line-clamp-2 text-sm font-bold leading-snug tracking-tight text-zinc-900">
          {headlinerName}
        </h3>
        {supportActs.length > 0 && (
          <p className="line-clamp-1 text-xs text-zinc-500">
            with {supportActs.join(', ')}
          </p>
        )}
        <p className="line-clamp-1 text-xs text-zinc-500">
          {timePart ? `${timePart} · ` : ''}
          {place}
        </p>
        <p className="mt-auto pt-2 text-xs font-semibold text-zinc-800">
          {price}
        </p>
      </div>
    </Link>
  );
}
