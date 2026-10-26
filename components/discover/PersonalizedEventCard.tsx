import React, { useState } from 'react';
import type { ScoredEvent } from '@/lib/recommendation/types';
import { formatEventPriceDisplay } from '@/components/recommendation/ScoringInspector';
import { formatSourceBadgeName } from '@/components/catalog/EventCard';

export interface PersonalizedEventCardProps {
  scoredEvent: ScoredEvent;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return 'Date TBA';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) return dateStr;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function PersonalizedEventCard({
  scoredEvent,
}: PersonalizedEventCardProps) {
  const [showExplanation, setShowExplanation] = useState(false);
  const { event, score, explanation, factors } = scoredEvent;

  const title = event.title || 'Untitled Event';
  const rawVenueName = event.venueName;
  const isUnknownVenue =
    !rawVenueName ||
    rawVenueName.trim().length === 0 ||
    rawVenueName.trim().toLowerCase() === 'unknown venue' ||
    rawVenueName.trim().toLowerCase() === 'venue tba' ||
    rawVenueName.trim().toLowerCase() === 'venue tba / unknown';
  const displayVenueName = isUnknownVenue ? null : rawVenueName.trim();

  const city = event.city;
  const region = event.region;
  const isCancelled = event.status === 'cancelled';
  const isPostponed = event.status === 'postponed';

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

  // Score tier styling (Score is strictly NOT rendered as a percentage)
  const scoreTierClass =
    score >= 80
      ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
      : score >= 60
        ? 'border-indigo-500/40 bg-indigo-950/60 text-indigo-300'
        : 'border-zinc-700 bg-zinc-800 text-zinc-300';

  // Source badges
  const sourceBadges = React.useMemo(() => {
    if (event.sources && event.sources.length > 0) {
      return event.sources.map((s) => ({
        id: s.id,
        name: formatSourceBadgeName(s.name),
      }));
    }
    if (event.sourceName) {
      return [
        {
          id: 'summary-source',
          name: formatSourceBadgeName(event.sourceName),
        },
      ];
    }
    return [];
  }, [event.sources, event.sourceName]);

  const sourceCount = event.sources?.length ?? (event.sourceName ? 1 : 0);

  return (
    <article
      data-testid="personalized-event-card"
      className="flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-sm transition hover:border-zinc-700 hover:bg-zinc-900"
    >
      <div>
        {/* Header: Date & Score Badge */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              {formatDisplayDate(event.localStartDate)}
            </span>
            <span className="text-[11px] text-zinc-500">
              ({event.localStartDate})
            </span>
          </div>

          <div
            data-testid="event-score"
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${scoreTierClass}`}
            title="Recommendation score out of 100 based on your taste profile and priority weights"
          >
            <span>Match:</span>
            <span className="font-bold">{score}/100</span>
          </div>
        </div>

        {/* Cancellation or Postponed Banners */}
        {isCancelled && (
          <div className="mb-2 rounded bg-red-950/80 px-2 py-0.5 text-xs font-medium text-red-300">
            Cancelled
          </div>
        )}
        {isPostponed && (
          <div className="mb-2 rounded bg-amber-950/80 px-2 py-0.5 text-xs font-medium text-amber-300">
            Postponed
          </div>
        )}

        {/* Title */}
        <h3 className="line-clamp-2 text-lg font-semibold text-zinc-100">
          {title}
        </h3>

        {/* Artists */}
        {event.artists && event.artists.length > 0 && (
          <p className="mt-1 line-clamp-1 text-sm text-zinc-300">
            {event.artists.map((a) => a.name).join(', ')}
          </p>
        )}

        {/* Concise Recommendation Summary */}
        <div
          data-testid="event-explanation"
          className="mt-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-1.5 text-xs text-zinc-300"
        >
          {explanation}
        </div>

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
            <p className="mt-0.5 text-xs text-zinc-500">
              {[city, region].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        {/* Footer Bar: Time, Price, Action Buttons */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 text-sm">
          <div>
            <div className="text-xs text-zinc-400">{renderTime()}</div>
            <div className="font-semibold text-emerald-400">
              {formatEventPriceDisplay(event)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowExplanation((prev) => !prev)}
              aria-expanded={showExplanation}
              data-testid="why-this-show-button"
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
            >
              {showExplanation ? 'Hide why ▲' : 'Why this show? ▼'}
            </button>

            {event.ticketUrl && !isCancelled && (
              <a
                href={event.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="ticket-button"
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-white"
              >
                Get Tickets
              </a>
            )}
          </div>
        </div>

        {/* Expandable "Why this show?" Factor Breakdown */}
        {showExplanation && (
          <div
            data-testid="factor-breakdown"
            className="mt-3 space-y-2 rounded-lg border border-indigo-900/40 bg-indigo-950/20 p-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-indigo-900/30 pb-1.5 text-[11px] font-semibold text-indigo-300">
              <span>Recommendation Factor Breakdown</span>
              <span>Total Score: {score}/100</span>
            </div>

            {/* Artist Factor */}
            <div className="flex items-start justify-between gap-2 text-zinc-300">
              <div>
                <span className="font-medium text-zinc-200">
                  🎵 Artist Interest:
                </span>{' '}
                <span className="text-zinc-400">
                  {factors.artist.explanation}
                </span>
              </div>
              <span className="shrink-0 font-mono text-zinc-400">
                +{Math.round(factors.artist.weightedContribution)} pts (wt{' '}
                {factors.artist.weight}%)
              </span>
            </div>

            {/* Distance Factor */}
            <div className="flex items-start justify-between gap-2 text-zinc-300">
              <div>
                <span className="font-medium text-zinc-200">
                  📍 Travel Practicality:
                </span>{' '}
                <span className="text-zinc-400">
                  {factors.distance.explanation}
                </span>
              </div>
              <span className="shrink-0 font-mono text-zinc-400">
                +{Math.round(factors.distance.weightedContribution)} pts (wt{' '}
                {factors.distance.weight}%)
              </span>
            </div>

            {/* Price Factor */}
            <div className="flex items-start justify-between gap-2 text-zinc-300">
              <div>
                <span className="font-medium text-zinc-200">
                  🎟️ Ticket Affordability:
                </span>{' '}
                <span className="text-zinc-400">
                  {factors.price.explanation}
                </span>
              </div>
              <span className="shrink-0 font-mono text-zinc-400">
                +{Math.round(factors.price.weightedContribution)} pts (wt{' '}
                {factors.price.weight}%)
              </span>
            </div>

            {/* Timing Factor */}
            <div className="flex items-start justify-between gap-2 text-zinc-300">
              <div>
                <span className="font-medium text-zinc-200">
                  📅 Timing Suitability:
                </span>{' '}
                <span className="text-zinc-400">
                  {factors.timing.explanation}
                </span>
              </div>
              <span className="shrink-0 font-mono text-zinc-400">
                +{Math.round(factors.timing.weightedContribution)} pts (wt{' '}
                {factors.timing.weight}%)
              </span>
            </div>
          </div>
        )}

        {/* Source Attribution */}
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
              Attribution: {sourceCount}{' '}
              {sourceCount === 1 ? 'source' : 'sources'}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
