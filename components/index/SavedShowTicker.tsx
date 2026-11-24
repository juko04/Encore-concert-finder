'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { IndexEventItem } from './types';
import { useWatchlist } from './useWatchlist';
import { HeartIcon, ArrowRightIcon, XIcon } from './icons';
import { formatIndexDate } from './formatters';

export interface SavedShowTickerProps {
  events?: IndexEventItem[];
}

export function SavedShowTicker({ events = [] }: SavedShowTickerProps) {
  const { savedIds } = useWatchlist();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || savedIds.length === 0 || events.length === 0) {
    return null;
  }

  const savedEvents = events.filter((e) => savedIds.includes(e.id));
  if (savedEvents.length === 0) {
    return null;
  }

  // Next upcoming saved event
  const nextEvent = savedEvents[0];
  const dateFormatted = formatIndexDate(nextEvent.localStartDate);

  return (
    <aside
      aria-label="Upcoming saved concerts summary"
      className="relative mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200/80 bg-rose-50/70 px-4 py-2 text-xs text-rose-950 transition-all duration-200"
    >
      <div className="flex min-w-0 items-center gap-2">
        <HeartIcon className="h-4 w-4 shrink-0 text-rose-600" filled />
        <p className="truncate">
          <span className="font-semibold">
            {savedEvents.length} saved concert
            {savedEvents.length > 1 ? 's' : ''} coming up:
          </span>{' '}
          <span className="text-rose-900">
            {nextEvent.headlinerName} at {nextEvent.venueName} ({dateFormatted})
          </span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Link
          href="/saved"
          className="inline-flex items-center gap-1 font-semibold text-rose-700 hover:text-rose-900 hover:underline"
        >
          <span>View Watchlist</span>
          <ArrowRightIcon className="h-3 w-3" />
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-rose-400 hover:bg-rose-100 hover:text-rose-700"
          aria-label="Dismiss saved shows summary"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}
