import React from 'react';
import type {
  CanonicalEventDetail,
  CanonicalEventSummary,
} from '@/lib/domain/catalog';
import { formatCurrencyAmount } from '@/lib/domain/value-objects';

export interface EventCardProps {
  event: CanonicalEventSummary | CanonicalEventDetail;
}

/**
 * Normalizes raw source provider names into clean, compact badge text.
 * Never fabricates verification claims.
 */
export function formatSourceBadgeName(rawName?: string | null): string {
  if (!rawName || rawName.trim().length === 0) {
    return 'Unknown Source';
  }
  const trimmed = rawName.trim();
  if (
    trimmed.toLowerCase().includes('ticketmaster') ||
    trimmed.toLowerCase() === 'ticketmaster discovery api'
  ) {
    return 'Ticketmaster';
  }
  if (
    trimmed.toLowerCase() === 'verified source' ||
    trimmed.toLowerCase() === 'verified'
  ) {
    return 'Unknown Source';
  }
  return trimmed;
}

export function EventCard({ event }: EventCardProps) {
  const isDetail = 'ticketLinks' in event;
  const detailEvent = isDetail ? (event as CanonicalEventDetail) : null;
  const summaryEvent = !isDetail ? (event as CanonicalEventSummary) : null;

  const title = summaryEvent?.title ?? detailEvent?.name ?? 'Untitled Event';

  // Venue extraction and unknown venue handling (Tech Debt 1.4)
  const rawVenueName = summaryEvent?.venueName ?? detailEvent?.venue?.name;
  const isUnknownVenue =
    !rawVenueName ||
    rawVenueName.trim().length === 0 ||
    rawVenueName.trim().toLowerCase() === 'unknown venue' ||
    rawVenueName.trim().toLowerCase() === 'venue tba' ||
    rawVenueName.trim().toLowerCase() === 'venue tba / unknown';
  const displayVenueName = isUnknownVenue ? null : rawVenueName.trim();

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
    null;

  // Format price string using ISO currency code without hardcoding $
  const renderPrice = () => {
    if (minPrice === null || minPrice === undefined) {
      return 'Price TBA';
    }

    if (!currency) {
      if (maxPrice !== null && maxPrice !== undefined && maxPrice > minPrice) {
        return `${minPrice} – ${maxPrice}`;
      }
      return `${minPrice}`;
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

  // Source attribution badges (Tech Debt 1.3)
  const sourceBadges = React.useMemo(() => {
    if (summaryEvent?.sources && summaryEvent.sources.length > 0) {
      return summaryEvent.sources.map((s) => ({
        id: s.id,
        name: formatSourceBadgeName(s.name),
        slug: s.slug,
      }));
    }
    if (summaryEvent?.sourceName) {
      return [
        {
          id: 'summary-source',
          name: formatSourceBadgeName(summaryEvent.sourceName),
          slug: 'source',
        },
      ];
    }
    if (detailEvent?.sources && detailEvent.sources.length > 0) {
      return detailEvent.sources
        .filter((s) => Boolean(s.sourceId))
        .map((s, idx) => ({
          id: s.sourceId || String(idx),
          name: formatSourceBadgeName(
            (s as { sourceName?: string }).sourceName,
          ),
          slug: 'source',
        }));
    }
    return [];
  }, [summaryEvent, detailEvent]);

  const sourceCount =
    detailEvent?.sources?.length ??
    summaryEvent?.sources?.length ??
    (summaryEvent?.sourceName ? 1 : 0);

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
          {isUnknownVenue ? (
            <span
              data-testid="venue-tba-badge"
              className="inline-flex items-center rounded-md border border-amber-800/40 bg-zinc-800/80 px-2 py-0.5 text-xs font-medium text-amber-300/90"
            >
              Venue TBA / Unknown
            </span>
          ) : (
            <p className="font-medium text-zinc-300">{displayVenueName}</p>
          )}
          {(city || region) && (
            <p
              className={
                isUnknownVenue
                  ? 'mt-1 text-xs text-zinc-500'
                  : 'text-xs text-zinc-500'
              }
            >
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
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-800/60 pt-2 text-[10px] text-zinc-500">
          <div
            className="flex flex-wrap items-center gap-1.5"
            data-testid="event-sources"
          >
            <span className="text-[10px] text-zinc-500">Source:</span>
            {sourceBadges.length > 0 ? (
              sourceBadges.map((badge) => (
                <span
                  key={badge.id}
                  data-testid="source-badge"
                  className="shadow-xs inline-flex items-center rounded border border-zinc-700/60 bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300"
                >
                  {badge.name}
                </span>
              ))
            ) : (
              <span
                data-testid="source-badge"
                className="shadow-xs inline-flex items-center rounded border border-zinc-700/60 bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300"
              >
                Unknown Source
              </span>
            )}
          </div>
          <span className="text-[10px] text-zinc-500">
            Source attribution: {sourceCount}{' '}
            {sourceCount === 1 ? 'source' : 'sources'}
          </span>
        </div>
      )}
    </article>
  );
}
