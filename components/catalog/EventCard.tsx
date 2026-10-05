import React from 'react';
import type {
  CanonicalEventDetail,
  CanonicalEventSummary,
} from '@/lib/domain/catalog';
import { formatCurrencyAmount } from '@/lib/domain/value-objects';

export interface EventCardProps {
  event: CanonicalEventSummary | CanonicalEventDetail;
}

export function EventCard({ event }: EventCardProps) {
  const isDetail = 'ticketLinks' in event;
  const detailEvent = isDetail ? (event as CanonicalEventDetail) : null;
  const summaryEvent = !isDetail ? (event as CanonicalEventSummary) : null;

  const title = summaryEvent?.title ?? detailEvent?.name ?? 'Untitled Event';
  const venueName =
    summaryEvent?.venueName ?? detailEvent?.venue?.name ?? 'Unknown Venue';
  const city =
    summaryEvent?.city ?? detailEvent?.venue?.city ?? detailEvent?.city;
  const region =
    summaryEvent?.region ?? detailEvent?.venue?.region ?? detailEvent?.region;

  const minPrice =
    summaryEvent?.minPrice ??
    detailEvent?.ticketLinks?.reduce<number | null>((min, tl) => {
      if (tl.minPrice === null || tl.minPrice === undefined) return min;
      return min === null ? tl.minPrice : Math.min(min, tl.minPrice);
    }, null) ??
    null;

  const maxPrice =
    summaryEvent?.maxPrice ??
    detailEvent?.ticketLinks?.reduce<number | null>((max, tl) => {
      if (tl.maxPrice === null || tl.maxPrice === undefined) return max;
      return max === null ? tl.maxPrice : Math.max(max, tl.maxPrice);
    }, null) ??
    null;

  const currency =
    summaryEvent?.currency ??
    detailEvent?.ticketLinks?.find((tl) => tl.currency)?.currency ??
    'USD';

  // Format price string using ISO currency code without hardcoding $
  const renderPrice = () => {
    if (minPrice === null || minPrice === undefined) {
      return 'Price TBA';
    }

    const formattedMin = formatCurrencyAmount(minPrice, currency);

    if (maxPrice !== null && maxPrice !== undefined && maxPrice > minPrice) {
      const formattedMax = formatCurrencyAmount(maxPrice, currency);
      return `${formattedMin} – ${formattedMax} ${currency}`;
    }

    return `${formattedMin} ${currency}`;
  };

  // Format date and time
  const renderTime = () => {
    if (event.startTimePrecision === 'date_only' || !event.startsAt) {
      return 'Time TBA (Date confirmed)';
    }

    try {
      const d = new Date(event.startsAt);
      return d.toLocaleTimeString('en-US', {
        timeZone: event.timezone,
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return 'Time TBA (Date confirmed)';
    }
  };

  const isCancelled = event.status === 'cancelled';
  const isPostponed = event.status === 'postponed';
  const ticketUrl = summaryEvent?.ticketUrl ?? detailEvent?.primaryTicketUrl;
  const sourceCount =
    detailEvent?.sources?.length ?? (summaryEvent?.sourceName ? 1 : 0);

  return (
    <article
      data-testid="event-card"
      className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm transition hover:border-zinc-700 hover:bg-zinc-900"
    >
      <div>
        {/* Status / Category Bar */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {event.localStartDate}
          </span>
          {isCancelled && (
            <span className="rounded bg-red-950/80 px-2 py-0.5 text-xs font-medium text-red-300">
              Cancelled
            </span>
          )}
          {isPostponed && (
            <span className="rounded bg-amber-950/80 px-2 py-0.5 text-xs font-medium text-amber-300">
              Postponed
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="line-clamp-1 text-lg font-semibold text-zinc-100">
          {title}
        </h3>

        {/* Artists */}
        {event.artists && event.artists.length > 0 && (
          <p className="mt-1 line-clamp-2 text-sm text-zinc-300">
            {event.artists.map((a) => a.name).join(', ')}
          </p>
        )}

        {/* Venue & Location */}
        <div className="mt-3 text-sm text-zinc-400">
          <p className="font-medium text-zinc-300">{venueName}</p>
          {(city || region) && (
            <p className="text-xs text-zinc-500">
              {[city, region].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </div>

      {/* Footer: Time, Price, Ticket Link */}
      <div className="mt-5 flex items-center justify-between border-t border-zinc-800/80 pt-3 text-sm">
        <div>
          <div className="text-xs text-zinc-400">{renderTime()}</div>
          <div className="font-semibold text-emerald-400">{renderPrice()}</div>
        </div>

        {ticketUrl && !isCancelled && (
          <a
            href={ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white"
          >
            Get Tickets
          </a>
        )}
      </div>

      {/* Attribution */}
      {sourceCount > 0 && (
        <div className="mt-2 text-right text-[10px] text-zinc-500">
          Source attribution: {sourceCount}{' '}
          {sourceCount === 1 ? 'source' : 'sources'}
        </div>
      )}
    </article>
  );
}
