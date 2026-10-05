import React from 'react';
import type { CanonicalEventSummary } from '@/lib/domain/catalog';

interface EventCardProps {
  event: CanonicalEventSummary;
}

export function EventCard({ event }: EventCardProps) {
  // Format temporal display
  let dateDisplay = event.localStartDate;
  if (event.isMultiDay && event.localEndDate) {
    dateDisplay = `${event.localStartDate} – ${event.localEndDate}`;
  }

  const timeDisplay =
    event.startTimePrecision === 'instant' && event.startsAt
      ? new Date(event.startsAt).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: event.timezone,
        })
      : 'Time TBA (Date confirmed)';

  // Format price display
  let priceDisplay = 'Price TBA';
  if (event.minPrice !== null && event.minPrice !== undefined) {
    const currency = event.currency ?? 'USD';
    if (
      event.maxPrice !== null &&
      event.maxPrice !== undefined &&
      event.maxPrice > event.minPrice
    ) {
      priceDisplay = `$${event.minPrice.toFixed(2)} – $${event.maxPrice.toFixed(2)} ${currency}`;
    } else {
      priceDisplay = `$${event.minPrice.toFixed(2)} ${currency}`;
    }
  }

  // Headliner and support
  const headliners = event.artists.filter(
    (a) => a.billingPosition === 'headliner',
  );
  const support = event.artists.filter(
    (a) => a.billingPosition !== 'headliner',
  );

  return (
    <article
      data-testid={`event-card-${event.id}`}
      className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur transition-colors hover:border-slate-700"
    >
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-indigo-400">
            {event.eventKind.replace('_', ' ')}
          </span>
          <span className="rounded bg-slate-800/80 px-2 py-0.5 text-slate-300">
            {event.timezone}
          </span>
        </div>

        <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-100">
          {event.name}
        </h3>

        {/* Artists breakdown */}
        <div className="mt-2 text-sm text-slate-300">
          {headliners.length > 0 && (
            <p className="font-medium text-slate-200">
              {headliners.map((h) => h.name).join(', ')}
            </p>
          )}
          {support.length > 0 && (
            <p className="text-xs text-slate-400">
              with {support.map((s) => s.name).join(', ')}
            </p>
          )}
        </div>

        {/* Location & Time */}
        <div className="mt-4 space-y-1 text-sm text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-slate-300">{dateDisplay}</span>
            <span>·</span>
            <span>{timeDisplay}</span>
          </div>
          {event.venue && (
            <div>
              <span className="text-slate-300">{event.venue.name}</span>
              <span className="text-slate-400">
                {' '}
                ({event.venue.city}
                {event.venue.region ? `, ${event.venue.region}` : ''})
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-slate-800/80 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400">Advertised</span>
            <p className="text-sm font-semibold text-emerald-400">
              {priceDisplay}
            </p>
          </div>

          {event.primaryTicketUrl && (
            <a
              href={event.primaryTicketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-indigo-500"
            >
              Get Tickets
            </a>
          )}
        </div>

        {/* Source attribution / provenance indicator */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
          <span>
            Source attribution: {event.sources.length}{' '}
            {event.sources.length === 1 ? 'source' : 'sources'}
          </span>
          <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-emerald-400">
            {event.status}
          </span>
        </div>
      </div>
    </article>
  );
}
